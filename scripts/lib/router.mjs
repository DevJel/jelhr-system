// Minimal emulation of Cloudflare Pages Functions file-based routing:
// index.js, [param].js, [[catchall]].js, onRequest<Method> exports and _middleware.js chains.
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

export async function createRouter(functionsDir) {
  const routes = [];
  const middlewares = [];
  for (const file of walk(functionsDir)) {
    const rel = relative(functionsDir, file).split(sep);
    if (rel[0].startsWith("_")) continue; // shared modules, not routes
    const mod = await import(pathToFileURL(file).href);
    const segs = rel.slice(0, -1);
    const base = rel.at(-1).replace(/\.js$/, "");
    if (base === "_middleware") { middlewares.push({ prefix: segs, mod }); continue; }
    if (base !== "index") segs.push(base);
    const score = segs.reduce((s, x) => s + (x.startsWith("[[") ? 1 : x.startsWith("[") ? 10 : 100), 0) + segs.length * 1000;
    routes.push({ segs, mod, score });
  }
  routes.sort((a, b) => b.score - a.score);

  function match(pathname) {
    const parts = pathname.split("/").filter(Boolean);
    for (const r of routes) {
      const params = {};
      let ok = true, i = 0;
      for (; i < r.segs.length; i++) {
        const s = r.segs[i];
        if (s.startsWith("[[")) { params[s.slice(2, -2)] = parts.slice(i); i = parts.length; break; }
        if (i >= parts.length) { ok = false; break; }
        if (s.startsWith("[")) params[s.slice(1, -1)] = decodeURIComponent(parts[i]);
        else if (s !== parts[i]) { ok = false; break; }
      }
      if (ok && i === parts.length) return { route: r, params };
    }
    return null;
  }

  return async function handle(request, env) {
    const url = new URL(request.url);
    const found = match(url.pathname);
    if (!found) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const chain = middlewares
      .filter(m => m.prefix.every((p, i) => parts[i] === p))
      .sort((a, b) => a.prefix.length - b.prefix.length)
      .map(m => m.mod.onRequest);
    const method = request.method[0] + request.method.slice(1).toLowerCase();
    const handler = found.route.mod["onRequest" + method] || found.route.mod.onRequest;
    const final = handler
      ? ctx => handler(ctx)
      : () => Response.json({ error: "Method not allowed" }, { status: 405 });
    const ctx = { request, env, params: found.params, data: {}, waitUntil() {}, next: null };
    let index = 0;
    ctx.next = async () => {
      const fn = chain[index++];
      return fn ? fn(ctx) : final(ctx);
    };
    return ctx.next();
  };
}
