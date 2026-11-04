import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, setupOrg, addEmployee, employeeLogin } from "./helpers.mjs";

const PNG = "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600, 7)]).toString("base64");

test("signature request: render, view, sign, tamper detection and blocking offboarding", async () => {
  const env = makeEnv();
  const { owner } = await setupOrg(env);
  const empId = await addEmployee(owner);
  const { client: emp } = await employeeLogin(env, owner, empId, "ella.login@acme.test");
  const otherId = await addEmployee(owner, { email: "o@acme.test", firstName: "Omar" });
  const { client: other } = await employeeLogin(env, owner, otherId, "omar.login@acme.test");

  const kase = await owner.post("/api/offboarding", { employeeId: empId, reason: "Resignation", lastWorkingDay: "2026-12-15" });
  await owner.post(`/api/offboarding/${kase.data.id}/assets`, { assetType: "Laptop", assetTag: "LT-9" });
  const req = await owner.post("/api/esign/requests", { employeeId: empId, templateId: "asset-return", offboardingCaseId: kase.data.id, dueDate: "2026-12-10" });
  assert.equal(req.status, 201);
  assert.equal(req.data.notified, true, "log provider records the notification");
  assert.match(req.data.documentHash, /^[a-f0-9]{64}$/);

  const view = await emp.get(`/api/esign/requests/${req.data.id}`);
  assert.equal(view.status, 200);
  assert.equal(view.data.canSign, true);
  assert.match(view.data.request.body, /Ella Employee/);
  assert.match(view.data.request.body, /Laptop \(LT-9\)/);
  assert.equal(view.data.request.documentIntact, true);
  assert.equal((await other.get(`/api/esign/requests/${req.data.id}`)).status, 404);
  assert.equal((await emp.get("/api/esign/requests")).data.requests.length, 1);
  assert.equal((await other.get("/api/esign/requests")).data.requests.length, 0);

  await emp.post(`/api/esign/requests/${req.data.id}`, { action: "view" });
  const blocked = await owner.patch(`/api/offboarding/${kase.data.id}`, { action: "complete" });
  assert.ok(blocked.data.blockers.some(b => /signature/.test(b)));

  assert.equal((await emp.post(`/api/esign/requests/${req.data.id}`, { action: "sign", signatureType: "drawn", signatureImage: PNG, documentHash: req.data.documentHash })).status, 400, "consent required");
  assert.equal((await emp.post(`/api/esign/requests/${req.data.id}`, { action: "sign", consent: true, signatureType: "drawn", signatureImage: PNG, documentHash: "0".repeat(64) })).status, 409, "hash must match");
  assert.equal((await emp.post(`/api/esign/requests/${req.data.id}`, { action: "sign", consent: true, signatureType: "drawn", signatureImage: "data:image/png;base64,AAAA", documentHash: req.data.documentHash })).status, 400, "invalid png");
  const signed = await emp.post(`/api/esign/requests/${req.data.id}`, { action: "sign", consent: true, signatureType: "drawn", signatureImage: PNG, documentHash: req.data.documentHash });
  assert.equal(signed.status, 200);
  assert.match(signed.data.signatureHash, /^[a-f0-9]{64}$/);
  assert.equal((await emp.post(`/api/esign/requests/${req.data.id}`, { action: "sign", consent: true, signatureType: "typed", typedName: "Ella", documentHash: req.data.documentHash })).status, 409);

  const cert = await owner.get(`/api/esign/requests/${req.data.id}`);
  assert.equal(cert.data.request.status, "signed");
  assert.deepEqual(cert.data.events.map(e => e.event), ["created", "viewed", "signed"]);
  const verify = await owner.get(`/api/esign/verify?hash=${signed.data.signatureHash}`);
  assert.equal(verify.data.found, true);

  // Tampering with stored text is detected.
  await env.DB.prepare("UPDATE signature_requests SET body=body || ' extra' WHERE id=?").bind(req.data.id).run();
  assert.equal((await owner.get(`/api/esign/requests/${req.data.id}`)).data.request.documentIntact, false);
});

test("typed signature, decline and void", async () => {
  const env = makeEnv();
  const { owner } = await setupOrg(env);
  const empId = await addEmployee(owner);
  const { client: emp } = await employeeLogin(env, owner, empId, "ella.login@acme.test");
  const a = await owner.post("/api/esign/requests", { employeeId: empId, templateId: "policy-acknowledgement", notify: false });
  const b = await owner.post("/api/esign/requests", { employeeId: empId, templateId: "custom", title: "Remote work agreement", body: "Hello {{employee.fullName}}" });
  const c = await owner.post("/api/esign/requests", { employeeId: empId, templateId: "custom", title: "Empty" });
  assert.equal(c.status, 400);
  assert.equal((await emp.post(`/api/esign/requests/${a.data.id}`, { action: "sign", consent: true, signatureType: "typed", typedName: "Ella Employee", documentHash: a.data.documentHash })).status, 200);
  assert.equal((await emp.post(`/api/esign/requests/${b.data.id}`, { action: "decline", reason: "Wrong start date" })).status, 200);
  const d = await owner.post("/api/esign/requests", { employeeId: empId, templateId: "confidentiality-reminder" });
  assert.equal((await emp.post(`/api/esign/requests/${d.data.id}`, { action: "void", reason: "x" })).status, 403);
  assert.equal((await owner.post(`/api/esign/requests/${d.data.id}`, { action: "void", reason: "Sent in error" })).status, 200);
  const list = (await owner.get("/api/esign/requests")).data.requests;
  assert.deepEqual(list.map(r => r.status).sort(), ["declined", "signed", "voided"]);
});
