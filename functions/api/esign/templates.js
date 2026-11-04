import { requireFeature } from "../../_shared/features.js";
import { respond } from "../../_shared/http.js";
import { authenticate, HR_READ } from "../../_shared/auth.js";
import { TEMPLATES, CONSENT_TEXT } from "../../_shared/esign-templates.js";

export async function onRequestGet(context) {
  await authenticate(context, HR_READ);
  return respond({ templates: TEMPLATES, consentText: CONSENT_TEXT });
}
