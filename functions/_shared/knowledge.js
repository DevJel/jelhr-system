// Organization knowledge base for the AI assistant: chunking, indexing and retrieval.
// Retrieval is always filtered by organization_id (and audience), so one organization's
// handbook can never surface in another's answers. Uses keyword scoring in D1 by default,
// and Cloudflare Vectorize (namespace = organization id) when VECTORIZE + AI are bound.

const STOP = new Set("a an and are as at be by for from has have i if in into is it its of on or our that the their them they this to was we what when where which who will with you your can do does how may should would about also any been being but each more most not only other some such than then there these those very via within without per".split(" "));
export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";

export function tokenize(text) {
  return String(text).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
}
const stem = w => w.replace(/(ings|ing|ies|es|s|ed)$/, "") || w;

/** Split a document into ~900-character chunks, keeping the nearest heading with each chunk. */
export function chunkText(content, max = 900) {
  const lines = String(content).replace(/\r/g, "").split("\n");
  const chunks = [];
  let heading = "", buf = [];
  const flush = () => { const body = buf.join("\n").trim(); if (body) chunks.push({ heading, content: body }); buf = []; };
  for (const line of lines) {
    const h = /^(#{1,4}\s+|\d+(\.\d+)*[.)]?\s+[A-Z])/.test(line.trim()) && line.trim().length < 120;
    if (h) { flush(); heading = line.replace(/^#+\s*/, "").trim(); continue; }
    buf.push(line);
    if (buf.join("\n").length > max) {
      const text = buf.join("\n");
      const cut = Math.max(text.lastIndexOf("\n\n", max), text.lastIndexOf(". ", max));
      const at = cut > max * 0.4 ? cut + 1 : max;
      chunks.push({ heading, content: text.slice(0, at).trim() });
      buf = [text.slice(at)];
    }
  }
  flush();
  return chunks.slice(0, 400);
}

export function indexStatements(env, { orgId, docId, audience, title, content }) {
  const chunks = chunkText(content);
  return {
    count: chunks.length,
    chunks,
    statements: [
      env.DB.prepare("DELETE FROM knowledge_chunks WHERE doc_id=?").bind(docId),
      ...chunks.map((c, i) => env.DB.prepare("INSERT INTO knowledge_chunks(id,organization_id,doc_id,audience,position,heading,content,terms) VALUES(?,?,?,?,?,?,?,?)")
        .bind(`${docId}:${i}`, orgId, docId, audience, i, c.heading || title, c.content, [...new Set(tokenize(title + " " + c.heading + " " + c.content).map(stem))].join(" ")))
    ]
  };
}

/** Optional semantic index in Vectorize. Failures are ignored (keyword search still works). */
export async function vectorUpsert(env, { orgId, docId, audience, chunks, title }) {
  if (!env.VECTORIZE || !env.AI) return;
  try {
    const texts = chunks.map(c => `${title} — ${c.heading || ""}\n${c.content}`.slice(0, 2000));
    for (let i = 0; i < texts.length; i += 50) {
      const { data } = await env.AI.run(EMBED_MODEL, { text: texts.slice(i, i + 50) });
      await env.VECTORIZE.upsert(data.map((values, j) => ({ id: `${docId}:${i + j}`, values, namespace: orgId, metadata: { doc_id: docId, audience } })));
    }
  } catch (e) { console.error("vectorize upsert", e?.message); }
}
export async function vectorDelete(env, docId, count) {
  if (!env.VECTORIZE) return;
  try { await env.VECTORIZE.deleteByIds(Array.from({ length: count }, (_, i) => `${docId}:${i}`)); } catch {}
}

/** Top chunks for a question within one organization. HR-only chunks require includeHr. */
export async function searchKnowledge(env, orgId, query, { includeHr = false, limit = 5 } = {}) {
  const audiences = includeHr ? ["all", "hr"] : ["all"];
  const terms = [...new Set(tokenize(query).map(stem))].slice(0, 10);
  let rows = [];
  if (env.VECTORIZE && env.AI) {
    try {
      const { data } = await env.AI.run(EMBED_MODEL, { text: [query.slice(0, 2000)] });
      const res = await env.VECTORIZE.query(data[0], { topK: 12, namespace: orgId, returnMetadata: "all" });
      const ids = (res.matches || []).filter(m => audiences.includes(m.metadata?.audience)).map(m => m.id);
      if (ids.length) {
        const r = await env.DB.prepare(`SELECT c.*, d.title, d.category FROM knowledge_chunks c JOIN knowledge_docs d ON d.id=c.doc_id WHERE c.organization_id=? AND c.id IN (${ids.map(() => "?").join(",")})`).bind(orgId, ...ids).all();
        const order = new Map(ids.map((id, i) => [id, i]));
        rows = (r.results || []).sort((a, b) => order.get(a.id) - order.get(b.id)).map(x => ({ ...x, score: 10 - order.get(x.id) }));
      }
    } catch (e) { console.error("vectorize query", e?.message); }
  }
  if (!rows.length && terms.length) {
    const like = terms.map(() => "c.terms LIKE ?").join(" OR ");
    const r = await env.DB.prepare(`SELECT c.*, d.title, d.category FROM knowledge_chunks c JOIN knowledge_docs d ON d.id=c.doc_id WHERE c.organization_id=? AND c.audience IN (${audiences.map(() => "?").join(",")}) AND (${like}) LIMIT 300`)
      .bind(orgId, ...audiences, ...terms.map(t => `%${t}%`)).all();
    const docs = r.results || [];
    const df = Object.fromEntries(terms.map(t => [t, docs.filter(d => d.terms.split(" ").includes(t)).length || 1]));
    rows = docs.map(d => {
      const words = d.terms.split(" ");
      const score = terms.reduce((s, t) => s + (words.includes(t) ? Math.log(1 + docs.length / df[t]) : 0), 0) + (tokenize(d.title).some(w => terms.includes(stem(w))) ? 0.5 : 0);
      return { ...d, score };
    }).filter(d => d.score > 0).sort((a, b) => b.score - a.score);
  }
  return rows.slice(0, limit).map(r => ({ id: r.id, docId: r.doc_id, title: r.title, category: r.category, heading: r.heading, content: r.content }));
}
