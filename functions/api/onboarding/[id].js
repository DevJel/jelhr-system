import { requireFeature } from "../../_shared/features.js";
import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, isManagerOf, HR } from "../../_shared/auth.js";
import * as v from "../../_shared/validate.js";

async function load(context, user) {
  const t = await context.env.DB.prepare("SELECT * FROM onboarding_tasks WHERE id=? AND organization_id=?").bind(v.id(context.params.id), user.organization_id).first();
  if (!t) throw new HttpError(404, "Task not found");
  return t;
}

export async function onRequestPatch(context) {
  const user = await authenticate(context);
  requireFeature(user, "onboarding");
  const { env, request } = context;
  const t = await load(context, user);
  const allowed = HR.includes(user.role) || t.employee_id === user.employee_id || await isManagerOf(env, user, t.employee_id);
  if (!allowed) throw new HttpError(404, "Task not found");
  const b = await readJson(request, 4096);
  const now = new Date().toISOString();
  const statements = [];
  if (b.completed !== undefined) {
    statements.push(env.DB.prepare("UPDATE onboarding_tasks SET completed_at=?, completed_by=? WHERE id=?").bind(b.completed ? now : null, b.completed ? user.id : null, t.id));
  }
  if (HR.includes(user.role)) {
    if (b.title !== undefined) statements.push(env.DB.prepare("UPDATE onboarding_tasks SET title=? WHERE id=?").bind(v.text(b.title, "Title", { required: true, max: 160 }), t.id));
    if (b.dueDate !== undefined) statements.push(env.DB.prepare("UPDATE onboarding_tasks SET due_date=? WHERE id=?").bind(v.date(b.dueDate, "Due date"), t.id));
    if (b.ownerLabel !== undefined) statements.push(env.DB.prepare("UPDATE onboarding_tasks SET owner_label=? WHERE id=?").bind(v.text(b.ownerLabel, "Owner", { max: 60 }), t.id));
  }
  if (!statements.length) throw new HttpError(400, "Nothing to update");
  statements.push(await auditStatement(env, user, "onboarding.task_updated", "onboarding_task", t.id, { completed: b.completed }, request));
  await env.DB.batch(statements);
  return respond({ ok: true });
}

export async function onRequestDelete(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "onboarding");
  const { env, request } = context;
  const t = await load(context, user);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM onboarding_tasks WHERE id=?").bind(t.id),
    await auditStatement(env, user, "onboarding.task_deleted", "onboarding_task", t.id, { title: t.title }, request)
  ]);
  return respond({ ok: true });
}
