import { respond } from "../../_shared/http.js";
import { secret } from "../../_shared/secrets.js";
// Return the public site key only. The verification secret remains server-side.
export async function onRequestGet({env}) {
  const siteKey=String(env.TURNSTILE_SITE_KEY||"");
  const secretKey=await secret(env,"TURNSTILE_SECRET_KEY");
  if(!siteKey||!secretKey)return respond({error:"Security verification is not configured."},503);
  return respond({turnstileSiteKey:siteKey});
}