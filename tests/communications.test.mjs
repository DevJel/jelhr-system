import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, setupOrg, addEmployee } from "./helpers.mjs";
import { signV4 } from "../functions/_shared/sigv4.js";
import { smtpSend, buildMime } from "../functions/_shared/smtp.js";

test("SigV4 matches the AWS documented example signature", async () => {
  const r = await signV4({
    method: "GET", url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08", region: "us-east-1", service: "iam",
    accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" }, date: new Date("2015-08-30T12:36:00Z")
  });
  assert.equal(r.signature, "5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7");
});

test("audiences: employees, department, applicants with consent, former employees with personal email", async () => {
  const env = makeEnv();
  const { owner } = await setupOrg(env);
  await addEmployee(owner, { email: "a@acme.test", department: "Finance" });
  await addEmployee(owner, { email: "b@acme.test", department: "Sales", firstName: "Bo" });
  const former = await addEmployee(owner, { email: "c@acme.test", firstName: "Cy", personalEmail: "cy@home.test" });
  await env.DB.prepare("UPDATE employees SET employment_status='terminated' WHERE id=?").bind(former).run();
  await owner.post("/api/applicants", { firstName: "Ann", lastName: "Applicant", email: "ann@mail.test", position: "Designer", stage: "interview" });
  await owner.post("/api/applicants", { firstName: "No", lastName: "Contact", email: "no@mail.test", position: "Designer", consentToContact: false });
  await owner.post("/api/applicants", { firstName: "Hired", lastName: "Already", email: "h@mail.test", position: "Designer", stage: "hired" });

  const count = async (audience, filter) => (await owner.post("/api/communications", { audience, filter, dryRun: true })).data.count;
  assert.equal(await count("employees"), 2);
  assert.equal(await count("department", { department: "Sales" }), 1);
  assert.equal(await count("applicants"), 1);
  assert.equal(await count("applicants", { stages: ["hired"] }), 1);
  assert.equal(await count("former"), 1);
});

test("send in batches through the log provider and record results", async () => {
  const env = makeEnv();
  const { owner } = await setupOrg(env);
  for (let i = 0; i < 25; i++) await addEmployee(owner, { email: `p${i}@acme.test`, firstName: "P" + i });
  const draft = await owner.post("/api/communications", { audience: "employees", subject: "Hello {{firstName}}", body: "Office closed Friday, {{firstName}}." });
  assert.equal(draft.status, 201);
  assert.equal(draft.data.recipientCount, 25);
  const first = await owner.post(`/api/communications/${draft.data.id}`, { action: "send" });
  assert.equal(first.data.remaining, 5);
  const second = await owner.post(`/api/communications/${draft.data.id}`, { action: "send" });
  assert.equal(second.data.status, "sent");
  assert.equal(second.data.sent, 25);
  assert.equal((await owner.del(`/api/communications/${draft.data.id}`)).status, 409, "only drafts can be deleted");
});

test("email not configured returns a clear 503; production disables log mode", async () => {
  const env = makeEnv({ EMAIL_PROVIDER: "log", JELHR_ENV: "production" });
  const { owner } = await setupOrg(env);
  await addEmployee(owner);
  const d = await owner.post("/api/communications", { audience: "employees", subject: "S", body: "B" });
  const r = await owner.post(`/api/communications/${d.data.id}`, { action: "send" });
  assert.equal(r.status, 503);
  assert.match(r.data.error, /disabled in production/);
});

test("SES provider signs a v2 SendEmail request", async () => {
  const calls = [];
  const env = makeEnv({
    EMAIL_PROVIDER: "ses", SES_REGION: "ap-southeast-1", SES_ACCESS_KEY_ID: "AKIDTEST", SES_SECRET_ACCESS_KEY: "secret",
    __fetch: async (url, init) => { calls.push({ url, init }); return Response.json({ MessageId: "ses-123" }); }
  });
  const { owner } = await setupOrg(env);
  await addEmployee(owner);
  const d = await owner.post("/api/communications", { audience: "employees", subject: "Hi", body: "Body" });
  const r = await owner.post(`/api/communications/${d.data.id}`, { action: "send" });
  assert.equal(r.data.sent, 1);
  assert.equal(calls[0].url, "https://email.ap-southeast-1.amazonaws.com/v2/email/outbound-emails");
  assert.match(calls[0].init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/ap-southeast-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[a-f0-9]{64}$/);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.Destination.ToAddresses, ["ella@acme.test"]);
});

