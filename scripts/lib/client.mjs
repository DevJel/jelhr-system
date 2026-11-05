import { D1Shim } from "./d1-shim.mjs";
import { createRouter } from "./router.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ORIGIN = "https://jelhr.test";
export const SUPER = { email: "platform@jelhr.test", password: "Platform-Secret-Passphrase-01" };
export const PASSWORD = "Correct-Horse-Battery-9";

let routerPromise;
export const router = () => (routerPromise ||= createRouter(join(root, "functions")));

export function makeEnv(extra = {}) {
  const DB = new D1Shim().migrate(join(root, "migrations"));
  return {
    DB,
    JELHR_JWT_SECRET: "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
    JELHR_SUPERADMIN_EMAIL: SUPER.email,
    JELHR_SUPERADMIN_PASSWORD: SUPER.password,
    EMAIL_PROVIDER: "log",
    EMAIL_FROM: "hr@jelhr.test",
    __exposeOtp: true, // test harness only: return dev OTPs so integration tests can complete MFA
    ...extra
  };
}

/** A cookie-keeping API client that behaves like a same-origin browser. */
export function client(env, { origin = ORIGIN } = {}) {
  const jar = new Map();
  const call = async (method, path, body, headers = {}) => {
    const h = new Headers({ "Sec-Fetch-Site": "same-origin", "CF-Connecting-IP": "203.0.113.7", "User-Agent": "jelhr-tests", ...headers });
    if (origin && !h.has("Origin")) h.set("Origin", origin);
    if (jar.size) h.set("Cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    let payload;
    if (body !== undefined) { payload = JSON.stringify(body); h.set("Content-Type", "application/json"); h.set("Content-Length", String(payload.length)); }
    const req = new Request(ORIGIN + path, { method, headers: h, body: payload });
    const handle = await router();
    const res = await handle(req, env);
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(";");
      const [k, ...v] = pair.split("=");
      const value = v.join("=");
      if (/Max-Age=0/.test(c) || !value) jar.delete(k); else jar.set(k, value);
    }
    const data = await res.json().catch(() => null);
    return { status: res.status, data, headers: res.headers };
  };
  return {
    jar,
    get: (p, h) => call("GET", p, undefined, h),
    post: (p, b = {}, h) => call("POST", p, b, h),
    patch: (p, b = {}, h) => call("PATCH", p, b, h),
    del: (p, h) => call("DELETE", p, undefined, h),
    raw: call
  };
}

/** Super admin creates an organization and its owner; returns signed-in owner client (password already changed). */
export async function setupOrg(env, name = "Acme People", ownerEmail = "owner@acme.test") {
  const platform = client(env);
  const login = await platform.post("/api/platform/login", { email: env.JELHR_SUPERADMIN_EMAIL, password: env.JELHR_SUPERADMIN_PASSWORD });
  if (login.status !== 200) throw new Error("platform login failed " + JSON.stringify(login.data));
  const org = await platform.post("/api/platform/organizations", { name, adminEmail: ownerEmail, adminName: "Olivia Owner", adminPassword: "Temporary-Pass-1234", adminRole: "owner" });
  if (org.status !== 201) throw new Error("org create failed " + JSON.stringify(org.data));
  const owner = client(env);
  const firstFactor = await owner.post("/api/auth/login", { email: ownerEmail, password: "Temporary-Pass-1234" });
  if (firstFactor.status !== 200) throw new Error("owner login failed " + JSON.stringify(firstFactor.data));
  if (firstFactor.data?.mfaRequired) {
    const sent = await owner.post("/api/auth/mfa", { action: "email", challengeId: firstFactor.data.challengeId });
    const verified = await owner.post("/api/auth/mfa", { action: "verify", challengeId: firstFactor.data.challengeId, method: "email_otp", code: sent.data?.devCode });
    if (verified.status !== 200) throw new Error("owner MFA failed " + JSON.stringify(verified.data));
  }
  const pw = await owner.post("/api/auth/password", { currentPassword: "Temporary-Pass-1234", newPassword: PASSWORD });
  if (pw.status !== 200) throw new Error("password change failed " + JSON.stringify(pw.data));
  return { platform, owner, orgId: org.data.id };
}

export async function addEmployee(owner, overrides = {}) {
  const r = await owner.post("/api/employees", { firstName: "Ella", lastName: "Employee", email: "ella@acme.test", jobTitle: "Analyst", department: "Finance", hireDate: "2026-01-05", employmentStatus: "active", ...overrides });
  if (r.status !== 201) throw new Error("employee create failed " + JSON.stringify(r.data));
  return r.data.id;
}

/** Create a sign-in for an employee and return a signed-in client with password changed. */
export async function employeeLogin(env, owner, employeeId, email, role = "employee") {
  const emp = (await owner.get(`/api/employees/${employeeId}`)).data?.employee;
  const u = await owner.post("/api/users", { email, displayName: emp ? `${emp.first_name} ${emp.last_name}` : email.split("@")[0], role, employeeId, password: "Temporary-Pass-1234" });
  if (u.status !== 201) throw new Error("user create failed " + JSON.stringify(u.data));
  const c = client(env);
  const firstFactor = await c.post("/api/auth/login", { email, password: "Temporary-Pass-1234" });
  if (firstFactor.status !== 200) throw new Error("employee login failed " + JSON.stringify(firstFactor.data));
  if (firstFactor.data?.mfaRequired) {
    const sent = await c.post("/api/auth/mfa", { action: "email", challengeId: firstFactor.data.challengeId });
    const verified = await c.post("/api/auth/mfa", { action: "verify", challengeId: firstFactor.data.challengeId, method: "email_otp", code: sent.data?.devCode });
    if (verified.status !== 200) throw new Error("employee MFA failed " + JSON.stringify(verified.data));
  }
  await c.post("/api/auth/password", { currentPassword: "Temporary-Pass-1234", newPassword: PASSWORD });
  return { client: c, userId: u.data.id };
}
