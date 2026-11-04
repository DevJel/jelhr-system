import { respond } from "../../_shared/http.js";

// Retired. Organizations and their first administrators are now created by the
// platform super admin (see /api/platform/organizations and DEPLOYMENT.md).
export async function onRequestPost() {
  return respond({ error: "Bootstrap is retired. Sign in at /platform.html with the super admin secrets to create organizations." }, 410);
}
