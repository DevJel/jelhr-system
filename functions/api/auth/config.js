import { respond } from "../../_shared/http.js";
// Site keys are public. The fallback keeps the login widget renderable if a Pages
// environment variable is temporarily unavailable during a production rollout.
const FALLBACK_SITE_KEY = "0x4AAAAAAFkWaPgHqafVv66D";
export async function onRequestGet({env}) {
  const siteKey=String(env.TURNSTILE_SITE_KEY||FALLBACK_SITE_KEY);
  return respond({turnstileSiteKey:siteKey});
}
