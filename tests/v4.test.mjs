import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, client, setupOrg, addEmployee, employeeLogin, PASSWORD, SUPER } from "./helpers.mjs";
import { totpCode, b64url } from "../functions/_shared/crypto.js";

const PDF = { name: "cv.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 example resume").toString("base64") };
const env4 = (x = {}) => makeEnv({ AI_PROVIDER: "mock", __exposeOtp: true, ...x });

test("recruitment: publish job, public apply, interview, hire into employee with paperwork", async () => {
  const env = env4();
  const { owner } = await setupOrg(env);
  const job = await owner.post("/api/jobs", { title: "Data Analyst", department: "Finance", description: "Analyse things", status: "open", workMode: "hybrid" });
  assert.equal(job.status, 201);
  const pub = client(env);
  const careers = await pub.get("/api/public/careers?org=acme-people");
  assert.equal(careers.status, 200);
  assert.equal(careers.data.jobs.length, 1);
  const apply = await pub.post(`/api/public/jobs/${job.data.id}/apply?org=acme-people`, { firstName: "Ana", lastName: "Lim", email: "ana@mail.test", resume: PDF, privacyAccepted: true, coverLetter: "Hello" });
  assert.equal(apply.status, 201, JSON.stringify(apply.data));
  assert.equal((await pub.post(`/api/public/jobs/${job.data.id}/apply?org=acme-people`, { firstName: "Ana", lastName: "Lim", email: "ana@mail.test", resume: PDF, privacyAccepted: true })).status, 409);
  const fake = { ...PDF, data: Buffer.from("not a pdf").toString("base64") };
  assert.equal((await pub.post(`/api/public/jobs/${job.data.id}/apply?org=acme-people`, { firstName: "B", lastName: "C", email: "b@mail.test", resume: fake, privacyAccepted: true })).status, 415);
  const appId = apply.data.id;
  const iv = await owner.post("/api/interviews", { applicantId: appId, scheduledAt: "2026-12-01T10:00", mode: "video", notifyCandidate: true });
  assert.equal(iv.status, 201);
  assert.equal((await owner.get(`/api/applicants/${appId}`)).data.applicant.stage, "interview");
  const screen = await owner.post("/api/ai", { task: "screen_applicant", applicantId: appId });
  assert.equal(screen.status, 200);
  assert.ok(screen.data.screening.fit >= 1);
  const stats = await owner.get("/api/recruitment/stats");
  assert.equal(stats.data.pipeline.interviewed, 1);
  const hire = await owner.post(`/api/applicants/${appId}/hire`, { hireDate: "2026-12-15", invite: true, workEmail: "ana@acme.test" });
  assert.equal(hire.status, 201, JSON.stringify(hire.data));
  const docs = await owner.get(`/api/employees/${hire.data.employeeId}/documents`);
  assert.equal(docs.data.documents[0].category, "resume");
  const file = await owner.raw("GET", `/api/files/${docs.data.documents[0].file_id}`);
  assert.equal(file.status, 200);
  assert.equal((await owner.get("/api/recruitment/stats")).data.pipeline.onboarded, 1);
  // Invitation → email OTP → password → active
  const link = new URL(hire.data.inviteLink);
  const token = link.searchParams.get("token");
  const inv = client(env);
  assert.equal((await inv.get(`/api/auth/invite?token=${encodeURIComponent(token)}`)).status, 200);
  const code = (await inv.post("/api/auth/invite", { action: "code", token })).data.devCode;
  assert.equal((await inv.post("/api/auth/invite", { action: "accept", token, code: "000000", password: PASSWORD })).status, 400);
  const acc = await inv.post("/api/auth/invite", { action: "accept", token, code, password: PASSWORD, username: "ana.lim" });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  assert.equal((await inv.get("/api/auth/me")).data.user.username, "ana.lim");
  // Username + workspace sign-in, employee ID sign-in
  assert.equal((await client(env).post("/api/auth/login", { identifier: "ana.lim", password: PASSWORD })).status, 400, "workspace required");
  assert.equal((await client(env).post("/api/auth/login", { identifier: "ana.lim", workspace: "acme-people", password: PASSWORD })).status, 200);
  assert.equal((await client(env).post("/api/auth/login", { identifier: hire.data.employeeNumber, workspace: "acme-people", password: PASSWORD })).status, 200);
});

