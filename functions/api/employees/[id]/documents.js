import { respond, readJson, HttpError } from "../../../_shared/http.js";
import { authenticate, auditStatement, HR, HR_READ } from "../../../_shared/auth.js";
import { decodeUpload, storeFile, deleteFileContent } from "../../../_shared/files.js";
import * as v from "../../../_shared/validate.js";

const CATEGORIES = ["resume", "contract", "identity", "certificate", "tax", "other"];

async function employeeFor(context, user) {
  const e = await context.env.DB.prepare("SELECT id, first_name, last_name FROM employees WHERE id=? AND organization_id=?").bind(v.id(context.params.id), user.organization_id).first();
  if (!e) throw new HttpError(404, "Employee not found");
  if (!HR_READ.includes(user.role) && e.id !== user.employee_id) throw new HttpError(404, "Employee not found");
  return e;
}

// Employee paperwork: résumé, contract, ID copies, certificates, tax forms.
export async function onRequestGet(context) {
  const user = await authenticate(context);
  const e = await employeeFor(context, user);
  const { results } = await context.env.DB.prepare(
    `SELECT d.id, d.category, d.title, d.created_at, f.id AS file_id, f.filename, f.content_type, f.size, u.display_name AS uploaded_by_name
       FROM employee_documents d JOIN stored_files f ON f.id=d.file_id LEFT JOIN users u ON u.id=d.uploaded_by
      WHERE d.organization_id=? AND d.employee_id=? ORDER BY d.created_at DESC`
  ).bind(user.organization_id, e.id).all();
  return respond({ documents: results || [], categories: CATEGORIES });
}

export async function onRequestPost(context) {
  const user = await authenticate(context, HR);
  const { env, request } = context;
  const e = await employeeFor(context, user);
  const b = await readJson(request, 8 * 1024 * 1024);
  const category = v.oneOf(b.category || "other", CATEGORIES, "Category");
  const f = decodeUpload(env, b.file, { field: "Document" });
  const title = v.text(b.title || f.name, "Title", { required: true, max: 140 });
  const stored = await storeFile(env, { orgId: user.organization_id, userId: user.id, ...f });
  const id = crypto.randomUUID();
  await env.DB.batch([
    stored.statement,
    env.DB.prepare("INSERT INTO employee_documents(id,organization_id,employee_id,file_id,category,title,uploaded_by) VALUES(?,?,?,?,?,?,?)").bind(id, user.organization_id, e.id, stored.id, category, title, user.id),
    await auditStatement(env, user, "employee.document_added", "employee", e.id, { category, title }, request)
  ]);
  return respond({ id }, 201);
}

export async function onRequestDelete(context) {
  const user = await authenticate(context, HR);
  const { env, request } = context;
  const e = await employeeFor(context, user);
  const docId = v.id(new URL(request.url).searchParams.get("docId"), "docId");
  const d = await env.DB.prepare("SELECT d.title, f.id AS file_id, f.organization_id, f.storage FROM employee_documents d JOIN stored_files f ON f.id=d.file_id WHERE d.id=? AND d.employee_id=? AND d.organization_id=?").bind(docId, e.id, user.organization_id).first();
  if (!d) throw new HttpError(404, "Document not found");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM employee_documents WHERE id=?").bind(docId),
    await auditStatement(env, user, "employee.document_deleted", "employee", e.id, { title: d.title }, request)
  ]);
  // Remove the file itself unless an applicant record or another document still points at it.
  const used = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM applicants WHERE resume_file_id=?) + (SELECT COUNT(*) FROM employee_documents WHERE file_id=?) AS n").bind(d.file_id, d.file_id).first();
  if (!used.n) { await deleteFileContent(env, { id: d.file_id, organization_id: d.organization_id, storage: d.storage }); await env.DB.prepare("DELETE FROM stored_files WHERE id=?").bind(d.file_id).run(); }
  return respond({ ok: true });
}
