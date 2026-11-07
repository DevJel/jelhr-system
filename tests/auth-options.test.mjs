import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, client, setupOrg } from "./helpers.mjs";

test("public sign-in options expose only active workspace display and policy settings", async () => {
  const env = makeEnv();
  const { owner } = await setupOrg(env);
  await owner.patch("/api/settings", { auth: { identifiers: ["email", "username"], mfa: "admins", methods: ["totp", "email_otp"] } });
  const publicClient = client(env);
  const options = await publicClient.get("/api/auth/options?workspace=acme-people");
  assert.equal(options.status, 200);
  assert.equal(options.data.found, true);
  assert.equal(options.data.workspace.slug, "acme-people");
  assert.deepEqual(options.data.identifiers, ["email", "username"]);
  assert.equal(options.data.mfa.level, "admins");
  assert.deepEqual(options.data.mfa.methods, ["totp", "email_otp"]);
  assert.equal(options.data.passkey, false);
  assert.equal(options.data.sso.enabled, false);
  assert.equal("clientSecretEnc" in options.data.sso, false);
  assert.equal("users" in options.data, false);
  assert.equal("token" in options.data, false);
});

test("public sign-in options do not reveal unknown or inactive workspaces", async () => {
  const env = makeEnv();
  const { orgId } = await setupOrg(env);
  const publicClient = client(env);
  const missing = await publicClient.get("/api/auth/options?workspace=does-not-exist");
  assert.deepEqual(missing.data, { found: false });
  await env.DB.prepare("UPDATE organizations SET status='suspended' WHERE id=?").bind(orgId).run();
  const inactive = await publicClient.get("/api/auth/options?workspace=acme-people");
  assert.deepEqual(inactive.data, { found: false });
});

test("BFF email MFA response never contains the local test OTP", async () => {
  const env = makeEnv();
  await setupOrg(env);
  const user = client(env);
  const first = await user.post("/api/auth/login", { identifier: "owner@acme.test", password: "Correct-Horse-Battery-9" });
  await user.post("/api/mfa", { action: "totp_setup" });
  // Create an MFA challenge by enrolling a factor then signing in again.
  const second = client(env);
  const step = await second.post("/api/auth/login", { identifier: "owner@acme.test", password: "Correct-Horse-Battery-9" });
  assert.equal(step.data.mfaRequired, true);
  const sent = await second.post("/api/bff/auth/mfa", { action: "email", challengeId: step.data.challengeId });
  assert.equal(sent.status, 200);
  assert.equal(sent.data.sent, true);
  assert.equal("devCode" in sent.data, false);
});
