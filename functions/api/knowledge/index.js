import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, HR } from "../../_shared/auth.js";
import { decodeUpload, storeFile } from "../../_shared/files.js";
import { documentToText } from "../../_shared/ai.js";
import { indexStatements, vectorUpsert } from "../../_shared/knowledge.js";
import * as v from "../../_shared/validate.js";

export const CATEGORIES = ["handbook", "policy", "leave", "labour_law", "procedure", "template", "other"];
const DOC_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];

// Organization knowledge for the AI assistant. Managed by HR; stays inside the organization.
export async function onRequestGet(context) {
  const user = await authenticate(context, [...HR, "auditor"]);
  const { results } = await context.env.DB.prepare("SELECT d.id, d.title, d.category, d.audience, d.chunk_count, length(d.content) AS characters, d.updated_at, u.display_name AS created_by_name FROM knowledge_docs d LEFT JOIN users u ON u.id=d.created_by WHERE d.organization_id=? ORDER BY d.category, d.title").bind(user.organization_id).all();
  return respond({ documents: results || [], categories: CATEGORIES, semantic: Boolean(context.env.VECTORIZE && context.env.AI) });
}

export async function readContent(env, user, b, statements) {
  let content = b.content !== undefined ? v.text(b.content, "Content", { max: 200000 }) : "";
  let fileId = null;
  if (b.file) {
    const f = decodeUpload(env, b.file, { allowed: DOC_TYPES, field: "Document" });
    const text = await documentToText(env, f);
    if (!text) throw new HttpError(422, f.type === "text/plain" ? "The file is empty" : "This file couldn't be converted to text here. Workers AI (the AI binding) converts PDF and Word files; otherwise paste the text.");
    content = (content ? content + "\n\n" : "") + text;
    const stored = await storeFile(env, { orgId: user.organization_id, userId: user.id, ...f });
    statements.push(stored.statement);
    fileId = stored.id;
  }
  return { content, fileId };
}

export async function onRequestPost(context) {
  const user = await authenticate(context, HR);
  const { env, request } = context;
  const b = await readJson(request, 8 * 1024 * 1024);
  const title = v.text(b.title, "Title", { required: true, max: 160 });
  const category = v.oneOf(b.category || "policy", CATEGORIES, "Category");
  const audience = v.oneOf(b.audience || "all", ["all", "hr"], "Audience");
  const statements = [];
  const { content, fileId } = await readContent(env, user, b, statements);
  if (content.trim().length < 20) throw new HttpError(400, "Add the document text (at least a few sentences)");
  const id = crypto.randomUUID();
  const idx = indexStatements(env, { orgId: user.organization_id, docId: id, audience, title, content });
  await env.DB.batch([
    ...statements,
    env.DB.prepare("INSERT INTO knowledge_docs(id,organization_id,title,category,audience,content,source_file_id,chunk_count,created_by) VALUES(?,?,?,?,?,?,?,?,?)").bind(id, user.organization_id, title, category, audience, content, fileId, idx.count, user.id),
    ...idx.statements.slice(1),
    await auditStatement(env, user, "knowledge.added", "knowledge_doc", id, { title, category }, request)
  ]);
  const vec = vectorUpsert(env, { orgId: user.organization_id, docId: id, audience, chunks: idx.chunks, title });
  if (context.waitUntil) context.waitUntil(vec); else await vec;
  return respond({ id, chunks: idx.count }, 201);
}
