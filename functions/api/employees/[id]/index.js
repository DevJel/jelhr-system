import { respond, readJson, HttpError } from "../../../_shared/http.js";
import { authenticate, auditStatement, isManagerOf, HR, HR_READ } from "../../../_shared/auth.js";
import { EMPLOYEE_FIELDS, readEmployeeInput } from "../index.js";
import * as v from "../../../_shared/validate.js";

export async function loadEmployee(env, user, id) {
  const e = await env.DB.prepare(`SELECT ${EMPLOYEE_FIELDS} FROM employees e LEFT JOIN employees m ON m.id=e.manager_id WHERE e.id=? AND e.organization_id=?`)
    .bind(v.id(id), user.organization_id).first();
  if (!e) throw new HttpError(404, "Employee not found");
  return e;
}

export async function onRequestGet(context) {
  const user = await authenticate(context);
  const { env, params } = context;
  const e = await loadEmployee(env, user, params.id);
  const allowed = HR_READ.includes(user.role) || e.id === user.employee_id || await isManagerOf(env, user, e.id);
  if (!allowed) throw new HttpError(404, "Employee not found");
  const [assets, account] = await Promise.all([
    env.DB.prepare("SELECT id, asset_type, asset_tag, description, status, returned_at, condition_note FROM employee_assets WHERE employee_id=? AND organization_id=? ORDER BY created_at").bind(e.id, user.organization_id).all(),
    HR_READ.includes(user.role) && e.user_id ? env.DB.prepare("SELECT id, email, role, status, last_login_at FROM users WHERE id=?").bind(e.user_id).first() : null
  ]);
  if (!HR.includes(user.role) && e.id !== user.employee_id) { delete e.personal_email; delete e.phone; }
  return respond({ employee: e, assets: assets.results || [], account });
}

export async function onRequestPatch(context) {
  const user = await authenticate(context, HR);
  const { env, params, request } = context;
  const existing = await loadEmployee(env, user, params.id);
  const b = await readJson(request, 16384);
  const fields = await readEmployeeInput(env, user, b, existing);
  const cols = Object.keys(fields);
  if (!cols.length) throw new HttpError(400, "Nothing to update");
  await env.DB.batch([
    env.DB.prepare(`UPDATE employees SET ${cols.map(c => c + "=?").join(",")}, updated_at=? WHERE id=? AND organization_id=?`)
      .bind(...cols.map(c => fields[c]), new Date().toISOString(), existing.id, user.organization_id),
    await auditStatement(env, user, "employee.updated", "employee", existing.id, { fields: cols }, request)
  ]);
  return respond({ ok: true });
}
