import { respond, readJson } from "../../_shared/http.js";
import { authenticate, auditStatement, HR, HR_READ } from "../../_shared/auth.js";
import { requireFeature } from "../../_shared/features.js";
import { readJob } from "../../_shared/recruitment.js";

export async function onRequestGet(context) {
  const user = await authenticate(context, [...HR_READ, "manager"]);
  requireFeature(user, "recruitment");
  const { results } = await context.env.DB.prepare(
    `SELECT j.*, (SELECT COUNT(*) FROM applicants a WHERE a.job_id=j.id) AS applicant_count,
            (SELECT COUNT(*) FROM applicants a WHERE a.job_id=j.id AND a.stage='applied') AS new_count,
            m.first_name || ' ' || m.last_name AS hiring_manager_name
       FROM jobs j LEFT JOIN employees m ON m.id=j.hiring_manager_id WHERE j.organization_id=? ORDER BY CASE j.status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, j.created_at DESC`
  ).bind(user.organization_id).all();
  const org = await context.env.DB.prepare("SELECT slug, custom_domain FROM organizations WHERE id=?").bind(user.organization_id).first();
  const origin = new URL(context.request.url).origin;
  return respond({ jobs: results || [], careersUrl: org.custom_domain ? `https://${org.custom_domain}/careers.html` : `${origin}/careers.html?org=${org.slug}` });
}

export async function onRequestPost(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "recruitment");
  const { env, request } = context;
  const b = await readJson(request, 64 * 1024);
  const fields = readJob(b);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const status = b.status === "open" ? "open" : "draft";
  const row = { employment_type: "full_time", work_mode: "onsite", ...fields, id, organization_id: user.organization_id, status, published_at: status === "open" ? now : null, created_by: user.id, created_at: now, updated_at: now };
  if (b.hiringManagerId) row.hiring_manager_id = String(b.hiringManagerId);
  const cols = Object.keys(row);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO jobs(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`).bind(...cols.map(c => row[c] ?? null)),
    await auditStatement(env, user, "job.created", "job", id, { title: fields.title, status }, request)
  ]);
  return respond({ id, status }, 201);
}
