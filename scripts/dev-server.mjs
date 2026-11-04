#!/usr/bin/env node
// Offline local server: serves frontend/ with _headers and runs Pages Functions against
// a node:sqlite D1 shim. No Cloudflare account or wrangler needed.
//   node scripts/dev-server.mjs [--port 8788] [--seed] [--db .wrangler/dev.sqlite]
// For production parity use `npm run dev` (wrangler pages dev) instead.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { D1Shim } from "./lib/d1-shim.mjs";
import { createRouter } from "./lib/router.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const port = Number(arg("--port", process.env.PORT || 8788));
const dbPath = arg("--db", ":memory:");
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
const fresh = dbPath === ":memory:" || !existsSync(dbPath);

const vars = {};
const varsFile = join(root, ".dev.vars");
if (existsSync(varsFile)) for (const line of readFileSync(varsFile, "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line); if (m) vars[m[1]] = m[2]; }
const env = {
  JELHR_JWT_SECRET: "local-dev-secret-change-me-0123456789abcdef",
  JELHR_SUPERADMIN_EMAIL: "platform@jelhr.local",
  JELHR_SUPERADMIN_PASSWORD: "local-platform-password-123",
  EMAIL_PROVIDER: "log", EMAIL_FROM: "hr@jelhr.local", JELHR_ENV: "development",
  ...vars,
  DB: new D1Shim(dbPath)
};
if (fresh) env.DB.migrate(join(root, "migrations"));
const handle = await createRouter(join(root, "functions"));

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const headerRules = readFileSync(join(root, "frontend/_headers"), "utf8").split(/\n(?=\/)/).map(block => {
  const [pattern, ...lines] = block.trim().split("\n");
  return { re: new RegExp("^" + pattern.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"), headers: lines.map(l => l.trim()).filter(Boolean).map(l => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]) };
});

if (args.includes("--seed") && fresh) {
  const { seed } = await import("./lib/seed.mjs");
  const accounts = await seed(env);
  console.log("Seeded synthetic demo data:", accounts);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const headers = new Headers(Object.entries(req.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => [k, x]) : [[k, v]])));
      headers.set("CF-Connecting-IP", req.socket.remoteAddress || "127.0.0.1");
      // Browsers send Origin http://localhost; the emulated request URL is https, so normalise.
      if (headers.get("origin")?.startsWith("http://localhost")) headers.set("origin", `https://localhost:${port}`);
      const request = new Request(`https://localhost:${port}${url.pathname}${url.search}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
      const response = await handle(request, env);
      res.statusCode = response.status;
      response.headers.forEach((v, k) => { if (k !== "set-cookie") res.setHeader(k, v); });
      const cookies = response.headers.getSetCookie?.() || [];
      if (cookies.length) res.setHeader("set-cookie", cookies);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (path.endsWith("/")) path += "index.html";
    let file = join(root, "frontend", path);
    if (!existsSync(file) && existsSync(file + ".html")) file += ".html";
    let status = 200;
    if (!file.startsWith(join(root, "frontend")) || !existsSync(file) || statSync(file).isDirectory() || /\/_(headers|redirects)$/.test(file)) { file = join(root, "frontend/404.html"); status = 404; }
    res.statusCode = status;
    res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
    for (const rule of headerRules) if (rule.re.test(url.pathname)) for (const [k, v] of rule.headers) if (!/strict-transport|upgrade-insecure/i.test(k + v)) res.setHeader(k, k.toLowerCase() === "content-security-policy" ? v.replace("; upgrade-insecure-requests", "") : v);
    res.end(readFileSync(file));
  } catch (e) {
    console.error(e);
    res.statusCode = 500; res.end("Internal error");
  }
}).listen(port, () => console.log(`JelHR local server on http://localhost:${port}  (platform: ${env.JELHR_SUPERADMIN_EMAIL})`));
