import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, client, setupOrg, PASSWORD } from "./helpers.mjs";

test("login issues a session; logout really revokes it", async () => {
  const env = makeEnv();
  const { owner } = await setupOrg(env);
  const me = await owner.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.data.user.role, "owner");
  const token = owner.jar.get("jelhr_session");
  const out = await owner.post("/api/auth/logout");
  assert.equal(out.status, 200);
  // Replay the old cookie: the server-side session must be revoked.
  const replay = client(env);
  replay.jar.set("jelhr_session", token);
  assert.equal((await replay.get("/api/auth/me")).status, 401);
});

test("passwords are stored with the Workers-compatible PBKDF2 format", async () => {
  const env = makeEnv();
  await setupOrg(env);
  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE email='owner@acme.test'").first();
  assert.match(row.password_hash, /^pbkdf2-sha256\$100000\$/);
});

test("wrong password, then rate limit after repeated failures", async () => {
  const env = makeEnv();
  await setupOrg(env);
  const c = client(env);
  let last;
  for (let i = 0; i < 9; i++) last = await c.post("/api/auth/login", { email: "owner@acme.test", password: "wrong-password-xx" });
  assert.equal(last.status, 429);
  const ok = client(env, {});
  // Same IP + email stays limited even with the right password.
  assert.equal((await ok.post("/api/auth/login", { email: "owner@acme.test", password: PASSWORD })).status, 429);
});

test("unknown email gets the same generic error", async () => {
  const env = makeEnv();
  await setupOrg(env);
  const r = await client(env).post("/api/auth/login", { email: "nobody@acme.test", password: "whatever-password" });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, "Those sign-in details are incorrect.");
});

test("new accounts must change their password before using the API", async () => {
  const env = makeEnv();
  const { platform, orgId } = await setupOrg(env);
  await platform.post(`/api/platform/organizations/${orgId}/admins`, { email: "admin2@acme.test", displayName: "Second Admin", role: "admin", password: "Temporary-Pass-1234" });
  const c = client(env);
  await c.post("/api/auth/login", { email: "admin2@acme.test", password: "Temporary-Pass-1234" });
  const blocked = await c.get("/api/employees");
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, "password_change_required");
  assert.equal((await c.get("/api/auth/me")).data.user.mustChangePassword, true);
  assert.equal((await c.post("/api/auth/password", { currentPassword: "Temporary-Pass-1234", newPassword: "short" })).status, 400);
  assert.equal((await c.post("/api/auth/password", { currentPassword: "Temporary-Pass-1234", newPassword: PASSWORD + "x" })).status, 200);
  assert.equal((await c.get("/api/employees")).status, 200);
});

test("cross-site state-changing requests are blocked", async () => {
  const env = makeEnv();
  const { owner } = await setupOrg(env);
  const evil = await owner.raw("POST", "/api/employees", { firstName: "X" }, { Origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  assert.equal(evil.data.error, "Cross-site request blocked");
  const wrongType = await owner.raw("POST", "/api/sessions", undefined, { "Content-Type": "text/plain", "Content-Length": "5" });
  assert.equal(wrongType.status, 415);
});

test("session listing and revoke others", async () => {
  const env = makeEnv();
  const { owner } = await setupOrg(env);
  const second = client(env);
  await second.post("/api/auth/login", { email: "owner@acme.test", password: PASSWORD });
  const list = await owner.get("/api/sessions");
  assert.equal(list.data.sessions.length, 2);
  assert.equal(list.data.sessions.filter(s => s.current).length, 1);
  await owner.post("/api/sessions", { action: "revoke_others" });
  assert.equal((await second.get("/api/auth/me")).status, 401);
  assert.equal((await owner.get("/api/auth/me")).status, 200);
});

test("unknown API routes return JSON 404 and bootstrap is retired", async () => {
  const env = makeEnv();
  const c = client(env);
  const r = await c.get("/api/does-not-exist");
  assert.equal(r.status, 404);
  assert.equal(r.data.error, "Not found");
  assert.equal((await c.post("/api/auth/bootstrap", {})).status, 410);
});
