import { respond } from "../../_shared/http.js";
import { careersOrg, brandOf } from "../../_shared/public.js";
import { publicJob } from "../../_shared/recruitment.js";

// GET /api/public/careers?org=slug (or on the branded domain) — brand + open jobs.
export async function onRequestGet({ request, env }) {
  const { org, settings } = await careersOrg(env, request);
  const today = new Date().toISOString().slice(0, 10);
  const { results } = await env.DB.prepare("SELECT * FROM jobs WHERE organization_id=? AND status='open' AND (closes_at IS NULL OR closes_at>=?) ORDER BY published_at DESC").bind(org.id, today).all();
  return respond({ brand: brandOf(org, settings), jobs: (results || []).map(publicJob), turnstileSiteKey: env.TURNSTILE_SITE_KEY || null }, 200, { "Cache-Control": "public, max-age=60" });
}
