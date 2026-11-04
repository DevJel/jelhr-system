import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, HR } from "../../_shared/auth.js";
import { requireFeature } from "../../_shared/features.js";
import { MODES, isoDateTime } from "./index.js";
import * as v from "../../_shared/validate.js";

async function load(context, user) {
  const i = await context.env.DB.prepare("SELECT * FROM interviews WHERE id=? AND organization_id=?").bind(v.id(context.params.id), user.organization_id).first();
  if (!i) throw new HttpError(404, "Interview not found");
  return i;
}

export async function onRequestPatch(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "recruitment");
  const { env, request } = context;
  const i = await load(context, user);
  const b = await readJson(request, 16384);
  const f = {};
  if (b.status !== undefined) f.status = v.oneOf(b.status, ["scheduled", "completed", "cancelled", "no_show"], "Status");
  if (b.rating !== undefined) f.rating = b.rating === null || b.rating === "" ? null : v.int(b.rating, "Rating", { min: 1, max: 5 });
  if (b.feedback !== undefined) f.feedback = v.text(b.feedback, "Feedback", { max: 8000 }) || null;
  if (b.scheduledAt !== undefined) f.scheduled_at = isoDateTime(b.scheduledAt, "Interview time");
  if (b.mode !== undefined) f.mode = v.oneOf(b.mode, MODES, "Format");
  if (b.location !== undefined) f.location = v.text(b.location, "Location or link", { max: 300 }) || null;
  if (b.interviewer !== undefined) f.interviewer = v.text(b.interviewer, "Interviewer", { max: 160 }) || null;
  const cols = Object.keys(f);
  if (!cols.length) throw new HttpError(400, "Nothing to update");
  await env.DB.batch([
    env.DB.prepare(`UPDATE interviews SET ${cols.map(c => c + "=?").join(",")}, updated_at=? WHERE id=?`).bind(...cols.map(c => f[c]), new Date().toISOString(), i.id),
    await auditStatement(env, user, f.status === "completed" ? "interview.completed" : "interview.updated", "applicant", i.applicant_id, { interviewId: i.id, status: f.status, rating: f.rating }, request)
  ]);
  return respond({ ok: true });
}

export async function onRequestDelete(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "recruitment");
  const { env, request } = context;
  const i = await load(context, user);
  await env.DB.batch([env.DB.prepare("DELETE FROM interviews WHERE id=?").bind(i.id), await auditStatement(env, user, "interview.deleted", "applicant", i.applicant_id, { interviewId: i.id }, request)]);
  return respond({ ok: true });
}
