import { requireFeature } from "../../_shared/features.js";
import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, HR, HR_READ } from "../../_shared/auth.js";
import { sendEmail, emailStatus, renderEmailHtml, orgEmailContext } from "../../_shared/email.js";
import * as v from "../../_shared/validate.js";

// Emails sent per request. Keeps each invocation well inside Workers subrequest/CPU limits;
// the browser calls "send" repeatedly until nothing is queued, showing progress.
const BATCH = 20;

async function load(context, user) {
  const c = await context.env.DB.prepare("SELECT * FROM communications WHERE id=? AND organization_id=?").bind(v.id(context.params.id), user.organization_id).first();
  if (!c) throw new HttpError(404, "Message not found");
  return c;
}

const personalise = (text, r, orgName) => {
  const [first, ...rest] = String(r.name).split(" ");
  return String(text).replace(/\{\{\s*firstName\s*\}\}/g, first || "there").replace(/\{\{\s*lastName\s*\}\}/g, rest.join(" ")).replace(/\{\{\s*fullName\s*\}\}/g, r.name).replace(/\{\{\s*organization\s*\}\}/g, orgName);
};

const FOOTERS = {
  applicant: "You are receiving this because you applied for a role with {{organization}}. Reply to this email if you no longer wish to be contacted.",
  former: "You are receiving this as a former colleague of {{organization}}. Reply to this email if you no longer wish to be contacted.",
  employee: ""
};

export async function onRequestGet(context) {
  const user = await authenticate(context, HR_READ);
  requireFeature(user, "communications");
  const c = await load(context, user);
  const { results } = await context.env.DB.prepare("SELECT id, recipient_type, email, name, status, error, sent_at FROM communication_recipients WHERE communication_id=? ORDER BY name").bind(c.id).all();
  return respond({ communication: c, recipients: results || [], email: emailStatus(context.env) });
}

export async function onRequestPost(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "communications");
  const { env, request } = context;
  const c = await load(context, user);
  const b = await readJson(request, 2048);
  const now = new Date().toISOString();

  if (b.action === "cancel") {
    if (!["draft", "sending"].includes(c.status)) throw new HttpError(409, "This message can no longer be cancelled");
    await env.DB.batch([
      env.DB.prepare("UPDATE communication_recipients SET status='skipped' WHERE communication_id=? AND status='queued'").bind(c.id),
      env.DB.prepare("UPDATE communications SET status='cancelled', updated_at=? WHERE id=?").bind(now, c.id),
      await auditStatement(env, user, "communication.cancelled", "communication", c.id, null, request)
    ]);
    return respond({ ok: true });
  }
  if (b.action === "retry_failed") {
    if (!["partial"].includes(c.status)) throw new HttpError(409, "Only partially delivered messages can be retried");
    await env.DB.batch([
      env.DB.prepare("UPDATE communication_recipients SET status='queued', error=NULL WHERE communication_id=? AND status='failed'").bind(c.id),
      env.DB.prepare("UPDATE communications SET status='sending', failed_count=0, updated_at=? WHERE id=?").bind(now, c.id)
    ]);
    return respond({ ok: true });
  }
  if (b.action !== "send") throw new HttpError(400, "Unknown action");
  if (!["draft", "sending"].includes(c.status)) throw new HttpError(409, `This message is already ${c.status}`);
  const status = emailStatus(env);
  if (!status.configured) throw new HttpError(503, "Email is not configured: " + status.detail);

  if (c.status === "draft") {
    await env.DB.batch([
      env.DB.prepare("UPDATE communications SET status='sending', provider=?, updated_at=? WHERE id=?").bind(status.provider, now, c.id),
      await auditStatement(env, user, "communication.send_started", "communication", c.id, { provider: status.provider }, request)
    ]);
  }
  const org = await orgEmailContext(env, user.organization_id);
  const { results: queue } = await env.DB.prepare("SELECT * FROM communication_recipients WHERE communication_id=? AND status='queued' LIMIT ?").bind(c.id, BATCH).all();
  let sent = 0, failed = 0;
  for (const r of queue || []) {
    const footer = [personalise(FOOTERS[r.recipient_type] || "", r, org.orgName), org.footer].filter(Boolean).join("\n");
    const subject = personalise(c.subject, r, org.orgName);
    const text = personalise(c.body, r, org.orgName) + (footer ? "\n\n—\n" + footer : "");
    const result = await sendEmail(env, {
      to: r.email, toName: r.name, subject, text, fromName: org.senderName, replyTo: org.replyTo || undefined,
      html: renderEmailHtml({ subject, text: personalise(c.body, r, org.orgName), orgName: org.orgName, footer })
    });
    if (result.ok) sent++; else failed++;
    await env.DB.prepare("UPDATE communication_recipients SET status=?, error=?, provider_message_id=?, attempts=attempts+1, sent_at=? WHERE id=?")
      .bind(result.ok ? "sent" : "failed", result.ok ? null : result.error, result.id || null, result.ok ? new Date().toISOString() : null, r.id).run();
  }
  const counts = await env.DB.prepare(
    "SELECT SUM(status='sent') AS sent, SUM(status='failed') AS failed, SUM(status='queued') AS queued FROM communication_recipients WHERE communication_id=?"
  ).bind(c.id).first();
  const remaining = counts.queued || 0;
  const finalStatus = remaining ? "sending" : counts.failed ? "partial" : "sent";
  await env.DB.prepare("UPDATE communications SET status=?, sent_count=?, failed_count=?, sent_at=CASE WHEN ?=0 THEN ? ELSE sent_at END, updated_at=? WHERE id=?")
    .bind(finalStatus, counts.sent || 0, counts.failed || 0, remaining, now, now, c.id).run();
  if (!remaining) await (await auditStatement(env, user, "communication.sent", "communication", c.id, { sent: counts.sent || 0, failed: counts.failed || 0 }, request)).run();
  return respond({ status: finalStatus, sentThisBatch: sent, failedThisBatch: failed, sent: counts.sent || 0, failed: counts.failed || 0, remaining, total: c.recipient_count });
}

export async function onRequestDelete(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "communications");
  const { env, request } = context;
  const c = await load(context, user);
  if (c.status !== "draft") throw new HttpError(409, "Only drafts can be deleted");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM communication_recipients WHERE communication_id=?").bind(c.id),
    env.DB.prepare("DELETE FROM communications WHERE id=?").bind(c.id),
    await auditStatement(env, user, "communication.deleted", "communication", c.id, null, request)
  ]);
  return respond({ ok: true });
}
