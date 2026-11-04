// Minimal WebAuthn (passkeys) relying party: registration with "none" attestation and
// assertion verification for ES256 (P-256) and RS256 keys. No dependencies.
import { b64url, fromB64url } from "./crypto.js";

const dec = new TextDecoder();

// ---------- CBOR (subset sufficient for attestation objects and COSE keys)
export function cborDecode(bytes) {
  let pos = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readLen = info => {
    if (info < 24) return info;
    if (info === 24) return view.getUint8(pos++);
    if (info === 25) { const v = view.getUint16(pos); pos += 2; return v; }
    if (info === 26) { const v = view.getUint32(pos); pos += 4; return v; }
    if (info === 27) { const hi = view.getUint32(pos), lo = view.getUint32(pos + 4); pos += 8; return hi * 2 ** 32 + lo; }
    throw new Error("CBOR: unsupported length");
  };
  const item = () => {
    const first = view.getUint8(pos++);
    const major = first >> 5, info = first & 31;
    switch (major) {
      case 0: return readLen(info);
      case 1: return -1 - readLen(info);
      case 2: { const n = readLen(info); const v = bytes.slice(pos, pos + n); pos += n; return v; }
      case 3: { const n = readLen(info); const v = dec.decode(bytes.slice(pos, pos + n)); pos += n; return v; }
      case 4: { const n = readLen(info); const a = []; for (let i = 0; i < n; i++) a.push(item()); return a; }
      case 5: { const n = readLen(info); const m = new Map(); for (let i = 0; i < n; i++) { const k = item(); m.set(k, item()); } return m; }
      case 7: if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; throw new Error("CBOR: unsupported simple value");
      default: throw new Error("CBOR: unsupported major type " + major);
    }
  };
  const value = item();
  return { value, length: pos };
}

export function parseAuthData(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const rpIdHash = data.slice(0, 32);
  const flags = data[32];
  const signCount = view.getUint32(33);
  const out = { rpIdHash, flags, signCount, up: !!(flags & 1), uv: !!(flags & 4), at: !!(flags & 64) };
  if (out.at) {
    const credIdLen = view.getUint16(53);
    out.credentialId = data.slice(55, 55 + credIdLen);
    const rest = data.slice(55 + credIdLen);
    const { value, length } = cborDecode(rest);
    out.cosePublicKey = value;
    out.coseLength = length;
  }
  return out;
}

/** COSE key → JWK (+ alg for WebCrypto). */
export function coseToJwk(cose) {
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2 && alg === -7) {
    return { kty: "EC", crv: "P-256", x: b64url(cose.get(-2)), y: b64url(cose.get(-3)), alg: "ES256", ext: true };
  }
  if (kty === 3 && alg === -257) {
    return { kty: "RSA", n: b64url(cose.get(-1)), e: b64url(cose.get(-2)), alg: "RS256", ext: true };
  }
  throw new Error("Unsupported passkey algorithm. Use a device that supports ES256 or RS256.");
}

async function sha256(bytes) { return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)); }
const equalBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** DER-encoded ECDSA signature → raw r||s (64 bytes) for WebCrypto. */
export function derToRaw(der) {
  let p = 2;
  if (der[1] & 0x80) p = 2 + (der[1] & 0x7f);
  const readInt = () => {
    if (der[p] !== 0x02) throw new Error("Bad DER signature");
    const len = der[p + 1];
    let v = der.slice(p + 2, p + 2 + len);
    p += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32); out.set(v, 32 - v.length);
    return out;
  };
  const r = readInt(), s = readInt();
  const raw = new Uint8Array(64); raw.set(r); raw.set(s, 32);
  return raw;
}

function checkClientData(clientDataJSON, { type, challenge, origins }) {
  const data = JSON.parse(dec.decode(clientDataJSON));
  if (data.type !== type) throw new Error("Unexpected WebAuthn ceremony type");
  if (data.challenge !== challenge) throw new Error("Challenge mismatch");
  if (!origins.includes(data.origin)) throw new Error("Origin mismatch: " + data.origin);
  return data;
}

/** Acceptable origins for a request: its own origin, plus http for localhost development. */
export function rpFromRequest(request, env = {}) {
  const url = new URL(request.url);
  const origins = [url.origin];
  if (url.hostname === "localhost") origins.push(`http://localhost${url.port ? ":" + url.port : ""}`);
  if (env.JELHR_WEBAUTHN_ORIGINS) origins.push(...String(env.JELHR_WEBAUTHN_ORIGINS).split(",").map(s => s.trim()).filter(Boolean));
  return { rpId: env.JELHR_WEBAUTHN_RP_ID || url.hostname, origins };
}

export async function verifyRegistration({ attestationObject, clientDataJSON }, { challenge, rpId, origins }) {
  const cd = fromB64url(clientDataJSON);
  checkClientData(cd, { type: "webauthn.create", challenge, origins });
  const { value: att } = cborDecode(fromB64url(attestationObject));
  const authData = parseAuthData(att.get("authData"));
  if (!equalBytes(authData.rpIdHash, await sha256(new TextEncoder().encode(rpId)))) throw new Error("Relying party mismatch");
  if (!authData.up) throw new Error("User presence required");
  if (!authData.at || !authData.credentialId) throw new Error("No credential in attestation");
  const jwk = coseToJwk(authData.cosePublicKey);
  return { credentialId: b64url(authData.credentialId), jwk, signCount: authData.signCount, userVerified: authData.uv };
}

export async function verifyAssertion({ authenticatorData, clientDataJSON, signature }, { challenge, rpId, origins, jwk, signCount }) {
  const cd = fromB64url(clientDataJSON);
  checkClientData(cd, { type: "webauthn.get", challenge, origins });
  const ad = fromB64url(authenticatorData);
  const parsed = parseAuthData(ad);
  if (!equalBytes(parsed.rpIdHash, await sha256(new TextEncoder().encode(rpId)))) throw new Error("Relying party mismatch");
  if (!parsed.up) throw new Error("User presence required");
  const signed = new Uint8Array(ad.length + 32);
  signed.set(ad); signed.set(await sha256(cd), ad.length);
  const sig = fromB64url(signature);
  let ok;
  if (jwk.kty === "EC") {
    const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(sig), signed);
  } else {
    const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, signed);
  }
  if (!ok) throw new Error("Passkey signature is invalid");
  // Counter regression suggests a cloned authenticator (0 = authenticator doesn't count).
  if (parsed.signCount !== 0 && signCount !== 0 && parsed.signCount <= signCount) throw new Error("Passkey counter did not increase");
  return { signCount: parsed.signCount, userVerified: parsed.uv };
}