test("SES errors are recorded per recipient and can be retried", async () => {
  let fail = true;
  const env = makeEnv({
    EMAIL_PROVIDER: "ses", SES_REGION: "us-east-1", SES_ACCESS_KEY_ID: "A", SES_SECRET_ACCESS_KEY: "B",
    __fetch: async () => fail ? Response.json({ message: "Email address is not verified." }, { status: 400 }) : Response.json({ MessageId: "ok" })
  });
  const { owner } = await setupOrg(env);
  await addEmployee(owner);
  const d = await owner.post("/api/communications", { audience: "employees", subject: "Hi", body: "Body" });
  const r = await owner.post(`/api/communications/${d.data.id}`, { action: "send" });
  assert.equal(r.data.status, "partial");
  const detail = await owner.get(`/api/communications/${d.data.id}`);
  assert.match(detail.data.recipients[0].error, /not verified/);
  fail = false;
  await owner.post(`/api/communications/${d.data.id}`, { action: "retry_failed" });
  assert.equal((await owner.post(`/api/communications/${d.data.id}`, { action: "send" })).data.status, "sent");
});

function fakeSmtpServer(script) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const log = [];
  let push;
  const readable = new ReadableStream({ start(c) { push = s => c.enqueue(enc.encode(s)); push("220 smtp.test ESMTP\r\n"); } });
  let buffer = "", inData = false;
  const writable = new WritableStream({
    write(chunk) {
      buffer += dec.decode(chunk);
      let i;
      while ((i = buffer.indexOf("\r\n")) >= 0) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          log.push("DATA:" + buffer.slice(0, end));
          buffer = buffer.slice(end + 5); inData = false; push("250 Ok queued as ABC123\r\n"); continue;
        }
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 2); log.push(line);
        const reply = script(line);
        if (line === "DATA") inData = true;
        push(reply);
      }
    }
  });
  const socket = { readable, writable, close: async () => {}, startTls: () => socket };
  return { socket, log };
}

test("SMTP client: STARTTLS, AUTH LOGIN and MIME delivery", async () => {
  const server = fakeSmtpServer(line => {
    if (line.startsWith("EHLO")) return "250-smtp.test\r\n250-STARTTLS\r\n250 AUTH LOGIN\r\n";
    if (line === "STARTTLS") return "220 Ready\r\n";
    if (line === "AUTH LOGIN") return "334 VXNlcm5hbWU6\r\n";
    if (line === btoa("user")) return "334 UGFzc3dvcmQ6\r\n";
    if (line === btoa("pass")) return "235 Authenticated\r\n";
    if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO")) return "250 Ok\r\n";
    if (line === "DATA") return "354 End with .\r\n";
    if (line === "QUIT") return "221 Bye\r\n";
    return "500 ?\r\n";
  });
  let opts;
  const result = await smtpSend({ host: "smtp.test", port: 587, username: "user", password: "pass" },
    { from: "hr@acme.test", fromName: "Acme HR", to: "ella@acme.test", toName: "Ella", subject: "Привет", text: "Hello", html: "<p>Hello</p>", messageId: "m1@jelhr" },
    (addr, o) => { opts = o; return server.socket; });
  assert.equal(opts.secureTransport, "starttls");
  assert.equal(result.id, "ABC123");
  assert.ok(server.log.includes("STARTTLS"));
  const data = server.log.find(l => l.startsWith("DATA:"));
  assert.match(data, /Subject: =\?UTF-8\?B\?/);
  assert.match(data, /multipart\/alternative/);
});

test("MIME builder strips header injection", () => {
  const mime = buildMime({ from: "a@b.test", to: "c@d.test\r\nBcc: x@evil.test", subject: "Hi\r\nBcc: y@evil.test", text: "t", messageId: "1@x" });
  assert.doesNotMatch(mime, /\r\nBcc:/);
});
