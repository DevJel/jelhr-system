import { requireFeature } from "../../../_shared/features.js";
import { respond, readJson, HttpError } from "../../../_shared/http.js";
import { authenticate, auditStatement, isManagerOf, HR, HR_READ, ADMIN } from "../../../_shared/auth.js";
import { revokeUserSessions } from "../../../_shared/users.js";
import * as v from "../../../_shared/validate.js";

const TASK_STATUSES = ["pending", "in_progress", "completed", "blocked", "not_applicable"];

export async function loadCase(context, user) {
  const c = await context.env.DB.prepare(
    `SELECT c.*, e.employee_number, e.first_name, e.last_name, e.email, e.job_title, e.department, e.user_id AS employee_user_id, e.manager_id
       FROM offboarding_cases c JOIN employees e ON e.id=c.employee_id WHERE c.id=? AND c.organization_id=?`
  ).bind(v.id(context.params.id), user.organization_id).first();
  if (!c) throw new HttpError(404, "Case not found");
  if (!HR_READ.includes(user.role) && !(await isManagerOf(context.env, user, c.employee_id))) throw new HttpError(404, "Case not found");
  return c;
}

export async function onRequestGet(context) {
  const user = await authenticate(context, [...HR_READ, "manager"]);
  requireFeature(user, "offboarding");
  const { env } = context;
  const c = await loadCase(context, user);
  const [tasks, assets, signatures, events] = await Promise.all([
    env.DB.prepare(`SELECT t.*, u.display_name AS completed_by_name FROM offboarding_tasks t LEFT JOIN users u ON u.id=t.completed_by WHERE t.case_id=? ORDER BY t.sort_order, t.created_at`).bind(c.id).all(),
    env.DB.prepare("SELECT * FROM employee_assets WHERE organization_id=? AND (case_id=? OR (employee_id=? AND status='assigned')) ORDER BY created_at").bind(user.organization_id, c.id, c.employee_id).all(),
    env.DB.prepare("SELECT id, title, template_id, status, created_at, signed_at, due_date FROM signature_requests WHERE offboarding_case_id=? AND organization_id=? ORDER BY created_at").bind(c.id, user.organization_id).all(),
    env.DB.prepare(
      `SELECT a.action, a.resource_type, a.metadata_json, a.created_at, u.display_name AS actor_name
         FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id
        WHERE a.organization_id=? AND (a.resource_id=? OR a.resource_id IN (SELECT id FROM offboarding_tasks WHERE case_id=?) OR a.resource_id IN (SELECT id FROM employee_assets WHERE case_id=?))
        ORDER BY a.created_at DESC LIMIT 200`
    ).bind(user.organization_id, c.id, c.id, c.id).all()
  ]);
  return respond({ case: c, tasks: tasks.results || [], assets: assets.results || [], signatures: signatures.results || [], events: events.results || [] });
}

