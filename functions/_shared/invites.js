import { randomToken, sha256b64 } from "./crypto.js";
import { sendEmail, renderEmailHtml, orgEmailContext } from "./email.js";

export const INVITE_DAYS = 7;

/** New invitation token for a user: returns { token, hash, expires }. */
export async function newInvite() {
  const token = randomToken(32);
  return { token, hash: await sha256b64(token), expires: new Date(Date.now() + INVITE_DAYS * 86400000).toISOString() };
}

export async function sendInviteEmail(env, request, { email, name, organizationId, token, invitedBy }) {
  const org = await orgEmailContext(env, organizationId);
  const link = new URL("/accept-invite.html?token=" + encodeURIComponent(token), request.url).toString();
  const subject = `You're invited to ${org.orgName} on JelHR`;
  const text = `Hello ${name},\n\n${invitedBy || "Your administrator"} invited you to the ${org.orgName} workspace on JelHR.\n\nOpen this link to accept. We'll email you a 6-digit code to confirm it's you, then you'll choose a password:\n${link}\n\nThe invitation expires in ${INVITE_DAYS} days.`;
  const r = await sendEmail(env, { to: email, toName: name, subject, text, html: renderEmailHtml({ subject, text, orgName: org.orgName, footer: org.footer }), fromName: org.senderName });
  return { ...r, link };
}
