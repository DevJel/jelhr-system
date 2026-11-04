import { respond } from "../../_shared/http.js";
import { requireUser, publicUser } from "../../_shared/auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(request, env, [], { allowPasswordChange: true });
  if (auth.error) {
    const status = auth.error.status;
    const body = await auth.error.json().catch(() => ({}));
    return respond({ authenticated: false, ...body }, status);
  }
  const user = auth.user;
  let employee = null;
  if (user.employee_id) {
    employee = await env.DB.prepare(
      "SELECT id, employee_number, first_name, last_name, email, job_title, department, employment_status, hire_date FROM employees WHERE id=?"
    ).bind(user.employee_id).first();
  }
  return respond({ authenticated: true, user: publicUser(user), employee });
}
