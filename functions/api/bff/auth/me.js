import { respond } from "../../../_shared/http.js";
import { requireUser } from "../../../_shared/auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(request, env, [], { allowPasswordChange: true });
  if (auth.error) return respond({ authenticated: false }, 401);
  return respond({
    authenticated: true,
    user: {
      email: auth.user.email,
      displayName: auth.user.display_name,
      avatar: null
    }
  });
}
