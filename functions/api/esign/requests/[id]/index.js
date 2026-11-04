import { requireFeature } from "../../../../_shared/features.js";
import { respond, readJson, HttpError, clientIp, userAgent } from "../../../../_shared/http.js";
import { authenticate, auditStatement, HR, HR_READ } from "../../../../_shared/auth.js";
import { sha256hex, sha256b64, safeEqual } from "../../../../_shared/crypto.js";
import { documentHash, signatureEvent } from "../../../../_shared/esign.js";
import { CONSENT_TEXT } from "../../../../_shared/esign-templates.js";
import { notifySigner } from "../index.js";
import * as v from "../../../../_shared/validate.js";

const MAX_IMAGE = 300 * 1024;

async function load(context, user) {
  const r = await context.env.DB.prepare(
    `SELECT r.*, e.first_name, e.last_name, e.employee_number, e.email AS employee_email, e.user_id AS employee_user_id, e.job_title,
            u.display_name AS created_by_name
       FROM signature_requests r JOIN employees e ON e.id=r.employee_id LEFT JOIN users u ON u.id=r.created_by
      WHERE r.id=? AND r.organization_id=?`
  ).bind(v.id(context.params.id), user.organization_id).first();
  const isSigner = r && r.employee_user_id && r.employee_user_id === user.id;
  if (!r || (!HR_READ.includes(user.role) && !isSigner)) throw new HttpError(404, "Document not found");
  return { r, isSigner };
}

export async function onRequestGet(context) {
  const user = await authenticate(context);
  requireFeature(user, "esign");
  const { r, isSigner } = await load(context, user);
  const events = await context.env.DB.prepare(
    "SELECT ev.event, ev.created_at, ev.detail, u.display_name AS actor_name FROM signature_events ev LEFT JOIN users u ON u.id=ev.actor_user_id WHERE ev.request_id=? ORDER BY ev.created_at"
  ).bind(r.id).all();
  const intact = safeEqual(await documentHash(r), r.document_hash);
  return respond({
    request: {
      id: r.id, title: r.title, body: r.body, message: r.message, status: r.status, templateId: r.template_id, dueDate: r.due_date,
      createdAt: r.created_at, createdByName: r.created_by_name, viewedAt: r.viewed_at, signedAt: r.signed_at,
      employee: { id: r.employee_id, name: `${r.first_name} ${r.last_name}`, number: r.employee_number, jobTitle: r.job_title, hasAccount: Boolean(r.employee_user_id) },
      offboardingCaseId: r.offboarding_case_id, documentHash: r.document_hash, documentIntact: intact,
      signature: r.status === "signed" ? { type: r.signature_type, image: r.signature_image, typedName: r.typed_name, signerName: r.signer_name, signerEmail: r.signer_email, consentText: r.consent_text, signatureHash: r.signature_hash } : null,
      declinedReason: r.declined_reason, voidedReason: r.voided_reason
    },
    events: events.results || [],
    canSign: isSigner && r.status === "pending",
    canManage: HR.includes(user.role),
    consentText: CONSENT_TEXT
  });
}

function checkPng(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) throw new HttpError(400, "Signature image must be a PNG");
  if (dataUrl.length > MAX_IMAGE) throw new HttpError(413, "Signature image is too large");
  const bytes = atob(m[1].slice(0, 12));
  if (bytes.charCodeAt(0) !== 0x89 || bytes.slice(1, 4) !== "PNG") throw new HttpError(400, "Signature image is not a valid PNG");
  if (m[1].length < 400) throw new HttpError(400, "Please draw your signature");
  return dataUrl;
}

