// One-time email codes. Stored as HMAC(code) so a database leak doesn't reveal live codes.
import { hmacHex, randomDigits, safeEqual } from "./crypto.js";
import { sendEmail, renderEmailHtml, orgEmailContext } from "./email.js";
import { HttpError } from "./http.js";

const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const keyOf = env => "otp|" + (env.JELHR_JWT_SECRET || "");

export async function issueOtp(env, user, purpose) {
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM otp_codes WHERE user_id=? AND purpose=? AND created_at>?")
    .bind(user.id, purpose, new Date(Date.now() - 15 * 60000).toISOString()).first();
  if (recent.n >= 5) throw new HttpError(429, "Too many codes requested. Wait 15 minutes and try again.");
  const code = randomDigits(6);
  const id = crypto.randomUUID();
  const now = new Date();
  await env.DB.batch([
    env.DB.prepare("UPDATE otp_codes SET consumed_at=? WHERE user_id=? AND purpose=? AND consumed_at IS NULL").bind(now.toISOString(), user.id, purpose),
    env.DB.prepare("INSERT INTO otp_codes(id,user_id,purpose,code_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)")
      .bind(id, user.id, purpose, await hmacHex(keyOf(env), id + "|" + code), new Date(now.getTime() + TTL_MINUTES * 60000).toISOString(), now.toISOString())
  ]);
  const org = await orgEmailContext(env, user.organization_id);
  const subject = purpose === "invite" ? `Your ${org.orgName} JelHR invitation code` : `Your JelHR sign-in code`;
  const text = `Your verification code is ${code}\n\nIt expires in ${TTL_MINUTES} minutes. If you didn't request it, you can ignore this email — your account is safe.`;
  const mail = await sendEmail(env, { to: user.email, toName: user.display_name, subject, text, html: renderEmailHtml({ subject, text, orgName: org.orgName, footer: org.footer }), fromName: org.senderName });
  if (env.JELHR_ENV !== "production" && env.EMAIL_PROVIDER === "log") console.log(JSON.stringify({ devOtp: code, to: user.email, purpose }));
  return { sent: mail.ok, error: mail.ok ? undefined : mail.error, devCode: env.__exposeOtp ? code : undefined };
}

export async function verifyOtp(env, userId, purpose, code) {
  const row = await env.DB.prepare("SELECT * FROM otp_codes WHERE user_id=? AND purpose=? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1").bind(userId, purpose).first();
  if (!row || Date.parse(row.expires_at) < Date.now()) throw new HttpError(400, "The code has expired. Request a new one.");
  if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(429, "Too many wrong codes. Request a new one.");
  const ok = safeEqual(await hmacHex(keyOf(env), row.id + "|" + String(code || "").trim()), row.code_hash);
  if (!ok) {
    await env.DB.prepare("UPDATE otp_codes SET attempts=attempts+1 WHERE id=?").bind(row.id).run();
    throw new HttpError(400, "That code isn't right. Check the latest email and try again.");
  }
  await env.DB.prepare("UPDATE otp_codes SET consumed_at=? WHERE id=?").bind(new Date().toISOString(), row.id).run();
  return true;
}
