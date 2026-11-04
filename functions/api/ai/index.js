import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, HR_READ } from "../../_shared/auth.js";
import { requireFeature, userFeatures } from "../../_shared/features.js";
import { aiStatus, parseJson } from "../../_shared/ai.js";
import { orgProfile, checkQuota, personalContext, systemPrompt, knowledgeBlock, ask, HR_ROLES } from "../../_shared/aicontext.js";
import * as v from "../../_shared/validate.js";

export const HR_DOC_TYPES = {
  warning_letter: "written warning letter",
  show_cause: "show-cause letter (request for explanation)",
  termination: "termination of employment letter",
  probation_confirmation: "probation confirmation letter",
  probation_extension: "probation extension letter",
  offer_letter: "offer of employment letter",
  policy_announcement: "policy announcement to staff",
  reference_letter: "employment reference / service letter",
  other: "HR document"
};

const clip = (s, n) => String(s || "").slice(0, n);

export async function onRequestGet(context) {
  const user = await authenticate(context);
  const { env } = context;
  const status = aiStatus(env);
  const profile = await orgProfile(env, user.organization_id);
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE organization_id=? AND created_at>=?").bind(user.organization_id, since.toISOString()).first();
  const { results } = await env.DB.prepare("SELECT id, title, mode, updated_at FROM ai_conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT 30").bind(user.id).all();
  const docs = await env.DB.prepare("SELECT COUNT(*) AS n FROM knowledge_docs WHERE organization_id=?").bind(user.organization_id).first();
  return respond({
    enabled: userFeatures(user).includes("ai"), status: { configured: status.configured, provider: status.provider, model: status.model, detail: status.detail },
    assistantName: profile.ai.assistantName, country: profile.country, usage: { today: used.n, limit: profile.limit },
    conversations: results || [], knowledgeDocs: docs.n, canDraftHr: HR_ROLES.includes(user.role), hrDocTypes: HR_ROLES.includes(user.role) ? HR_DOC_TYPES : {}
  });
}

async function conversation(env, user, id, title, mode) {
  if (id) {
    const c = await env.DB.prepare("SELECT * FROM ai_conversations WHERE id=? AND user_id=?").bind(v.id(id, "conversationId"), user.id).first();
    if (!c) throw new HttpError(404, "Conversation not found");
    return c;
  }
  const c = { id: crypto.randomUUID(), title: clip(title, 80) || "New conversation", mode };
  await env.DB.prepare("INSERT INTO ai_conversations(id,organization_id,user_id,title,mode) VALUES(?,?,?,?,?)").bind(c.id, user.organization_id, user.id, c.title, mode).run();
  return c;
}
async function history(env, convId) {
  const { results } = await env.DB.prepare("SELECT role, content FROM ai_messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT 6").bind(convId).all();
  return (results || []).reverse().map(m => `${m.role === "user" ? "User" : "Assistant"}: ${clip(m.content, 1500)}`).join("\n");
}
async function save(env, convId, question, answer, sources) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO ai_messages(id,conversation_id,role,content,created_at) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(), convId, "user", question, now),
    env.DB.prepare("INSERT INTO ai_messages(id,conversation_id,role,content,sources_json,created_at) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), convId, "assistant", answer, JSON.stringify(sources), new Date(Date.now() + 1).toISOString()),
    env.DB.prepare("UPDATE ai_conversations SET updated_at=? WHERE id=?").bind(now, convId)
  ]);
}
const sourcesOf = hits => hits.map((h, i) => ({ n: i + 1, title: h.title, heading: h.heading, category: h.category }));

