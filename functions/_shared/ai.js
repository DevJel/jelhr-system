// AI provider abstraction.
//   workers-ai  Cloudflare Workers AI via the AI binding ([ai] binding = "AI") — default when bound.
//   openai      Any OpenAI-compatible Chat Completions API (OpenAI, Azure OpenAI, Groq, OpenRouter, Together…).
//   anthropic   Anthropic Messages API.
//   mock        Deterministic offline replies for development and tests (never in production).
// Outputs are suggestions for a person to review; JelHR never acts on them automatically.
import { HttpError } from "./http.js";
import { secret } from "./secrets.js";

export const DEFAULT_WORKERS_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export function aiProvider(env) {
  const p = String(env.AI_PROVIDER || "").toLowerCase();
  if (p) return p;
  return env.AI && typeof env.AI.run === "function" ? "workers-ai" : null;
}

export function aiStatus(env) {
  const provider = aiProvider(env);
  if (provider === "workers-ai") return env.AI ? { provider, configured: true, model: env.AI_MODEL || DEFAULT_WORKERS_MODEL, detail: "Cloudflare Workers AI" } : { provider, configured: false, detail: "Add the AI binding ([ai] binding = \"AI\") to wrangler.toml" };
  if (provider === "openai") return { provider, configured: Boolean(env.AI_API_KEY && env.AI_MODEL), model: env.AI_MODEL || null, detail: env.AI_API_KEY ? `OpenAI-compatible API (${env.AI_API_BASE || "api.openai.com"})` : "Set AI_API_KEY and AI_MODEL" };
  if (provider === "anthropic") return { provider, configured: Boolean(env.ANTHROPIC_API_KEY), model: env.AI_MODEL || "claude-haiku-5-5", detail: env.ANTHROPIC_API_KEY ? "Anthropic API" : "Set ANTHROPIC_API_KEY" };
  if (provider === "mock") return env.JELHR_ENV === "production" ? { provider, configured: false, detail: "The mock AI provider is disabled in production" } : { provider, configured: true, model: "mock", detail: "Development mock — replies are canned examples" };
  return { provider: null, configured: false, detail: "AI is not configured. Bind Workers AI or set AI_PROVIDER." };
}

function mockReply(system, prompt) {
  const p = prompt.toLowerCase();
  if (system.includes("JSON")) {
    if (p.includes("screen")) return JSON.stringify({ summary: "Example summary: relevant experience in the role's core area, clear written communication.", strengths: ["Relevant experience", "Clear communication"], gaps: ["No evidence of people management"], fit: 3, questions: ["Tell us about a project you led end to end."] });
    if (p.includes("subject")) return JSON.stringify({ subject: "A quick update from the People team", body: "Hi {{firstName}},\n\nThis is an example draft written by the development mock AI provider.\n\nThanks,\nPeople Operations" });
    if (p.includes("job")) return JSON.stringify({ summary: "Example summary for this role.", description: "About the role\nThis is an example description from the mock AI provider.\n\nWhat you'll do\n- Own a meaningful area of work\n- Collaborate across teams", requirements: "- Relevant experience\n- Clear written communication" });
    return JSON.stringify({ text: "Example response from the development mock AI provider." });
  }
  return "Example response from the development mock AI provider. Configure Workers AI or another provider for real answers.";
}

/** Run a chat completion. Returns { text, provider, model }. Throws HttpError on failure. */
export async function runAI(env, { system, prompt, maxTokens = 800, temperature = 0.4 }) {
  const status = aiStatus(env);
  if (!status.configured) throw new HttpError(503, "AI isn't available: " + status.detail, { code: "ai_unavailable" });
  const messages = [{ role: "system", content: system }, { role: "user", content: prompt }];
  const fetcher = env.__fetch || fetch;
  let text;
  try {
    if (status.provider === "workers-ai") {
      const r = await env.AI.run(status.model, { messages, max_tokens: maxTokens, temperature });
      text = typeof r === "string" ? r : r?.response ?? r?.result?.response ?? r?.choices?.[0]?.message?.content;
      if (text && typeof text === "object") text = JSON.stringify(text);
    } else if (status.provider === "openai") {
      const base = String(env.AI_API_BASE || "https://api.openai.com/v1").replace(/\/$/, "");
      const r = await fetcher(base + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await secret(env, "AI_API_KEY")) }, body: JSON.stringify({ model: env.AI_MODEL, messages, max_tokens: maxTokens, temperature }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error?.message || "status " + r.status);
      text = d.choices?.[0]?.message?.content;
    } else if (status.provider === "anthropic") {
      const r = await fetcher("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": await secret(env, "ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: status.model, system, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error?.message || "status " + r.status);
      text = (d.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
    } else if (status.provider === "mock") {
      text = mockReply(system, prompt);
    }
  } catch (e) {
    throw new HttpError(502, "The AI service didn't respond: " + String(e.message || e).slice(0, 200), { code: "ai_failed" });
  }
  if (!text) throw new HttpError(502, "The AI service returned an empty answer", { code: "ai_failed" });
  return { text: String(text).trim(), provider: status.provider, model: status.model };
}

/** Extract the first JSON object from model output (models sometimes wrap it in prose or fences). */
export function parseJson(text) {
  const s = String(text);
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

/** Convert an uploaded document to text with Workers AI toMarkdown when available. */
export async function documentToText(env, { bytes, type, name }) {
  if (type === "text/plain") return new TextDecoder().decode(bytes).slice(0, 20000);
  if (!env.AI || typeof env.AI.toMarkdown !== "function") return null;
  try {
    const out = await env.AI.toMarkdown([{ name, blob: new Blob([bytes], { type }) }]);
    const first = Array.isArray(out) ? out[0] : out;
    return String(first?.data || "").slice(0, 20000) || null;
  } catch { return null; }
}
