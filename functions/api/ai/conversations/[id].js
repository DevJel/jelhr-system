import { respond, HttpError } from "../../../_shared/http.js";
import { authenticate } from "../../../_shared/auth.js";
import * as v from "../../../_shared/validate.js";

// Conversations are private: only the owner can read or delete them (no admin access).
async function own(context, user) {
  const c = await context.env.DB.prepare("SELECT * FROM ai_conversations WHERE id=? AND user_id=?").bind(v.id(context.params.id), user.id).first();
  if (!c) throw new HttpError(404, "Conversation not found");
  return c;
}
export async function onRequestGet(context) {
  const user = await authenticate(context);
  const c = await own(context, user);
  const { results } = await context.env.DB.prepare("SELECT role, content, sources_json, created_at FROM ai_messages WHERE conversation_id=? ORDER BY created_at").bind(c.id).all();
  return respond({ conversation: c, messages: (results || []).map(m => ({ ...m, sources: m.sources_json ? JSON.parse(m.sources_json) : [] })) });
}
export async function onRequestDelete(context) {
  const user = await authenticate(context);
  const c = await own(context, user);
  await context.env.DB.batch([context.env.DB.prepare("DELETE FROM ai_messages WHERE conversation_id=?").bind(c.id), context.env.DB.prepare("DELETE FROM ai_conversations WHERE id=?").bind(c.id)]);
  return respond({ ok: true });
}
