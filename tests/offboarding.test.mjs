import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, setupOrg, addEmployee, employeeLogin } from "./helpers.mjs";

test("full offboarding lifecycle with blockers, assets and final closure", async () => {
  const env = makeEnv();
  const { owner } = await setupOrg(env);
  const empId = await addEmployee(owner);
  const { client: emp } = await employeeLogin(env, owner, empId, "ella.login@acme.test");

  const created = await owner.post("/api/offboarding", { employeeId: empId, reason: "Resignation", lastWorkingDay: "2026-12-15" });
  assert.equal(created.status, 201);
  assert.equal(created.data.taskCount, 12);
  assert.equal((await owner.post("/api/offboarding", { employeeId: empId, reason: "Resignation", lastWorkingDay: "2026-12-15" })).status, 409);

  const caseId = created.data.id;
  let detail = await owner.get(`/api/offboarding/${caseId}`);
  assert.equal(detail.data.tasks.length, 12);
  assert.equal(detail.data.tasks[0].due_date, "2026-12-08");
  assert.equal(detail.data.case.employment_status, undefined);

  const asset = await owner.post(`/api/offboarding/${caseId}/assets`, { assetType: "Laptop", assetTag: "LT-0042" });
  assert.equal(asset.status, 201);

  const blocked = await owner.patch(`/api/offboarding/${caseId}`, { action: "complete" });
  assert.equal(blocked.status, 409);
  assert.ok(blocked.data.blockers.length >= 3);

  // Evidence notes are preserved when a later update omits them.
  const t0 = detail.data.tasks[0].id;
  await owner.patch(`/api/offboarding/${caseId}`, { taskId: t0, status: "in_progress", evidenceNote: "Letter sent" });
  await owner.patch(`/api/offboarding/${caseId}`, { taskId: t0, status: "completed" });
  detail = await owner.get(`/api/offboarding/${caseId}`);
  assert.equal(detail.data.tasks[0].evidence_note, "Letter sent");

  for (const t of detail.data.tasks) await owner.patch(`/api/offboarding/${caseId}`, { taskId: t.id, status: "completed" });
  await owner.patch(`/api/offboarding/${caseId}/assets`, { assetId: asset.data.id, status: "returned", conditionNote: "Good" });
  await owner.patch(`/api/offboarding/${caseId}`, { finalPayStatus: "completed", exitInterviewStatus: "completed", rehireEligible: "yes", exitInterviewNotes: "Moving abroad" });

  assert.equal((await owner.patch(`/api/offboarding/${caseId}`, { action: "submit" })).status, 200);
  assert.equal((await owner.patch(`/api/offboarding/${caseId}`, { action: "complete" })).status, 200);

  const e = await env.DB.prepare("SELECT employment_status FROM employees WHERE id=?").bind(empId).first();
  assert.equal(e.employment_status, "terminated");
  assert.equal((await emp.get("/api/auth/me")).status, 401, "employee sessions revoked and account disabled");
  assert.equal((await owner.patch(`/api/offboarding/${caseId}`, { notes: "late" })).status, 409);
  detail = await owner.get(`/api/offboarding/${caseId}`);
  assert.ok(detail.data.events.some(ev => ev.action === "offboarding.completed"));
});

test("hr_manager can run a case but cannot finalize; cancel restores status", async () => {
  const env = makeEnv();
  const { owner } = await setupOrg(env);
  const hrEmp = await addEmployee(owner, { email: "hr@acme.test", firstName: "Hana", department: "HR" });
  const { client: hr } = await employeeLogin(env, owner, hrEmp, "hana@acme.test", "hr_manager");
  const empId = await addEmployee(owner, { email: "leaver@acme.test", firstName: "Leo" });
  const c = await hr.post("/api/offboarding", { employeeId: empId, reason: "End of contract", lastWorkingDay: "2026-12-31" });
  assert.equal(c.status, 201);
  assert.equal((await hr.patch(`/api/offboarding/${c.data.id}`, { action: "complete" })).status, 403);
  assert.equal((await hr.patch(`/api/offboarding/${c.data.id}`, { action: "cancel" })).status, 400, "reason required");
  assert.equal((await hr.patch(`/api/offboarding/${c.data.id}`, { action: "cancel", reason: "Retained" })).status, 200);
  const e = await env.DB.prepare("SELECT employment_status FROM employees WHERE id=?").bind(empId).first();
  assert.equal(e.employment_status, "active");
});

test("time clock and onboarding plan", async () => {
  const env = makeEnv();
  const { owner } = await setupOrg(env);
  const empId = await addEmployee(owner);
  const { client: emp } = await employeeLogin(env, owner, empId, "ella.login@acme.test");
  assert.equal((await emp.post("/api/time", { action: "clock_out" })).status, 409);
  assert.equal((await emp.post("/api/time", { action: "clock_in", note: "Sprint" })).status, 201);
  assert.equal((await emp.post("/api/time", { action: "clock_in" })).status, 409);
  const out = await emp.post("/api/time", { action: "clock_out" });
  assert.equal(out.status, 200);
  assert.equal((await emp.patch(`/api/time/${out.data.id}`, { approvalStatus: "approved" })).status, 403);
  assert.equal((await owner.patch(`/api/time/${out.data.id}`, { approvalStatus: "approved" })).status, 200);
  assert.equal((await owner.get("/api/time?scope=team")).data.entries.length, 1);

  assert.equal((await owner.post("/api/onboarding", { employeeId: empId, plan: "standard" })).status, 201);
  const tasks = (await emp.get("/api/onboarding")).data.tasks;
  assert.equal(tasks.length, 9);
  assert.equal((await emp.patch(`/api/onboarding/${tasks[0].id}`, { completed: true })).status, 200);
  assert.equal((await emp.del(`/api/onboarding/${tasks[0].id}`)).status, 403);
  assert.equal((await owner.del(`/api/onboarding/${tasks[1].id}`)).status, 200);
  const stats = await owner.get("/api/stats");
  assert.equal(stats.data.onboarding.total, 8);
  assert.equal(stats.data.onboarding.done, 1);
});
