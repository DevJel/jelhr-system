import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, HR, HR_READ } from "../../_shared/auth.js";
import { requireFeature } from "../../_shared/features.js";
import { readJob } from "../../_shared/recruitment.js";
import * as v from "../../_shared/validate.js";

async function load(context, user) {
  const j = await context.env.DB.prepare("SELECT * FROM jobs WHERE id=? AND organization_id=?").bind(v.id(context.params.id), user.organization_id).first();
  if (!j) throw new HttpError(404, "Job not found");
  return j;
}

export async function onRequestGet(context) {
  const user = await authenticate(context, [...HR_READ, "manager"]);
  requireFeature(user, "recruitment");
  const j = await load(context, user);
  const { results } = await context.env.DB.prepare("SELECT stage, COUNT(*) AS n FROM applicants WHERE job_id=? GROUP BY stage").bind(j.id).all();
  return respond({ job: j, pipeline: Object.fromEntries((results || []).map(r => [r.stage, r.n])) });
}

export async function onRequestPatch(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "recruitment");
  const { env, request } = context;
  const j = await load(context, user);
  const b = await readJson(request, 64 * 1024);
  const fields = readJob(b, true);
  const now = new Date().toISOString();
  if (b.status !== undefined) {
    fields.status = v.oneOf(b.status, ["draft", "open", "closed"], "Status");
    if (fields.status === "open" && !j.published_at) fields.published_at = now;
  }
  if (b.hiringManagerId !== undefined) fields.hiring_manager_id = b.hiringManagerId || null;
  const cols = Object.keys(fields);
  if (!cols.length) throw new HttpError(400, "Nothing to update");
  await env.DB.batch([
    env.DB.prepare(`UPDATE jobs SET ${cols.map(c => c + "=?").join(",")}, updated_at=? WHERE id=?`).bind(...cols.map(c => fields[c]), now, j.id),
    await auditStatement(env, user, fields.status && fields.status !== j.status ? `job.${fields.status === "open" ? "published" : fields.status}` : "job.updated", "job", j.id, { fields: cols }, request)
  ]);
  return respond({ ok: true });
}

export async function onRequestDelete(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "recruitment");
  const { env, request } = context;
  const j = await load(context, user);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM applicants WHERE job_id=?").bind(j.id).first();
  if (n.n) throw new HttpError(409, "This job has applicants. Close it instead of deleting it.");
  await env.DB.batch([env.DB.prepare("DELETE FROM jobs WHERE id=?").bind(j.id), await auditStatement(env, user, "job.deleted", "job", j.id, { title: j.title }, request)]);
  return respond({ ok: true });
}
