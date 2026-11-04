import { requireFeature } from "../../../_shared/features.js";
import { respond, readJson, HttpError } from "../../../_shared/http.js";
import { authenticate, auditStatement, HR, HR_READ } from "../../../_shared/auth.js";
import { templateById, renderTemplate } from "../../../_shared/esign-templates.js";
import { documentHash, signatureEvent } from "../../../_shared/esign.js";
import { sendEmail, renderEmailHtml, orgEmailContext } from "../../../_shared/email.js";
import * as v from "../../../_shared/validate.js";

const LIST_FIELDS = `r.id, r.title, r.template_id, r.status, r.due_date, r.created_at, r.viewed_at, r.signed_at, r.offboarding_case_id,
  r.employee_id, e.first_name || ' ' || e.last_name AS employee_name, e.employee_number, u.display_name AS created_by_name`;

export async function onRequestGet(context) {
  const user = await authenticate(context);
  requireFeature(user, "esign");
  const url = new URL(context.request.url);
  const binds = [user.organization_id];
  let where = "r.organization_id=?";
  const status = url.searchParams.get("status");
  if (status) { where += " AND r.status=?"; binds.push(v.oneOf(status, ["pending", "signed", "declined", "voided"], "status")); }
  const mine = url.searchParams.get("scope") === "mine" || !HR_READ.includes(user.role);
  if (mine) { where += " AND r.employee_id=?"; binds.push(user.employee_id || "-"); }
  const { results } = await context.env.DB.prepare(
    `SELECT ${LIST_FIELDS} FROM signature_requests r JOIN employees e ON e.id=r.employee_id LEFT JOIN users u ON u.id=r.created_by WHERE ${where} ORDER BY r.created_at DESC LIMIT 500`
  ).bind(...binds).all();
  return respond({ requests: results || [] });
}

export async function notifySigner(context, r, employeeEmail, employeeName, reminder = false) {
  const { env, request } = context;
  const org = await orgEmailContext(env, r.organization_id);
  const link = new URL("/sign.html?id=" + encodeURIComponent(r.id), request.url).toString();
  const subject = (reminder ? "Reminder: " : "") + `Please review and sign: ${r.title}`;
  const text = `Hello ${employeeName},\n\n${org.orgName} has asked you to review and electronically sign "${r.title}".${r.message ? `\n\nMessage from People Operations:\n${r.message}` : ""}\n\nSign in to JelHR to review the document:\n${link}\n\n${r.due_date ? `Please respond by ${r.due_date}.` : ""}`.trim();
  return sendEmail(env, { to: employeeEmail, toName: employeeName, subject, text, html: renderEmailHtml({ subject, text, orgName: org.orgName, footer: org.footer }), fromName: org.senderName, replyTo: org.replyTo || undefined });
}

export async function onRequestPost(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "esign");
  const { env, request } = context;
  const b = await readJson(request, 64 * 1024);
  const template = templateById(String(b.templateId || "custom"));
  if (!template) throw new HttpError(400, "Unknown template");
  const employee = await env.DB.prepare("SELECT * FROM employees WHERE id=? AND organization_id=?").bind(v.id(b.employeeId, "Employee"), user.organization_id).first();
  if (!employee) throw new HttpError(404, "Employee not found");
  if (employee.employment_status === "terminated") throw new HttpError(409, "Former employees can no longer sign in to sign documents");
  let kase = null, assets = [];
  if (b.offboardingCaseId) {
    kase = await env.DB.prepare("SELECT id, last_working_day, status FROM offboarding_cases WHERE id=? AND organization_id=? AND employee_id=?").bind(v.id(b.offboardingCaseId, "Case"), user.organization_id, employee.id).first();
    if (!kase) throw new HttpError(404, "Offboarding case not found for this employee");
    if (["completed", "cancelled"].includes(kase.status)) throw new HttpError(409, "This offboarding case is closed");
    assets = (await env.DB.prepare("SELECT asset_type, asset_tag, description, status FROM employee_assets WHERE organization_id=? AND (case_id=? OR employee_id=?)").bind(user.organization_id, kase.id, employee.id).all()).results || [];
  }
  const org = await env.DB.prepare("SELECT name FROM organizations WHERE id=?").bind(user.organization_id).first();
  const title = v.text(b.title || template.title, "Title", { required: true, max: 160 });
  const rawBody = b.body !== undefined && b.body !== "" ? v.text(b.body, "Document text", { required: true, max: 30000 }) : template.body;
  if (!rawBody) throw new HttpError(400, "Document text is required");
  const body = renderTemplate(rawBody, {
    employee: { fullName: `${employee.first_name} ${employee.last_name}`, number: employee.employee_number, jobTitle: employee.job_title, department: employee.department, email: employee.email },
    organization: { name: org.name },
    case: { lastWorkingDay: kase?.last_working_day },
    today: new Date().toISOString().slice(0, 10),
    assets: assets.length ? assets.map(a => `- ${a.asset_type}${a.asset_tag ? " (" + a.asset_tag + ")" : ""}${a.description ? ": " + a.description : ""} — ${a.status.replace("_", " ")}`).join("\n") : "- No company property recorded"
  });
  const r = {
    id: crypto.randomUUID(), organization_id: user.organization_id, employee_id: employee.id, title, body,
    created_at: new Date().toISOString(), message: v.text(b.message, "Message", { max: 1000 }) || null,
    due_date: v.date(b.dueDate, "Due date"), template_id: template.id
  };
  r.document_hash = await documentHash(r);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO signature_requests(id,organization_id,employee_id,offboarding_case_id,template_id,title,body,message,document_hash,status,due_date,created_by,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?,?,?)`)
      .bind(r.id, r.organization_id, r.employee_id, kase?.id || null, r.template_id, r.title, r.body, r.message, r.document_hash, r.due_date, user.id, r.created_at, r.created_at),
    await signatureEvent(env, request, r, "created", user.id),
    await auditStatement(env, user, "esign.request_created", "signature_request", r.id, { employeeId: employee.id, template: template.id, caseId: kase?.id || null }, request)
  ]);
  let email = { ok: false, error: "Notification not requested" };
  if (b.notify !== false) {
    email = await notifySigner(context, r, employee.email, `${employee.first_name} ${employee.last_name}`);
  }
  return respond({ id: r.id, documentHash: r.document_hash, notified: email.ok, notificationError: email.ok ? undefined : email.error, signerHasAccount: Boolean(employee.user_id) }, 201);
}
