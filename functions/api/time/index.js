import { requireFeature } from "../../_shared/features.js";
import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, isManagerOf, HR_READ } from "../../_shared/auth.js";
import * as v from "../../_shared/validate.js";

export async function onRequestGet(context) {
  const user = await authenticate(context);
  requireFeature(user, "time");
  const { env } = context;
  const url = new URL(context.request.url);
  const from = v.date(url.searchParams.get("from"), "from") || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = v.date(url.searchParams.get("to"), "to");
  const scope = url.searchParams.get("scope");
  const employeeId = url.searchParams.get("employeeId");
  const binds = [user.organization_id, from + "T00:00:00.000Z"];
  let where = "t.organization_id=? AND t.started_at>=?";
  if (to) { where += " AND t.started_at<?"; binds.push(to + "T23:59:59.999Z"); }
  if (employeeId) {
    const id = v.id(employeeId, "employeeId");
    if (!(HR_READ.includes(user.role) || id === user.employee_id || await isManagerOf(env, user, id))) throw new HttpError(403, "Insufficient permission");
    where += " AND t.employee_id=?"; binds.push(id);
  } else if (scope === "team") {
    if (user.role === "manager") { where += " AND e.manager_id=?"; binds.push(user.employee_id || "-"); }
    else if (!HR_READ.includes(user.role)) throw new HttpError(403, "Insufficient permission");
  } else {
    where += " AND t.employee_id=?"; binds.push(user.employee_id || "-");
  }
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.employee_id, t.started_at, t.ended_at, t.break_minutes, t.note, t.approval_status, t.approved_at,
            e.first_name || ' ' || e.last_name AS employee_name, e.employee_number
       FROM time_entries t JOIN employees e ON e.id=t.employee_id WHERE ${where} ORDER BY t.started_at DESC LIMIT 1000`
  ).bind(...binds).all();
  const open = user.employee_id ? await env.DB.prepare("SELECT id, started_at, note FROM time_entries WHERE employee_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1").bind(user.employee_id).first() : null;
  return respond({ entries: results || [], open: open || null, hasEmployeeRecord: Boolean(user.employee_id) });
}

export async function onRequestPost(context) {
  const user = await authenticate(context);
  requireFeature(user, "time");
  const { env, request } = context;
  if (!user.employee_id) throw new HttpError(409, "Your account is not linked to an employee record, so time cannot be recorded");
  const b = await readJson(request, 4096);
  const now = new Date().toISOString();
  const open = await env.DB.prepare("SELECT id, started_at FROM time_entries WHERE employee_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1").bind(user.employee_id).first();
  if (b.action === "clock_in") {
    if (open) throw new HttpError(409, "You are already clocked in");
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO time_entries(id,organization_id,employee_id,started_at,note) VALUES(?,?,?,?,?)").bind(id, user.organization_id, user.employee_id, now, v.text(b.note, "Note", { max: 300 }) || null),
      await auditStatement(env, user, "time.clock_in", "time_entry", id, null, request)
    ]);
    return respond({ id, startedAt: now }, 201);
  }
  if (b.action === "clock_out") {
    if (!open) throw new HttpError(409, "You are not clocked in");
    const worked = Math.floor((Date.now() - Date.parse(open.started_at)) / 60000);
    const breakMinutes = v.int(b.breakMinutes, "Break minutes", { min: 0, max: Math.max(0, worked), fallback: 0 });
    await env.DB.batch([
      env.DB.prepare("UPDATE time_entries SET ended_at=?, break_minutes=?, note=COALESCE(?, note) WHERE id=?").bind(now, breakMinutes, v.text(b.note, "Note", { max: 300 }) || null, open.id),
      await auditStatement(env, user, "time.clock_out", "time_entry", open.id, { breakMinutes }, request)
    ]);
    return respond({ id: open.id, endedAt: now });
  }
  throw new HttpError(400, "Unknown action");
}
