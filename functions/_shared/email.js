// Outbound email. Providers:
//   ses  – Amazon SES v2 HTTPS API (SigV4-signed fetch). Recommended on Cloudflare.
//   smtp – any SMTP submission server over TCP sockets, incl. SES SMTP (email-smtp.<region>.amazonaws.com:465).
//   log  – development only: nothing leaves the system; disabled when JELHR_ENV=production.
import { signV4 } from "./sigv4.js";
import { smtpSend } from "./smtp.js";

export function emailStatus(env) {
  const provider = String(env.EMAIL_PROVIDER || "").toLowerCase();
  const from = env.EMAIL_FROM || "";
  if (provider === "ses") {
    const ok = Boolean(from && env.SES_REGION && env.SES_ACCESS_KEY_ID && env.SES_SECRET_ACCESS_KEY);
    return { provider, configured: ok, from: ok ? from : null, detail: ok ? `Amazon SES (${env.SES_REGION})` : "Set EMAIL_FROM, SES_REGION, SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY" };
  }
  if (provider === "smtp") {
    const ok = Boolean(from && env.SMTP_HOST && env.SMTP_USERNAME && env.SMTP_PASSWORD);
    return { provider, configured: ok, from: ok ? from : null, detail: ok ? `SMTP ${env.SMTP_HOST}:${env.SMTP_PORT || 465}` : "Set EMAIL_FROM, SMTP_HOST, SMTP_PORT, SMTP_USERNAME and SMTP_PASSWORD" };
  }
  if (provider === "log") {
    const ok = env.JELHR_ENV !== "production";
    return { provider, configured: ok, from: from || "no-reply@example.test", detail: ok ? "Development log mode — emails are recorded, not delivered" : "The log provider is disabled in production" };
  }
  return { provider: provider || null, configured: false, from: null, detail: "Email is not configured. Set EMAIL_PROVIDER to ses or smtp." };
}

const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Branded HTML version of a plain-text message. Text is escaped; paragraphs come from blank lines. */
export function renderEmailHtml({ subject, text, orgName, footer }) {
  const paragraphs = String(text).split(/\n{2,}/).map(p => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#e6e6e3;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#292929">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:28px;overflow:hidden">
<tr><td style="background:#292929;padding:22px 30px;color:#ffffff;font-size:20px;letter-spacing:-.5px">Jel<span style="color:#ffdb5d">HR</span>
<span style="float:right;font-size:11px;letter-spacing:2px;color:#c9c9c9;padding-top:6px">${escapeHtml(orgName || "").toUpperCase()}</span></td></tr>
<tr><td style="padding:30px 30px 10px"><h1 style="margin:0 0 18px;font-size:22px;font-weight:600;letter-spacing:-.4px">${escapeHtml(subject)}</h1>${paragraphs}</td></tr>
<tr><td style="padding:0 30px 26px"><div style="height:4px;width:64px;background:#ffdb5d;border-radius:4px"></div></td></tr>
<tr><td style="background:#f5edcf;padding:18px 30px;font-size:12px;line-height:1.5;color:#6b6a63">${escapeHtml(footer || "Sent by " + (orgName || "your organization") + " via JelHR.")}</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendSes(env, msg) {
  const region = env.SES_REGION;
  const url = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
  const payload = {
    FromEmailAddress: msg.fromName ? `"${msg.fromName.replace(/["\r\n]/g, "")}" <${msg.from}>` : msg.from,
    Destination: { ToAddresses: [msg.to] },
    ReplyToAddresses: msg.replyTo ? [msg.replyTo] : undefined,
    Content: { Simple: { Subject: { Data: msg.subject, Charset: "UTF-8" }, Body: { Text: { Data: msg.text, Charset: "UTF-8" }, Html: msg.html ? { Data: msg.html, Charset: "UTF-8" } : undefined } } },
    ConfigurationSetName: env.SES_CONFIGURATION_SET || undefined
  };
  const body = JSON.stringify(payload);
  const { headers } = await signV4({
    method: "POST", url, region, service: "ses", body,
    accessKeyId: env.SES_ACCESS_KEY_ID, secretAccessKey: env.SES_SECRET_ACCESS_KEY, sessionToken: env.SES_SESSION_TOKEN,
    headers: { "content-type": "application/json" }
  });
  const response = await (env.__fetch || fetch)(url, { method: "POST", headers, body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`SES ${response.status}: ${String(data.message || data.Message || "request failed").slice(0, 200)}`);
  return { id: data.MessageId || null };
}

/**
 * Send one email. Returns { ok, id?, error?, provider }.
 * Never throws: failures are returned so callers can record per-recipient status.
 */
export async function sendEmail(env, msg) {
  const status = emailStatus(env);
  if (!status.configured) return { ok: false, provider: status.provider, error: status.detail };
  const message = { ...msg, from: status.from, messageId: `${crypto.randomUUID()}@jelhr` };
  try {
    let result;
    if (status.provider === "ses") result = await sendSes(env, message);
    else if (status.provider === "smtp") {
      result = await smtpSend({
        host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, username: env.SMTP_USERNAME, password: env.SMTP_PASSWORD
      }, message, env.__connect);
    } else {
      console.log(JSON.stringify({ email: "logged", to: message.to, subject: message.subject }));
      result = { id: "log-" + crypto.randomUUID() };
    }
    return { ok: true, id: result.id, provider: status.provider };
  } catch (error) {
    return { ok: false, provider: status.provider, error: String(error?.message || error).slice(0, 300) };
  }
}

export async function orgEmailContext(env, organizationId) {
  const row = await env.DB.prepare("SELECT o.name, s.settings_json FROM organizations o LEFT JOIN organization_settings s ON s.organization_id=o.id WHERE o.id=?").bind(organizationId).first();
  let settings = {};
  try { settings = JSON.parse(row?.settings_json || "{}"); } catch {}
  return { orgName: row?.name || "", footer: settings.emailFooter || "", senderName: settings.senderName || row?.name || "JelHR", replyTo: settings.replyTo || "" };
}
