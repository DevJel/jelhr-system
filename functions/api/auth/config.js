import { respond } from "../../_shared/http.js";
// The site key is public and is configured as a Pages production variable.
export async function onRequestGet({env}) {
  const siteKey=String(env.TURNSTILE_SITE_KEY||"");
  if(!siteKey)return respond({error:"Security verification is not configured."},503);
  return respond({turnstileSiteKey:siteKey});
}