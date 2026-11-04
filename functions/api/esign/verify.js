import { respond, HttpError } from "../../_shared/http.js";
import { authenticate } from "../../_shared/auth.js";

// Look up a signed document by its signature or document fingerprint (same organization only).
export async function onRequestGet(context) {
  const user = await authenticate(context);
  const hash = String(new URL(context.request.url).searchParams.get("hash") || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new HttpError(400, "Enter a 64-character fingerprint");
  const row = await context.env.DB.prepare(
    `SELECT id, title, status, signed_at, signer_name, document_hash, signature_hash, employee_id FROM signature_requests
      WHERE organization_id=? AND (signature_hash=? OR document_hash=?)`
  ).bind(user.organization_id, hash, hash).first();
  if (!row) return respond({ found: false });
  const visible = ["owner", "admin", "hr_manager", "auditor"].includes(user.role) || row.employee_id === user.employee_id;
  if (!visible) return respond({ found: false });
  return respond({ found: true, request: { id: row.id, title: row.title, status: row.status, signedAt: row.signed_at, signerName: row.signer_name, documentHash: row.document_hash, signatureHash: row.signature_hash } });
}