export async function onRequestPatch(context) {
  const user = await authenticate(context, [...HR, "manager"]);
  requireFeature(user, "offboarding");
  const { env, request } = context;
  const c = await loadCase(context, user);
  const b = await readJson(request, 16384);
  const now = new Date().toISOString();
  const closed = ["completed", "cancelled"].includes(c.status);
  const hr = HR.includes(user.role);

  if (b.taskId) {
    if (closed) throw new HttpError(409, "This case is closed");
    const t = await env.DB.prepare("SELECT id, owner_role FROM offboarding_tasks WHERE id=? AND case_id=?").bind(v.id(b.taskId, "taskId"), c.id).first();
    if (!t) throw new HttpError(404, "Task not found");
    if (!hr && t.owner_role !== "manager") throw new HttpError(403, "Managers can update knowledge-transfer tasks only");
    const status = v.oneOf(b.status, TASK_STATUSES, "Task status");
    const note = b.evidenceNote === undefined ? null : v.text(b.evidenceNote, "Evidence note", { max: 2000 });
    if (status === "blocked" && !note && b.evidenceNote !== undefined) throw new HttpError(400, "Explain what is blocking this task");
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE offboarding_tasks SET status=?, evidence_note=COALESCE(?, evidence_note),
           completed_by=CASE WHEN ? IN ('completed','not_applicable') THEN ? ELSE NULL END,
           completed_at=CASE WHEN ? IN ('completed','not_applicable') THEN ? ELSE NULL END, updated_at=? WHERE id=?`
      ).bind(status, note, status, user.id, status, now, now, t.id),
      env.DB.prepare("UPDATE offboarding_cases SET updated_at=? WHERE id=?").bind(now, c.id),
      await auditStatement(env, user, "offboarding.task_updated", "offboarding_task", t.id, { status }, request)
    ]);
    return respond({ ok: true });
  }

  if (!hr) throw new HttpError(403, "Insufficient permission");
  const statements = [];
  const changed = [];
  if (!b.action) {
    if (closed) throw new HttpError(409, "This case is closed");
    if (b.exitInterviewStatus !== undefined) { statements.push(env.DB.prepare("UPDATE offboarding_cases SET exit_interview_status=? WHERE id=?").bind(v.oneOf(b.exitInterviewStatus, ["pending", "scheduled", "completed", "declined"], "Exit interview status"), c.id)); changed.push("exit_interview_status"); }
    if (b.exitInterviewAt !== undefined) { statements.push(env.DB.prepare("UPDATE offboarding_cases SET exit_interview_at=? WHERE id=?").bind(b.exitInterviewAt ? v.text(b.exitInterviewAt, "Interview time", { max: 30 }) : null, c.id)); changed.push("exit_interview_at"); }
    if (b.exitInterviewNotes !== undefined) { statements.push(env.DB.prepare("UPDATE offboarding_cases SET exit_interview_notes=? WHERE id=?").bind(v.text(b.exitInterviewNotes, "Interview notes", { max: 8000 }), c.id)); changed.push("exit_interview_notes"); }
    if (b.rehireEligible !== undefined) { statements.push(env.DB.prepare("UPDATE offboarding_cases SET rehire_eligible=? WHERE id=?").bind(v.oneOf(b.rehireEligible, ["yes", "no", "review"], "Rehire eligibility", { required: false }), c.id)); changed.push("rehire_eligible"); }
    if (b.finalPayStatus !== undefined) { statements.push(env.DB.prepare("UPDATE offboarding_cases SET final_pay_status=? WHERE id=?").bind(v.oneOf(b.finalPayStatus, ["pending", "processing", "completed", "not_applicable"], "Final pay status"), c.id)); changed.push("final_pay_status"); }
    if (b.notes !== undefined) { statements.push(env.DB.prepare("UPDATE offboarding_cases SET notes=? WHERE id=?").bind(v.text(b.notes, "Notes", { max: 4000 }), c.id)); changed.push("notes"); }
    if (b.lastWorkingDay !== undefined) { statements.push(env.DB.prepare("UPDATE offboarding_cases SET last_working_day=? WHERE id=?").bind(v.date(b.lastWorkingDay, "Last working day", { required: true }), c.id)); changed.push("last_working_day"); }
    if (!statements.length) throw new HttpError(400, "Nothing to update");
    statements.push(env.DB.prepare("UPDATE offboarding_cases SET updated_at=? WHERE id=?").bind(now, c.id));
    statements.push(await auditStatement(env, user, "offboarding.case_updated", "offboarding_case", c.id, { fields: changed }, request));
    await env.DB.batch(statements);
    return respond({ ok: true });
  }

  const blockers = async () => {
    const [tasks, sigs, assets] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS n FROM offboarding_tasks WHERE case_id=? AND status NOT IN ('completed','not_applicable')").bind(c.id).first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM signature_requests WHERE offboarding_case_id=? AND status='pending'").bind(c.id).first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM employee_assets WHERE organization_id=? AND (case_id=? OR employee_id=?) AND status='assigned'").bind(user.organization_id, c.id, c.employee_id).first()
    ]);
    const list = [];
    if (tasks.n) list.push(`${tasks.n} checklist task(s) still open`);
    if (sigs.n) list.push(`${sigs.n} signature request(s) still pending`);
    if (assets.n) list.push(`${assets.n} asset(s) not yet returned or resolved`);
    if (!["completed", "not_applicable"].includes(c.final_pay_status)) list.push("final pay is not marked completed or not applicable");
    return list;
  };

  switch (b.action) {
    case "submit": {
      if (c.status !== "in_progress") throw new HttpError(409, "Only in-progress cases can be submitted");
      const list = await blockers();
      if (list.length) throw new HttpError(409, "Resolve before submitting: " + list.join("; "), { blockers: list });
      statements.push(env.DB.prepare("UPDATE offboarding_cases SET status='pending_approval', submitted_at=?, updated_at=? WHERE id=?").bind(now, now, c.id));
      break;
    }
    case "reopen": {
      if (c.status !== "pending_approval") throw new HttpError(409, "Only cases awaiting approval can be reopened");
      statements.push(env.DB.prepare("UPDATE offboarding_cases SET status='in_progress', submitted_at=NULL, updated_at=? WHERE id=?").bind(now, c.id));
      break;
    }
    case "cancel": {
      if (closed) throw new HttpError(409, "This case is already closed");
      const reason = v.text(b.reason, "Cancellation reason", { required: true, max: 1000 });
      statements.push(
        env.DB.prepare("UPDATE offboarding_cases SET status='cancelled', cancelled_reason=?, updated_at=? WHERE id=?").bind(reason, now, c.id),
        env.DB.prepare("UPDATE employees SET employment_status='active', updated_at=? WHERE id=? AND employment_status='offboarding'").bind(now, c.employee_id),
        env.DB.prepare("UPDATE signature_requests SET status='voided', voided_reason='Offboarding case cancelled', voided_by=?, updated_at=? WHERE offboarding_case_id=? AND status='pending'").bind(user.id, now, c.id)
      );
      break;
    }
    case "complete": {
      if (!ADMIN.includes(user.role)) throw new HttpError(403, "Only an owner or admin can finalize this case");
      if (closed) throw new HttpError(409, "This case is already closed");
      const list = await blockers();
      if (list.length) throw new HttpError(409, "Cannot finalize: " + list.join("; "), { blockers: list });
      statements.push(
        env.DB.prepare("UPDATE offboarding_cases SET status='completed', completed_at=?, approved_by=?, updated_at=? WHERE id=?").bind(now, user.id, now, c.id),
        env.DB.prepare("UPDATE employees SET employment_status='terminated', updated_at=? WHERE id=?").bind(now, c.employee_id)
      );
      if (c.employee_user_id) {
        statements.push(env.DB.prepare("UPDATE users SET status='disabled', updated_at=? WHERE id=?").bind(now, c.employee_user_id), revokeUserSessions(env, c.employee_user_id));
      }
      break;
    }
    default:
      throw new HttpError(400, "Unknown action");
  }
  statements.push(await auditStatement(env, user, `offboarding.${b.action === "complete" ? "completed" : b.action === "cancel" ? "cancelled" : b.action === "submit" ? "submitted" : "reopened"}`, "offboarding_case", c.id, b.reason ? { reason: b.reason } : null, request));
  await env.DB.batch(statements);
  return respond({ ok: true });
}
