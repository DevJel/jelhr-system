// Synthetic demo data for local development and screenshots. Never run against production.
import { client, setupOrg, addEmployee, employeeLogin, PASSWORD } from "./client.mjs";

const PNG_SIG = "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(800, 9)]).toString("base64");

export async function seed(env) {
  const { owner } = await setupOrg(env, "Northwind Demo", "owner@northwind.test");
  const people = [
    ["Lora", "Piterson", "UX/UI Designer", "Product", "active", "2023-03-01"],
    ["Harry", "Bender", "Engineering Lead", "Engineering", "active", "2022-01-10"],
    ["Katy", "Fuller", "People Operations Lead", "People", "active", "2023-08-14"],
    ["Jonathan", "Kelly", "Product Manager", "Product", "onboarding", new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)],
    ["Billie", "Wright", "Backend Engineer", "Engineering", "active", "2021-11-08"],
    ["Sarah", "Page", "Finance Analyst", "Finance", "on_leave", "2022-06-20"],
    ["Amir", "Rahman", "Sales Executive", "Sales", "active", "2024-02-12"],
    ["Mei", "Lin", "Data Analyst", "Finance", "active", "2024-05-06"],
    ["Diego", "Santos", "Support Specialist", "Customer Success", "active", "2023-10-02"],
    ["Priya", "Nair", "Frontend Engineer", "Engineering", "onboarding", new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10)]
  ];
  const ids = {};
  for (const [f, l, t, d, s, h] of people) ids[f] = await addEmployee(owner, { firstName: f, lastName: l, email: `${f.toLowerCase()}@northwind.test`, jobTitle: t, department: d, employmentStatus: s, hireDate: h, personalEmail: `${f.toLowerCase()}.${l.toLowerCase()}@home.test` });
  for (const f of ["Billie", "Jonathan", "Priya"]) await owner.patch(`/api/employees/${ids[f]}`, { managerId: ids.Harry });
  const { client: katy } = await employeeLogin(env, owner, ids.Katy, "katy.hr@northwind.test", "hr_manager");
  const { client: billie } = await employeeLogin(env, owner, ids.Billie, "billie.login@northwind.test");
  await employeeLogin(env, owner, ids.Harry, "harry.login@northwind.test", "manager");
  await employeeLogin(env, owner, ids.Jonathan, "jonathan.login@northwind.test");
  const auditorEmp = await addEmployee(owner, { firstName: "Demo", lastName: "Viewer", email: "viewer@northwind.test", jobTitle: "Auditor", department: "People" });
  await employeeLogin(env, owner, auditorEmp, "demo@northwind.test", "auditor");

  for (const f of ["Jonathan", "Priya"]) await katy.post("/api/onboarding", { employeeId: ids[f], plan: "standard" });
  const { tasks } = await katy.get(`/api/onboarding?employeeId=${ids.Jonathan}`).then(r => r.data);
  for (const t of tasks.slice(0, 4)) await katy.patch(`/api/onboarding/${t.id}`, { completed: true });

  // An offboarding case in progress, and a completed one (former employee).
  const lwd = new Date(Date.now() + 12 * 864e5).toISOString().slice(0, 10);
  const c1 = (await katy.post("/api/offboarding", { employeeId: ids.Billie, reason: "Resignation", lastWorkingDay: lwd, notes: "Moving to a new city." })).data.id;
  await katy.post(`/api/offboarding/${c1}/assets`, { assetType: "Laptop", assetTag: "NW-LT-0142", description: "MacBook Pro 14" });
  await katy.post(`/api/offboarding/${c1}/assets`, { assetType: "Access badge", assetTag: "B-2231" });
  const d1 = (await katy.get(`/api/offboarding/${c1}`)).data;
  for (const t of d1.tasks.slice(0, 5)) await katy.patch(`/api/offboarding/${c1}`, { taskId: t.id, status: "completed", evidenceNote: "Confirmed by " + t.owner_role.toUpperCase() });
  await katy.patch(`/api/offboarding/${c1}`, { taskId: d1.tasks[5].id, status: "in_progress" });
  await katy.patch(`/api/offboarding/${c1}`, { exitInterviewStatus: "scheduled", finalPayStatus: "processing" });
  const sigCase = (await katy.post("/api/esign/requests", { employeeId: ids.Billie, templateId: "separation-acknowledgement", offboardingCaseId: c1, dueDate: lwd, message: "Please review before your last day." })).data;
  await katy.post("/api/esign/requests", { employeeId: ids.Billie, templateId: "asset-return", offboardingCaseId: c1, dueDate: lwd });
  const pol = (await katy.post("/api/esign/requests", { employeeId: ids.Billie, templateId: "policy-acknowledgement", title: "Remote work policy v2" })).data;
  await billie.post(`/api/esign/requests/${pol.id}`, { action: "view" });
  await billie.post(`/api/esign/requests/${pol.id}`, { action: "sign", consent: true, signatureType: "typed", typedName: "Billie Wright", documentHash: pol.documentHash });
  void sigCase; void PNG_SIG;

  const c2 = (await katy.post("/api/offboarding", { employeeId: ids.Mei, reason: "End of contract", lastWorkingDay: new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10) })).data.id;
  const d2 = (await katy.get(`/api/offboarding/${c2}`)).data;
  for (const t of d2.tasks) await katy.patch(`/api/offboarding/${c2}`, { taskId: t.id, status: t.category === "assets" ? "not_applicable" : "completed" });
  await katy.patch(`/api/offboarding/${c2}`, { finalPayStatus: "completed", exitInterviewStatus: "completed", rehireEligible: "yes" });
  await katy.patch(`/api/offboarding/${c2}`, { action: "submit" });
  await owner.patch(`/api/offboarding/${c2}`, { action: "complete" });

  // A case awaiting final approval and a cancelled case, so every tab has an example.
  const c3 = (await katy.post("/api/offboarding", { employeeId: ids.Amir, reason: "Mutual agreement", lastWorkingDay: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) })).data.id;
  const d3 = (await katy.get(`/api/offboarding/${c3}`)).data;
  for (const t of d3.tasks) await katy.patch(`/api/offboarding/${c3}`, { taskId: t.id, status: t.category === "assets" ? "not_applicable" : "completed" });
  await katy.patch(`/api/offboarding/${c3}`, { finalPayStatus: "not_applicable", exitInterviewStatus: "declined", rehireEligible: "review" });
  await katy.patch(`/api/offboarding/${c3}`, { action: "submit" });
  const c4 = (await katy.post("/api/offboarding", { employeeId: ids.Diego, reason: "Resignation", lastWorkingDay: new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10) })).data.id;
  await katy.patch(`/api/offboarding/${c4}`, { action: "cancel", reason: "Employee accepted a counter-offer and is staying." });
  // A declined and a voided signature request.
  const dec = (await katy.post("/api/esign/requests", { employeeId: ids.Billie, templateId: "custom", title: "Overtime arrangement 2026", body: "I agree to the overtime arrangement described by my manager for Q4 2026." })).data;
  await billie.post(`/api/esign/requests/${dec.id}`, { action: "decline", reason: "The hours listed don't match what we agreed." });
  const vd = (await katy.post("/api/esign/requests", { employeeId: ids.Lora, templateId: "confidentiality-reminder", notify: false })).data;
  await katy.post(`/api/esign/requests/${vd.id}`, { action: "void", reason: "Sent to the wrong employee." });

  const applicants = [["Ava", "Thompson", "Product Designer", "interview"], ["Noah", "Kim", "Backend Engineer", "screening"], ["Zara", "Ali", "Backend Engineer", "applied"], ["Ethan", "Ong", "Sales Executive", "offer"], ["Lea", "Martin", "Data Analyst", "applied"], ["Omar", "Haddad", "Support Specialist", "rejected"]];
  for (const [f, l, p, s] of applicants) await katy.post("/api/applicants", { firstName: f, lastName: l, email: `${f.toLowerCase()}@candidates.test`, position: p, stage: s, source: "Careers page" });

  // Time entries for Billie (inserted directly to give a realistic week).
  for (let i = 1; i <= 5; i++) {
    const start = new Date(Date.now() - i * 864e5); start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + (7 + (i % 3)) * 3600000);
    await env.DB.prepare("INSERT INTO time_entries(id,organization_id,employee_id,started_at,ended_at,break_minutes,approval_status) SELECT ?,organization_id,id,?,?,?,? FROM employees WHERE id=?")
      .bind(crypto.randomUUID(), start.toISOString(), end.toISOString(), 45, i > 2 ? "approved" : "pending", ids.Billie).run();
  }
  const msg = (await katy.post("/api/communications", { audience: "employees", subject: "Office closed on Friday", body: "Hi {{firstName}},\n\nThe office is closed this Friday for maintenance. Remote work as usual.\n\nPeople Operations" })).data;
  await katy.post(`/api/communications/${msg.id}`, { action: "send" });
  return { owner: "owner@northwind.test", hr: "katy.hr@northwind.test", employee: "billie.login@northwind.test", manager: "harry.login@northwind.test", auditor: "demo@northwind.test", password: PASSWORD };
}
