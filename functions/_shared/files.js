// File storage: Cloudflare R2 when the FILES binding exists, otherwise inline in D1 (smaller limit).
import { HttpError } from "./http.js";

export const TYPES = {
  "application/pdf": { ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", magic: [0x50, 0x4b, 0x03, 0x04] },
  "application/msword": { ext: "doc", magic: [0xd0, 0xcf, 0x11, 0xe0] },
  "image/png": { ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  "image/jpeg": { ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  "image/webp": { ext: "webp", magic: [0x52, 0x49, 0x46, 0x46] },
  "text/plain": { ext: "txt", magic: null }
};
export const limitFor = env => (env.FILES ? 5 * 1024 * 1024 : 1536 * 1024);

/** Decode a { name, type, data(base64) } upload and validate type, size and magic bytes. */
export function decodeUpload(env, upload, { allowed = Object.keys(TYPES), field = "File" } = {}) {
  if (!upload || typeof upload !== "object") throw new HttpError(400, `${field} is missing`);
  const type = String(upload.type || "").toLowerCase();
  if (!allowed.includes(type)) throw new HttpError(415, `${field} must be one of: ${allowed.map(t => TYPES[t]?.ext || t).join(", ")}`);
  let bytes;
  try { bytes = Uint8Array.from(atob(String(upload.data || "").replace(/^data:[^,]*,/, "")), c => c.charCodeAt(0)); } catch { throw new HttpError(400, `${field} could not be read`); }
  if (!bytes.length) throw new HttpError(400, `${field} is empty`);
  const limit = limitFor(env);
  if (bytes.length > limit) throw new HttpError(413, `${field} is larger than ${Math.round(limit / 1024 / 1024 * 10) / 10} MB`);
  const magic = TYPES[type].magic;
  if (magic && !magic.every((b, i) => bytes[i] === b)) throw new HttpError(415, `${field} doesn't look like a real ${TYPES[type].ext.toUpperCase()} file`);
  const name = String(upload.name || "file").replace(/[^\w.\- ()]+/g, "_").slice(0, 120) || "file";
  return { bytes, type, name };
}

/** Returns { id, statement } — run the statement in the same batch as the record that references it. */
export async function storeFile(env, { orgId, userId, bytes, type, name }) {
  const id = crypto.randomUUID();
  const sha = await digest(bytes);
  let storage = "d1", data = null;
  if (env.FILES) { await env.FILES.put(`org/${orgId}/${id}`, bytes, { httpMetadata: { contentType: type } }); storage = "r2"; }
  else data = btoa(chunkedBinary(bytes));
  return {
    id,
    statement: env.DB.prepare("INSERT INTO stored_files(id,organization_id,filename,content_type,size,sha256,storage,data_b64,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(id, orgId, name, type, bytes.length, sha, storage, data, userId || null)
  };
}

async function digest(bytes) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join(""); }
function chunkedBinary(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768)); return s; }

export async function readFile(env, file) {
  if (file.storage === "r2") {
    if (!env.FILES) throw new HttpError(503, "File storage (R2) is not bound");
    const obj = await env.FILES.get(`org/${file.organization_id}/${file.id}`);
    if (!obj) throw new HttpError(404, "File content not found");
    return new Uint8Array(await obj.arrayBuffer());
  }
  return Uint8Array.from(atob(file.data_b64 || ""), c => c.charCodeAt(0));
}

export async function deleteFileContent(env, file) {
  if (file.storage === "r2" && env.FILES) await env.FILES.delete(`org/${file.organization_id}/${file.id}`);
}
