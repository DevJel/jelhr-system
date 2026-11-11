import { requireFeature } from "../../_shared/features.js";
import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, isManagerOf, HR } from "../../_shared/auth.js";
import * as v from "../../_shared/validate.js";

export async function onRequestPatch(context) {
  const user = await authenticate(context);
  requireFeature(user, "time");
  const { env, request, params } = context;
  const t = await env.DB.prepare("SELECT * FROM time_entries WHERE id=? AND organization_id=?").bind(v.id(params.id), user.organization_id).first();
  if (!t) throw new HttpError(404, "Entry not found");
  const b = await readJson(request, 4096);
  const now = new Date().toISOString();
  if (b.approvalStatus !== undefined) {
    const allowed = HR.includes(user.role) || await isManagerOf(env, user, t.employee_id);
    if (!allowed) throw new HttpError(403, "Only HR or the employee's manager can approve time");
    if (t.employee_id === user.employee_id) throw new HttpError(403, "You cannot approve your own time");
    if (!t.ended_at) throw new HttpError(409, "The entry is still open");
    const status = v.oneOf(b.approvalStatus, ["pending", "approved", "rejected"], "Approval status");
    await env.DB.batch([
      env.DB.prepare("UPDATE time_entries SET approval_status=?, approved_by=?, approved_at=? WHERE id=?").bind(status, status === "pending" ? null : user.id, status === "pending" ? null : now, t.id),
      await auditStatement(env, user, "time.reviewed", "time_entry", t.id, { status }, request)
    ]);
    return respond({ ok: true });
  }
  if (t.employee_id !== user.employee_id) throw new HttpError(403, "You can only edit your own entries");
  if (t.approval_status !== "pending") throw new HttpError(409, "Reviewed entries cannot be edited");
  const note = b.note !== undefined ? v.text(b.note, "Note", { max: 300 }) : t.note;
  const elapsed = Math.max(0, Math.floor((Date.parse(t.ended_at || now) - Date.parse(t.started_at)) / 60000));
  const breakMinutes = b.breakMinutes !== undefined ? v.int(b.breakMinutes, "Break minutes", { min: 0, max: Math.min(24 * 60, elapsed) }) : t.break_minutes;
  await env.DB.batch([
    env.DB.prepare("UPDATE time_entries SET note=?, break_minutes=? WHERE id=?").bind(note, breakMinutes, t.id),
    await auditStatement(env, user, "time.edited", "time_entry", t.id, null, request)
  ]);
  return respond({ ok: true });
}
