import { HttpError } from "../../_shared/http.js";
import { authenticate, HR_READ } from "../../_shared/auth.js";
import { readFile } from "../../_shared/files.js";
import * as v from "../../_shared/validate.js";

// Download a stored file. HR (and auditors) can read files in their organization;
// employees can read their own paperwork only.
export async function onRequestGet(context) {
  const user = await authenticate(context);
  const { env, params, request } = context;
  const f = await env.DB.prepare("SELECT * FROM stored_files WHERE id=? AND organization_id=?").bind(v.id(params.id), user.organization_id).first();
  if (!f) throw new HttpError(404, "File not found");
  if (!HR_READ.includes(user.role)) {
    const own = await env.DB.prepare("SELECT 1 AS ok FROM employee_documents WHERE file_id=? AND employee_id=?").bind(f.id, user.employee_id || "-").first();
    if (!own) throw new HttpError(404, "File not found");
  }
  const bytes = await readFile(env, f);
  const inline = new URL(request.url).searchParams.get("inline") === "1" && /^(image\/(png|jpeg|webp)|application\/pdf)$/.test(f.content_type);
  return new Response(bytes, { headers: {
    "Content-Type": f.content_type, "Content-Length": String(bytes.length),
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.filename.replace(/"/g, "")}"`,
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"
  } });
}
