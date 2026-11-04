// API middleware: error handling, CSRF/Origin enforcement, body limits, read-only demo role.
import { respond, HttpError, BASE_HEADERS } from "../_shared/http.js";
import { ResponseError, readSessionToken } from "../_shared/auth.js";
import { verifyJwt } from "../_shared/crypto.js";
import { readPlatformToken } from "../_shared/platform.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const MAX_BODY = 512 * 1024; // default; upload routes allow more
const BIG_BODY = /^\/api\/(public\/jobs\/[^/]+\/apply|employees\/[^/]+\/documents|knowledge(\/[^/]+)?|settings)$/;
// Routes that do not use the session cookie and authenticate in other ways.
const COOKIELESS = new Set(["/api/auth/login", "/api/auth/bootstrap", "/api/health", "/api/platform/login", "/api/platform/logout", "/api/auth/mfa", "/api/auth/passkey", "/api/auth/invite"]);
const isPublic = p => p.startsWith("/api/public/");

function hardenResponse(response, requestId) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(BASE_HEADERS)) headers.set(key, value);
  if (requestId) headers.set("X-Request-Id", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function sameOrigin(request) {
  const self = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (origin) return origin === self;
  const site = request.headers.get("Sec-Fetch-Site");
  if (site) return site === "same-origin" || site === "none";
  // No browser provenance headers at all: a non-browser client (curl, CI).
  // It cannot ride on a victim's cookie, so treat it as same-origin only when no cookie is sent.
  return !readSessionToken(request) && !readPlatformToken(request);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const requestId = crypto.randomUUID();
  try {
    if (!SAFE.has(request.method)) {
      if (!sameOrigin(request)) return respond({ error: "Cross-site request blocked" }, 403);
      const length = Number(request.headers.get("Content-Length") || 0);
      if (length > (BIG_BODY.test(url.pathname) ? 9 * 1024 * 1024 : MAX_BODY)) return respond({ error: "Request body is too large" }, 413);
      const type = request.headers.get("Content-Type") || "";
      if (length > 0 && !type.toLowerCase().startsWith("application/json")) {
        return respond({ error: "Content-Type must be application/json" }, 415);
      }
      // Demo/auditor accounts are strictly read-only (logout and own password excepted).
      if (!COOKIELESS.has(url.pathname) && !isPublic(url.pathname) && !url.pathname.startsWith("/api/platform/") && !["/api/auth/logout", "/api/auth/password"].includes(url.pathname)) {
        const token = readSessionToken(request);
        const payload = token && env.JELHR_JWT_SECRET ? await verifyJwt(token, env.JELHR_JWT_SECRET) : null;
        if (payload?.role === "auditor") return respond({ error: "Demo accounts are read-only" }, 403);
      }
    }
    const response = await context.next();
    return hardenResponse(response, requestId);
  } catch (error) {
    if (error instanceof ResponseError) return hardenResponse(error.response, requestId);
    if (error instanceof HttpError) return hardenResponse(respond({ error: error.message, ...error.extra }, error.status), requestId);
    console.error(JSON.stringify({ requestId, path: url.pathname, message: error?.message, stack: error?.stack?.slice(0, 800) }));
    return hardenResponse(respond({ error: "Something went wrong. Please try again.", requestId }, 500), requestId);
  }
}