export async function onRequestPost(context) {
  const user = await authenticate(context);
  requireFeature(user, "esign");
  const { env, request } = context;
  const { r, isSigner } = await load(context, user);
  const b = await readJson(request, 400 * 1024);
  const now = new Date().toISOString();

  switch (b.action) {
    case "view": {
      if (!isSigner || r.viewed_at || r.status !== "pending") return respond({ ok: true });
      await env.DB.batch([
        env.DB.prepare("UPDATE signature_requests SET viewed_at=?, updated_at=? WHERE id=?").bind(now, now, r.id),
        await signatureEvent(env, request, r, "viewed", user.id)
      ]);
      return respond({ ok: true });
    }
    case "sign": {
      if (!isSigner) throw new HttpError(403, "Only the named employee can sign this document");
      if (r.status !== "pending") throw new HttpError(409, `This document is already ${r.status}`);
      if (b.consent !== true) throw new HttpError(400, "You must agree to sign electronically");
      if (!safeEqual(String(b.documentHash || ""), r.document_hash)) throw new HttpError(409, "The document changed since you opened it. Reload and review it again.");
      if (!safeEqual(await documentHash(r), r.document_hash)) throw new HttpError(409, "Document integrity check failed. Contact People Operations.");
      const type = v.oneOf(b.signatureType, ["drawn", "typed"], "Signature type");
      const signerName = v.text(b.signerName || `${r.first_name} ${r.last_name}`, "Full name", { required: true, min: 2, max: 120 });
      const image = type === "drawn" ? checkPng(b.signatureImage) : null;
      const typed = type === "typed" ? v.text(b.typedName, "Typed signature", { required: true, min: 2, max: 120 }) : null;
      const signatureHash = await sha256hex([r.document_hash, user.id, now, await sha256hex(image || typed)].join("|"));
      await env.DB.batch([
        env.DB.prepare(`UPDATE signature_requests SET status='signed', signed_at=?, signer_user_id=?, signer_name=?, signer_email=?, signature_type=?, signature_image=?, typed_name=?,
                         consent_text=?, signer_ip_hash=?, signer_user_agent=?, signature_hash=?, viewed_at=COALESCE(viewed_at, ?), updated_at=? WHERE id=? AND status='pending'`)
          .bind(now, user.id, signerName, user.email, type, image, typed, CONSENT_TEXT, await sha256b64(clientIp(request)), userAgent(request), signatureHash, now, now, r.id),
        await signatureEvent(env, request, r, "signed", user.id, `fingerprint ${signatureHash.slice(0, 16)}…`),
        await auditStatement(env, user, "esign.signed", "signature_request", r.id, { signatureHash }, request)
      ]);
      return respond({ ok: true, signedAt: now, signatureHash });
    }
    case "decline": {
      if (!isSigner) throw new HttpError(403, "Only the named employee can decline this document");
      if (r.status !== "pending") throw new HttpError(409, `This document is already ${r.status}`);
      const reason = v.text(b.reason, "Reason", { required: true, max: 1000 });
      await env.DB.batch([
        env.DB.prepare("UPDATE signature_requests SET status='declined', declined_reason=?, updated_at=? WHERE id=?").bind(reason, now, r.id),
        await signatureEvent(env, request, r, "declined", user.id, reason),
        await auditStatement(env, user, "esign.declined", "signature_request", r.id, null, request)
      ]);
      return respond({ ok: true });
    }
    case "void": {
      if (!HR.includes(user.role)) throw new HttpError(403, "Insufficient permission");
      if (r.status !== "pending") throw new HttpError(409, "Only pending requests can be voided");
      const reason = v.text(b.reason, "Reason", { required: true, max: 1000 });
      await env.DB.batch([
        env.DB.prepare("UPDATE signature_requests SET status='voided', voided_reason=?, voided_by=?, updated_at=? WHERE id=?").bind(reason, user.id, now, r.id),
        await signatureEvent(env, request, r, "voided", user.id, reason),
        await auditStatement(env, user, "esign.voided", "signature_request", r.id, null, request)
      ]);
      return respond({ ok: true });
    }
    case "remind": {
      if (!HR.includes(user.role)) throw new HttpError(403, "Insufficient permission");
      if (r.status !== "pending") throw new HttpError(409, "Only pending requests can be reminded");
      const email = await notifySigner(context, r, r.employee_email, `${r.first_name} ${r.last_name}`, true);
      if (!email.ok) throw new HttpError(502, "Reminder could not be sent: " + email.error);
      await (await signatureEvent(env, request, r, "reminded", user.id)).run();
      return respond({ ok: true });
    }
    default:
      throw new HttpError(400, "Unknown action");
  }
}
