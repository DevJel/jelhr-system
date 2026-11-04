import { respond } from "../_shared/http.js";
import { emailStatus } from "../_shared/email.js";
import { platformConfigured } from "../_shared/platform.js";
import { aiStatus } from "../_shared/ai.js";

// API/schema release. The v0.4 frontend screens are still in progress.
export const VERSION = "0.4.0";

// Public health probe. Reports readiness only — never secrets or configuration values.
export async function onRequestGet({ env }) {
  let database = "unavailable";
  try { await env.DB.prepare("SELECT 1 AS ok").first(); database = "connected"; } catch {}
  let schema = "unknown";
  if (database === "connected") {
    try { await env.DB.prepare("SELECT 1 FROM signature_requests LIMIT 1").all(); schema = "current"; } catch { schema = "migration_required"; }
  }
  const ok = database === "connected" && schema === "current";
  const platformAdmin = await platformConfigured(env);
  const email = emailStatus(env);
  const ai = aiStatus(env);
  return respond({
    service: "JelHR System", version: VERSION, status: ok ? "ok" : "degraded", database, schema,
    auth: Boolean(env.JELHR_JWT_SECRET && env.JELHR_JWT_SECRET.length >= 32),
    platformAdmin,
    email: email.configured,
    ai: ai.configured,
    aiProvider: ai.provider,
    fileStorage: env.FILES ? "r2" : "d1",
    vectorize: Boolean(env.VECTORIZE),
    mailer: Boolean(env.MAILER),
    timestamp: new Date().toISOString()
  }, ok ? 200 : 503);
}