test("MFA: authenticator app required by policy, email OTP fallback, bootstrap enrollment", async () => {
  const env = env4();
  const { owner } = await setupOrg(env);
  const emp = await addEmployee(owner);
  const { client: e } = await employeeLogin(env, owner, emp, "ella.login@acme.test");
  // Enrol TOTP voluntarily
  const setup = await e.post("/api/mfa", { action: "totp_setup" });
  assert.match(setup.data.uri, /^otpauth:\/\/totp\//);
  assert.equal((await e.post("/api/mfa", { action: "totp_confirm", id: setup.data.id, code: await totpCode(setup.data.secret) })).status, 200);
  const c = client(env);
  const step1 = await c.post("/api/auth/login", { identifier: "ella.login@acme.test", password: PASSWORD });
  assert.equal(step1.data.mfaRequired, true);
  assert.ok(step1.data.methods.includes("totp"));
  assert.equal((await c.post("/api/auth/mfa", { action: "verify", challengeId: step1.data.challengeId, method: "totp", code: "123456" })).status, 400);
  const ok = await c.post("/api/auth/mfa", { action: "verify", challengeId: step1.data.challengeId, method: "totp", code: await totpCode(setup.data.secret) });
  assert.equal(ok.status, 200);
  assert.equal((await c.get("/api/employees/" + emp)).status, 200);
  // Policy: MFA for everyone, TOTP + passkey only → a user with nothing enrolled bootstraps via email then must enrol
  assert.equal((await owner.patch("/api/settings", { auth: { mfa: "all", methods: ["totp", "passkey"] } })).status, 200);
  assert.equal((await owner.get("/api/employees")).status, 401, "existing session without MFA must re-authenticate");
  const o2 = client(env);
  const s1 = await o2.post("/api/auth/login", { identifier: "owner@acme.test", password: PASSWORD });
  assert.equal(s1.data.bootstrap, true);
  const code = (await o2.post("/api/auth/mfa", { action: "email", challengeId: s1.data.challengeId })).data.devCode;
  const s2 = await o2.post("/api/auth/mfa", { action: "verify", challengeId: s1.data.challengeId, method: "email_otp", code });
  assert.equal(s2.data.mfaEnrollmentRequired, true);
  assert.equal((await o2.get("/api/employees")).data.code, "mfa_enrollment_required");
  const t = await o2.post("/api/mfa", { action: "totp_setup" });
  await o2.post("/api/mfa", { action: "totp_confirm", id: t.data.id, code: await totpCode(t.data.secret) });
  assert.equal((await o2.get("/api/employees")).status, 200, "session upgraded after enrolment");
});

test("passkeys: register and sign in without a password (simulated authenticator)", async () => {
  const env = env4();
  const { owner } = await setupOrg(env);
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const origin = "https://jelhr.test", rpId = "jelhr.test";
  const enc = new TextEncoder();
  const sha = async b => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
  const credId = crypto.getRandomValues(new Uint8Array(16));
  const cbor = (...parts) => Uint8Array.from(parts.flat());
  const bstr = b => [0x58, b.length, ...b];
  const tstr = s => { const x = [...enc.encode(s)]; return [0x60 + x.length, ...x]; };
  const fromB64 = s => Uint8Array.from(Buffer.from(s, "base64url"));
  const cose = cbor([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21], bstr([...fromB64(jwk.x)]), [0x22], bstr([...fromB64(jwk.y)]));
  const rpHash = await sha(enc.encode(rpId));
  const authData = (flags, count, withCred) => Uint8Array.from([...rpHash, flags, 0, 0, 0, count, ...(withCred ? [...new Uint8Array(16), 0, 16, ...credId, ...cose] : [])]);
  const opts = await owner.post("/api/mfa", { action: "passkey_options" });
  const cdReg = enc.encode(JSON.stringify({ type: "webauthn.create", challenge: opts.data.publicKey.challenge, origin }));
  const ad = authData(0x45, 0, true);
  const att = cbor([0xa3], tstr("fmt"), tstr("none"), tstr("attStmt"), [0xa0], tstr("authData"), [0x59, ad.length >> 8, ad.length & 255], [...ad]);
  const reg = await owner.post("/api/mfa", { action: "passkey_register", challengeId: opts.data.challengeId, credential: { id: b64url(credId), attestationObject: b64url(att), clientDataJSON: b64url(cdReg) } });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  const c = client(env);
  const lo = await c.post("/api/auth/passkey", { action: "options" });
  const cd = enc.encode(JSON.stringify({ type: "webauthn.get", challenge: lo.data.publicKey.challenge, origin }));
  const ad2 = authData(0x05, 1, false);
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, Uint8Array.from([...ad2, ...(await sha(cd))])));
  const int = b => { let x = [...b]; while (x.length > 1 && x[0] === 0 && !(x[1] & 0x80)) x.shift(); if (x[0] & 0x80) x.unshift(0); return [0x02, x.length, ...x]; };
  const r = int(raw.slice(0, 32)), s = int(raw.slice(32));
  const der = Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
  const v = await c.post("/api/auth/passkey", { action: "verify", challengeId: lo.data.challengeId, credential: { id: b64url(credId), authenticatorData: b64url(ad2), clientDataJSON: b64url(cd), signature: b64url(der) } });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.equal((await c.get("/api/auth/me")).data.user.email, "owner@acme.test");
});

