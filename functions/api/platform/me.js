import { respond } from "../../_shared/http.js";
import { requireSuperAdmin } from "../../_shared/platform.js";

export async function onRequestGet(context) {
  const admin = await requireSuperAdmin(context);
  return respond({ authenticated: true, email: admin.email, role: "super_admin" });
}
