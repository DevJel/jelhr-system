import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, client, setupOrg, addEmployee, employeeLogin, SUPER, PASSWORD } from "./helpers.mjs";

test("super admin login uses secrets only and wrong credentials fail", async () => {
  const env = makeEnv();
  const c = client(env);
  assert.equal((await c.post("/api/platform/login", { email: SUPER.email, password: "nope-nope-nope-nope" })).status, 401);
  assert.equal((await c.get("/api/platform/me")).status, 401);
  assert.equal((await c.post("/api/platform/login", SUPER)).status, 200);
  assert.equal((await c.get("/api/platform/me")).data.role, "super_admin");
  // No user row exists for the super admin.
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email=?").bind(SUPER.email).first()).n, 0);
});

test("platform is unavailable when secrets are missing", async () => {
  const env = makeEnv({ JELHR_SUPERADMIN_PASSWORD: "" });
  assert.equal((await client(env).post("/api/platform/login", SUPER)).status, 503);
});

test("rotating the super admin email invalidates platform sessions", async () => {
  const env = makeEnv();
  const c = client(env);
  await c.post("/api/platform/login", SUPER);
  env.JELHR_SUPERADMIN_EMAIL = "new-platform@jelhr.test";
  assert.equal((await c.get("/api/platform/organizations")).status, 401);
});

test("only the super admin can create owner/admin accounts", async () => {
  const env = makeEnv();
  const { owner } = await setupOrg(env);
  const r = await owner.post("/api/users", { email: "sneaky@acme.test", displayName: "Sneaky", role: "admin", password: "Temporary-Pass-1234" });
  assert.equal(r.status, 400);
  const hr = await owner.post("/api/users", { email: "hr@acme.test", displayName: "HR Person", role: "hr_manager", password: "Temporary-Pass-1234" });
  assert.equal(hr.status, 201);
  // Tenant users cannot reach the platform API.
  assert.equal((await owner.get("/api/platform/organizations")).status, 401);
});

test("org admins cannot modify owner/admin accounts", async () => {
  const env = makeEnv();
  const { owner, platform, orgId } = await setupOrg(env);
  const a = await platform.post(`/api/platform/organizations/${orgId}/admins`, { email: "a2@acme.test", displayName: "A2", role: "admin", password: "Temporary-Pass-1234" });
  assert.equal((await owner.patch(`/api/users/${a.data.id}`, { status: "disabled" })).status, 403);
  // super admin can
  assert.equal((await platform.patch(`/api/platform/organizations/${orgId}/admins`, { userId: a.data.id, status: "disabled" })).status, 200);
});

test("the last active administrator cannot be disabled", async () => {
  const env = makeEnv();
  const { platform, orgId } = await setupOrg(env);
  const detail = await platform.get(`/api/platform/organizations/${orgId}`);
  const ownerId = detail.data.admins[0].id;
  assert.equal((await platform.patch(`/api/platform/organizations/${orgId}/admins`, { userId: ownerId, status: "disabled" })).status, 409);
});

test("tenant isolation: one organization cannot read another's records", async () => {
  const env = makeEnv();
  const a = await setupOrg(env, "Org A", "owner-a@a.test");
  const b = await setupOrg(env, "Org B", "owner-b@b.test");
  const empA = await addEmployee(a.owner, { email: "x@a.test" });
  assert.equal((await b.owner.get(`/api/employees/${empA}`)).status, 404);
  assert.equal((await b.owner.get("/api/employees")).data.employees.length, 0);
  assert.equal((await b.owner.patch(`/api/employees/${empA}`, { jobTitle: "Hacked" })).status, 404);
  assert.equal((await b.owner.post("/api/offboarding", { employeeId: empA, reason: "Resignation", lastWorkingDay: "2026-12-01" })).status, 404);
});

test("suspending an organization revokes access", async () => {
  const env = makeEnv();
  const { owner, platform, orgId } = await setupOrg(env);
  assert.equal((await platform.patch(`/api/platform/organizations/${orgId}`, { status: "suspended" })).status, 200);
  assert.equal((await owner.get("/api/employees")).status, 401);
  const again = client(env);
  await again.post("/api/auth/login", { email: "owner@acme.test", password: PASSWORD });
  assert.equal((await again.get("/api/employees")).status, 403);
});

test("employees only see their own workspace; auditors are read-only", async () => {
  const env = makeEnv();
  const { owner } = await setupOrg(env);
  const id = await addEmployee(owner);
  const other = await addEmployee(owner, { email: "other@acme.test", firstName: "Otto" });
  const { client: emp } = await employeeLogin(env, owner, id, "ella.login@acme.test");
  assert.equal((await emp.get("/api/employees")).status, 403);
  assert.equal((await emp.get(`/api/employees/${other}`)).status, 404);
  assert.equal((await emp.get(`/api/employees/${id}`)).status, 200);
  const audId = await addEmployee(owner, { email: "aud@acme.test", firstName: "Audrey" });
  const { client: aud } = await employeeLogin(env, owner, audId, "auditor@acme.test", "auditor");
  assert.equal((await aud.get("/api/employees")).status, 200);
  assert.equal((await aud.post("/api/employees", { firstName: "N" })).status, 403);
});