test("SSO (OIDC) sign-in with a mocked identity provider", async () => {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pub = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1" };
  let nonce;
  const iss = "https://idp.test";
  const idToken = async () => {
    const h = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "k1" })));
    const p = b64url(new TextEncoder().encode(JSON.stringify({ iss, aud: "client-1", sub: "u1", email: "owner@acme.test", email_verified: true, nonce, exp: Math.floor(Date.now() / 1000) + 300 })));
    return `${h}.${p}.${b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(h + "." + p)))}`;
  };
  const env = env4({ __fetch: async url => {
    if (url.endsWith("/.well-known/openid-configuration")) return Response.json({ issuer: iss, authorization_endpoint: iss + "/authorize", token_endpoint: iss + "/token", jwks_uri: iss + "/jwks" });
    if (url.endsWith("/jwks")) return Response.json({ keys: [pub] });
    if (url.endsWith("/token")) return Response.json({ id_token: await idToken() });
    return new Response("no", { status: 404 });
  } });
  const { owner } = await setupOrg(env);
  assert.equal((await owner.patch("/api/settings", { auth: { sso: { issuer: iss, clientId: "client-1", clientSecret: "s3cret", enabled: true, domains: ["acme.test"] } } })).status, 200);
  const c = client(env);
  const start = await c.raw("GET", "/api/auth/sso/start?workspace=acme-people");
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.get("location"));
  nonce = loc.searchParams.get("nonce");
  const cb = await c.raw("GET", `/api/auth/sso/callback?state=${loc.searchParams.get("state")}&code=abc`);
  assert.equal(cb.status, 200);
  assert.ok(c.jar.get("jelhr_session"), "session cookie set");
  assert.equal((await c.get("/api/auth/me")).data.user.authMethod, "sso");
});

test("AI: org knowledge stays in its organization; conversations are private; features can be switched off", async () => {
  const env = env4();
  const a = await setupOrg(env, "Org A", "owner-a@a.test");
  const b = await setupOrg(env, "Org B", "owner-b@b.test");
  await a.owner.post("/api/knowledge", { title: "Leave policy", category: "leave", content: "Annual leave: employees receive 18 days of annual leave per year. Apply two weeks ahead." });
  await b.owner.post("/api/knowledge", { title: "Leave policy", category: "leave", content: "Annual leave: staff receive 25 days of annual leave. Unused leave expires in March." });
  const ra = await a.owner.post("/api/ai", { task: "ask", question: "How many days of annual leave do I get?" });
  assert.equal(ra.status, 200);
  assert.equal(ra.data.sources.length, 1);
  const rb = await b.owner.post("/api/ai", { task: "ask", question: "annual leave days" });
  assert.equal(rb.data.sources.length, 1);
  assert.notEqual(ra.data.conversationId, rb.data.conversationId);
  assert.equal((await b.owner.get(`/api/ai/conversations/${ra.data.conversationId}`)).status, 404, "other users can't read a conversation");
  const draft = await a.owner.post("/api/ai", { task: "hr_draft", docType: "warning_letter", details: "Late three times in October" });
  assert.equal(draft.status, 200);
  assert.ok(draft.data.disclaimer);
  // Platform switches AI off for Org A
  const p = client(env); await p.post("/api/platform/login", SUPER);
  await p.patch(`/api/platform/organizations/${a.orgId}`, { features: ["recruitment", "onboarding", "offboarding", "esign", "communications", "time"] });
  assert.equal((await a.owner.post("/api/ai", { task: "ask", question: "hi" })).data.code, "feature_disabled");
  const ov = await p.get("/api/platform/overview");
  assert.equal(ov.status, 200);
  assert.ok(ov.data.totals.aiRequests30d >= 3);
});

test("per-user features: admin narrows an employee's access", async () => {
  const env = env4();
  const { owner } = await setupOrg(env);
  const emp = await addEmployee(owner);
  const { client: e, userId } = await employeeLogin(env, owner, emp, "ella.login@acme.test");
  assert.equal((await e.get("/api/time")).status, 200);
  await owner.patch(`/api/users/${userId}`, { features: ["onboarding", "esign"] });
  assert.equal((await e.get("/api/time")).data.code, "feature_denied");
  assert.deepEqual((await e.get("/api/auth/me")).data.user.features.sort(), ["esign", "onboarding"]);
});

test("super admin TOTP from secrets", async () => {
  const env = env4({ JELHR_SUPERADMIN_TOTP_SECRET: "JBSWY3DPEHPK3PXP" });
  const c = client(env);
  const first = await c.post("/api/platform/login", SUPER);
  assert.equal(first.data.totpRequired, true);
  assert.equal((await c.post("/api/platform/login", { ...SUPER, code: await totpCode("JBSWY3DPEHPK3PXP") })).status, 200);
});
