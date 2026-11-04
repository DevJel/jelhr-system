import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, HR } from "../../_shared/auth.js";
import { indexStatements, vectorUpsert, vectorDelete } from "../../_shared/knowledge.js";
import { CATEGORIES, readContent } from "./index.js";
import * as v from "../../_shared/validate.js";

async function load(context, user) {
  const d = await context.env.DB.prepare("SELECT * FROM knowledge_docs WHERE id=? AND organization_id=?").bind(v.id(context.params.id), user.organization_id).first();
  if (!d) throw new HttpError(404, "Document not found");
  return d;
}
export async function onRequestGet(context) {
  const user = await authenticate(context, [...HR, "auditor"]);
  return respond({ document: await load(context, user) });
}
export async function onRequestPatch(context) {
  const user = await authenticate(context, HR);
  const { env, request } = context;
  const d = await load(context, user);
  const b = await readJson(request, 8 * 1024 * 1024);
  const title = b.title !== undefined ? v.text(b.title, "Title", { required: true, max: 160 }) : d.title;
  const category = b.category !== undefined ? v.oneOf(b.category, CATEGORIES, "Category") : d.category;
  const audience = b.audience !== undefined ? v.oneOf(b.audience, ["all", "hr"], "Audience") : d.audience;
  const statements = [];
  const fresh = b.content !== undefined || b.file ? await readContent(env, user, b, statements) : { content: d.content, fileId: d.source_file_id };
  if (fresh.content.trim().length < 20) throw new HttpError(400, "Add the document text (at least a few sentences)");
  const idx = indexStatements(env, { orgId: user.organization_id, docId: d.id, audience, title, content: fresh.content });
  await env.DB.batch([
    ...statements,
    env.DB.prepare("UPDATE knowledge_docs SET title=?, category=?, audience=?, content=?, source_file_id=?, chunk_count=?, updated_at=? WHERE id=?").bind(title, category, audience, fresh.content, fresh.fileId, idx.count, new Date().toISOString(), d.id),
    ...idx.statements,
    await auditStatement(env, user, "knowledge.updated", "knowledge_doc", d.id, { title }, request)
  ]);
  const vec = (async () => { await vectorDelete(env, d.id, d.chunk_count); await vectorUpsert(env, { orgId: user.organization_id, docId: d.id, audience, chunks: idx.chunks, title }); })();
  if (context.waitUntil) context.waitUntil(vec); else await vec;
  return respond({ ok: true, chunks: idx.count });
}
export async function onRequestDelete(context) {
  const user = await authenticate(context, HR);
  const { env, request } = context;
  const d = await load(context, user);
  await env.DB.batch([env.DB.prepare("DELETE FROM knowledge_chunks WHERE doc_id=?").bind(d.id), env.DB.prepare("DELETE FROM knowledge_docs WHERE id=?").bind(d.id), await auditStatement(env, user, "knowledge.deleted", "knowledge_doc", d.id, { title: d.title }, request)]);
  await vectorDelete(env, d.id, d.chunk_count);
  return respond({ ok: true });
}
