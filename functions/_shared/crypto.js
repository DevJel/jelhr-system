// Cryptographic helpers built on WebCrypto (available in Workers and Node 20+).
const enc = new TextEncoder();

export const b64url = bytes =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");

export const fromB64url = s =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));

export const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");

export async function sha256b64(value) {
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}

export async function sha256hex(value) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}

/** Constant-time comparison of two strings (length leak only). */
export function safeEqual(a, b) {
  a = String(a ?? "");
  b = String(b ?? "");
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const randomToken = (bytes = 24) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

// ---------------------------------------------------------------------------
// Password hashing
//
// Cloudflare Workers' WebCrypto rejects PBKDF2 iteration counts above 100,000
// ("iteration counts above 100000 are not supported"). 100,000 is therefore the
// strongest PBKDF2 setting the runtime allows. The count is stored with the
// hash so it can be raised later without breaking existing accounts.
// Stored format: pbkdf2-sha256$<iterations>$<hash-b64url>  (salt kept in users.password_salt)
// Legacy rows (bare hash, 210,000 iterations) can never have verified on Workers;
// they are still accepted when the runtime supports them (e.g. local Node).
// ---------------------------------------------------------------------------
export const PBKDF2_ITERATIONS = 100000;
const LEGACY_ITERATIONS = 210000;

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return b64url(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(salt), iterations, hash: "SHA-256" }, key, 256));
}

export async function hashPassword(password, salt = randomToken(24)) {
  const digest = await derive(password, salt, PBKDF2_ITERATIONS);
  return { hash: `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${digest}`, salt };
}

export async function verifyPassword(password, salt, stored) {
  if (!stored || !salt) return false;
  let iterations = LEGACY_ITERATIONS, expected = stored;
  const parts = String(stored).split("$");
  if (parts.length === 3 && parts[0] === "pbkdf2-sha256") {
    iterations = Number(parts[1]);
    expected = parts[2];
  }
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  try {
    return safeEqual(await derive(password, salt, iterations), expected);
  } catch {
    return false; // runtime refused the iteration count
  }
}

/** Burn comparable CPU time when the account does not exist, to blunt user enumeration. */
export async function dummyPasswordWork(password) {
  await derive(password, "jelhr-dummy-salt-value", PBKDF2_ITERATIONS);
  return false;
}

export function passwordProblem(password) {
  const p = String(password || "");
  if (p.length < 14) return "Password must be at least 14 characters";
  if (p.length > 256) return "Password must be 256 characters or fewer";
  if (/^(.)\1+$/.test(p)) return "Password must not be a single repeated character";
  return null;
}

// ---------------------------------------------------------------------------
// HS256 JWT
// ---------------------------------------------------------------------------
async function hmacKey(secret, usage) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signJwt(payload, secret) {
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const input = head + "." + body;
  return input + "." + b64url(await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(input)));
}

export async function verifyJwt(token, secret) {
  try {
    const [h, b, s, extra] = String(token).split(".");
    if (!h || !b || !s || extra !== undefined) return null;
    const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
    if (header.alg !== "HS256") return null;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), fromB64url(s), enc.encode(h + "." + b));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(b)));
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AES-GCM encryption for secrets at rest (TOTP seeds, SSO client secrets).
// Key: JELHR_ENCRYPTION_KEY if set (recommended), otherwise derived from JELHR_JWT_SECRET.
// ---------------------------------------------------------------------------
async function aesKey(env) {
  const material = env.JELHR_ENCRYPTION_KEY || "jelhr-enc|" + (env.JELHR_JWT_SECRET || "");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(material));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptText(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(String(text)));
  return "v1." + b64url(iv) + "." + b64url(ct);
}
export async function decryptText(env, blob) {
  const [v, iv, ct] = String(blob || "").split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Unsupported ciphertext");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await aesKey(env), fromB64url(ct));
  return new TextDecoder().decode(pt);
}

export async function hmacHex(secretValue, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secretValue), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238, SHA-1, 30 s, 6 digits) — compatible with Google/Microsoft Authenticator, 1Password, Authy.
// ---------------------------------------------------------------------------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(bytes) {
  let bits = 0, value = 0, out = "";
  for (const b of new Uint8Array(bytes)) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0; const out = [];
  for (const c of clean) { value = (value << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
export async function totpCode(secretB32, timeMs = Date.now(), step = 30) {
  const counter = Math.floor(timeMs / 1000 / step);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 255; c = Math.floor(c / 256); }
  const key = await crypto.subtle.importKey("raw", base32Decode(secretB32), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const off = mac[19] & 15;
  const bin = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 1e6).padStart(6, "0");
}
/** Accepts the current code and one step either side (clock drift). Returns the matched counter or null. */
export async function verifyTotp(secretB32, code, timeMs = Date.now()) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  for (const drift of [0, -1, 1]) {
    const t = timeMs + drift * 30000;
    if (safeEqual(await totpCode(secretB32, t), c)) return Math.floor(t / 30000);
  }
  return null;
}
export const randomDigits = (n = 6) => {
  const buf = crypto.getRandomValues(new Uint32Array(n));
  return [...buf].map(x => x % 10).join("");
};
