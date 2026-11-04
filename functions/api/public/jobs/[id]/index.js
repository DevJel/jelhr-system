import { respond, HttpError } from "../../../../_shared/http.js";
import { careersOrg, brandOf } from "../../../../_shared/public.js";
import { publicJob } from "../../../../_shared/recruitment.js";
import * as v from "../../../../_shared/validate.js";

export async function openJob(env, orgId, id) {
  const j = await env.DB.prepare("SELECT * FROM jobs WHERE id=? AND organization_id=? AND status='open'").bind(v.id(id), orgId).first();
  if (!j || (j.closes_at && j.closes_at < new Date().toISOString().slice(0, 10))) throw new HttpError(404, "This job is no longer open");
  return j;
}

export async function onRequestGet({ request, env, params }) {
  const { org, settings } = await careersOrg(env, request);
  return respond({ brand: brandOf(org, settings), job: publicJob(await openJob(env, org.id, params.id)), turnstileSiteKey: env.TURNSTILE_SITE_KEY || null });
}
