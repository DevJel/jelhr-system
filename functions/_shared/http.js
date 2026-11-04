// Shared HTTP helpers for Pages Functions.
// Every API response is JSON, never cached, and never sniffed.

export const BASE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload"
};

export function respond(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { ...BASE_HEADERS, ...headers } });
}

export const fail = (status, error, extra = {}) => respond({ error, ...extra }, status);

/** Thrown inside handlers to short-circuit with a JSON error. Caught by the API middleware. */
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export async function readJson(request, maxBytes = 64 * 1024) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > maxBytes) throw new HttpError(413, "Request body is too large");
  let text;
  try { text = await request.text(); } catch { throw new HttpError(400, "Invalid request body"); }
  if (text.length > maxBytes) throw new HttpError(413, "Request body is too large");
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "Request body must be a JSON object");
  }
}

export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);

export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown";
}

export function userAgent(request) {
  return String(request.headers.get("User-Agent") || "").slice(0, 300);
}