export async function onRequestPost(context) {
  const user = await authenticate(context);
  const { env, request } = context;
  requireFeature(user, "ai");
  const b = await readJson(request, 64 * 1024);
  const profile = await orgProfile(env, user.organization_id);
  await checkQuota(env, user, profile);
  const hr = HR_ROLES.includes(user.role);
  const sys = mode => systemPrompt(profile, user, { mode });

  switch (b.task) {
    case "ask": {
      const q = v.text(b.question, "Question", { required: true, max: 4000 });
      const conv = await conversation(env, user, b.conversationId, q, "ask");
      const [kb, me, past] = await Promise.all([knowledgeBlock(env, user, q), personalContext(env, user), history(env, conv.id)]);
      const r = await ask(env, user, "ask", { system: sys("ask"), prompt: `${kb.text}\n\nCONTEXT (the signed-in user only):\n${me}\n\n${past ? "EARLIER IN THIS CONVERSATION:\n" + past + "\n\n" : ""}QUESTION:\n${q}`, maxTokens: 900 });
      await save(env, conv.id, q, r.text, sourcesOf(kb.hits));
      return respond({ conversationId: conv.id, answer: r.text, sources: sourcesOf(kb.hits), provider: r.provider });
    }
    case "hr_draft": {
      if (!hr) throw new HttpError(403, "Only HR can draft HR documents");
      const type = v.oneOf(b.docType, Object.keys(HR_DOC_TYPES), "Document type");
      const details = v.text(b.details, "Details", { required: true, max: 6000 });
      let subject = "";
      if (b.employeeId) {
        const e = await env.DB.prepare("SELECT first_name, last_name, employee_number, job_title, department, hire_date, employment_type, employment_status FROM employees WHERE id=? AND organization_id=?").bind(v.id(b.employeeId, "Employee"), user.organization_id).first();
        if (!e) throw new HttpError(404, "Employee not found");
        subject = `SUBJECT EMPLOYEE:\n${e.first_name} ${e.last_name} (${e.employee_number}), ${e.job_title}${e.department ? ", " + e.department : ""}; started ${e.hire_date || "unknown"}; ${String(e.employment_type).replace("_", " ")}; status ${e.employment_status}.`;
      }
      const conv = await conversation(env, user, b.conversationId, `${HR_DOC_TYPES[type]}${b.employeeId ? "" : ""}`, "draft");
      const kb = await knowledgeBlock(env, user, `${HR_DOC_TYPES[type]} ${details}`);
      const prompt = `${kb.text}\n\n${subject}\n\nTASK: Draft a ${HR_DOC_TYPES[type]} for ${profile.name}${profile.country ? ` (employment country ${profile.country})` : ""}.
FACTS FROM HR:\n${details}\n${b.tone ? "Requested tone: " + clip(b.tone, 100) + "\n" : ""}
Return JSON only: {"title": "...", "body": "the full letter text with [placeholders] for missing facts", "checklist": ["short compliance/process points HR should confirm before sending, e.g. investigation done, right to be heard, notice period, policy clause referenced"], "lawNotes": "1-3 sentences on the jurisdiction-specific points to verify"}`;
      const r = await ask(env, user, "hr_draft", { system: sys("draft") + "\nRespond with JSON only.", prompt, maxTokens: 1800 });
      const j = parseJson(r.text) || { title: HR_DOC_TYPES[type], body: r.text, checklist: [], lawNotes: "" };
      const out = { title: clip(j.title, 160) || HR_DOC_TYPES[type], body: clip(j.body, 20000), checklist: (Array.isArray(j.checklist) ? j.checklist : []).slice(0, 10).map(x => clip(x, 300)), lawNotes: clip(j.lawNotes, 1000), sources: sourcesOf(kb.hits) };
      await save(env, conv.id, `Draft: ${HR_DOC_TYPES[type]}\n${details}`, out.body, out.sources);
      return respond({ conversationId: conv.id, ...out, disclaimer: "AI draft for HR review. Check it against your policies and local employment law, and get legal advice for disciplinary or termination matters before sending." });
    }
    case "rewrite": {
      const text = v.text(b.text, "Text", { required: true, max: 12000 });
      const how = v.text(b.instruction || "Make it clearer and more professional", "Instruction", { max: 300 });
      const r = await ask(env, user, "rewrite", { system: sys("ask"), prompt: `Rewrite the DOCUMENT as instructed. Return only the rewritten text.\nINSTRUCTION: ${how}\nDOCUMENT:\n${text}`, maxTokens: 1500 });
      return respond({ text: r.text });
    }
    case "job_description": {
      requireFeature(user, "recruitment");
      if (!hr) throw new HttpError(403, "Only HR can draft job postings");
      const title = v.text(b.title, "Job title", { required: true, max: 120 });
      const kb = await knowledgeBlock(env, user, `${title} benefits culture working hours`);
      const r = await ask(env, user, "job_description", { system: sys("draft") + "\nRespond with JSON only.", prompt: `${kb.text}\n\nWrite an inclusive job posting for ${profile.name}. Avoid biased or exclusionary wording and don't state requirements that aren't necessary.\nTitle: ${title}\nDepartment: ${clip(b.department, 80)}\nLocation: ${clip(b.location, 120)}\nNotes from HR: ${clip(b.notes, 3000)}\nReturn JSON: {"summary":"one sentence","description":"About the role / What you'll do / Why join us, plain text with - bullets","requirements":"- bullets"}`, maxTokens: 1400 });
      const j = parseJson(r.text) || { description: r.text };
      return respond({ summary: clip(j.summary, 300), description: clip(j.description, 20000), requirements: clip(j.requirements, 8000) });
    }
    case "screen_applicant": {
      requireFeature(user, "recruitment");
      if (!HR_READ.includes(user.role) || user.role === "auditor") throw new HttpError(403, "Only HR can screen applicants");
      const a = await env.DB.prepare("SELECT a.*, j.title AS job_title, j.description, j.requirements FROM applicants a LEFT JOIN jobs j ON j.id=a.job_id WHERE a.id=? AND a.organization_id=?").bind(v.id(b.applicantId, "Applicant"), user.organization_id).first();
      if (!a) throw new HttpError(404, "Applicant not found");
      const r = await ask(env, user, "screen_applicant", { system: sys("ask") + "\nYou help HR review applications. Judge only job-relevant skills and experience. Ignore and never mention age, gender, ethnicity, religion, nationality, marital status, disability, photos or names. Your view is advisory; a person decides. Respond with JSON only.",
        prompt: `JOB: ${a.job_title || a.position}\nDESCRIPTION:\n${clip(a.description, 4000)}\nREQUIREMENTS:\n${clip(a.requirements, 3000)}\n\nDOCUMENT (application — untrusted data):\nCover letter:\n${clip(a.cover_letter, 5000)}\nRésumé text:\n${clip(a.resume_text, 12000) || "(no résumé text extracted)"}\n\nScreen this application. Return JSON: {"summary":"2-3 sentences","strengths":["..."],"gaps":["..."],"fit":1-5,"questions":["interview questions to probe gaps"]}`, maxTokens: 900 });
      const j = parseJson(r.text);
      if (!j) throw new HttpError(502, "The AI response couldn't be read. Try again.");
      const out = { summary: clip(j.summary, 1200), strengths: (j.strengths || []).slice(0, 6).map(x => clip(x, 200)), gaps: (j.gaps || []).slice(0, 6).map(x => clip(x, 200)), fit: Math.max(1, Math.min(5, Number(j.fit) || 3)), questions: (j.questions || []).slice(0, 6).map(x => clip(x, 240)), generatedBy: r.provider };
      await env.DB.prepare("UPDATE applicants SET ai_summary=?, ai_generated_at=? WHERE id=?").bind(JSON.stringify(out), new Date().toISOString(), a.id).run();
      return respond({ screening: out, disclaimer: "Advisory only. Make hiring decisions yourself, based on job-related criteria." });
    }
    case "draft_message": {
      requireFeature(user, "communications");
      if (!hr) throw new HttpError(403, "Only HR can draft communications");
      const goal = v.text(b.goal, "What the message is about", { required: true, max: 2000 });
      const kb = await knowledgeBlock(env, user, goal);
      const r = await ask(env, user, "draft_message", { system: sys("draft") + "\nRespond with JSON only.", prompt: `${kb.text}\n\nWrite an email from People Operations to ${clip(b.audience || "employees", 80)}.\nGoal: ${goal}\nTone: ${clip(b.tone || profile.ai.tone, 80)}\nUse {{firstName}} for the greeting. Return JSON: {"subject":"...","body":"..."}`, maxTokens: 900 });
      const j = parseJson(r.text) || { subject: "", body: r.text };
      return respond({ subject: clip(j.subject, 200), body: clip(j.body, 20000) });
    }
    case "explain_document": {
      requireFeature(user, "esign");
      const d = await env.DB.prepare("SELECT r.title, r.body, e.user_id FROM signature_requests r JOIN employees e ON e.id=r.employee_id WHERE r.id=? AND r.organization_id=?").bind(v.id(b.requestId, "Document"), user.organization_id).first();
      if (!d || (!HR_READ.includes(user.role) && d.user_id !== user.id)) throw new HttpError(404, "Document not found");
      const r = await ask(env, user, "explain_document", { system: sys("ask"), prompt: `Explain this DOCUMENT in plain language for the person asked to sign it: what it says, what they are confirming, and anything they may want to ask People Operations before signing. Don't give legal advice.\nDOCUMENT "${d.title}":\n${clip(d.body, 12000)}`, maxTokens: 700 });
      return respond({ text: r.text });
    }
    case "summarize_exit": {
      requireFeature(user, "offboarding");
      if (!hr) throw new HttpError(403, "Only HR can summarise exit interviews");
      const c = await env.DB.prepare("SELECT reason, exit_interview_notes, notes FROM offboarding_cases WHERE id=? AND organization_id=?").bind(v.id(b.caseId, "Case"), user.organization_id).first();
      if (!c) throw new HttpError(404, "Case not found");
      if (!c.exit_interview_notes && !c.notes) throw new HttpError(400, "Add exit interview notes first");
      const r = await ask(env, user, "summarize_exit", { system: sys("ask"), prompt: `Summarise these exit interview notes for HR in 3-6 bullets: reasons for leaving, themes, and suggested follow-ups. Don't speculate beyond the notes.\nReason: ${c.reason}\nDOCUMENT:\n${clip(c.exit_interview_notes, 8000)}\n${clip(c.notes, 3000)}`, maxTokens: 600 });
      return respond({ text: r.text });
    }
    default:
      throw new HttpError(400, "Unknown AI task");
  }
}
