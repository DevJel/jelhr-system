// Minimal AWS Signature Version 4 signer using WebCrypto (no SDK, runs in Workers).
const enc = new TextEncoder();
const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const sha256 = async data => toHex(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data));
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}
const rfc3986 = s => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export function amzDates(date = new Date()) {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * Sign a request. `headers` must contain every header to be signed (host is added from the URL).
 * Returns the headers to send, including Authorization and x-amz-date.
 */
export async function signV4({ method, url, region, service, accessKeyId, secretAccessKey, sessionToken, body = "", headers = {}, date = new Date() }) {
  const u = new URL(url);
  const { amzDate, dateStamp } = amzDates(date);
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")])), host: u.host, "x-amz-date": amzDate };
  if (sessionToken) all["x-amz-security-token"] = sessionToken;
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map(n => `${n}:${all[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalUri = u.pathname.split("/").map(seg => rfc3986(decodeURIComponent(seg))).join("/") || "/";
  const canonicalQuery = [...u.searchParams.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join("&");
  const payloadHash = await sha256(body);
  const canonicalRequest = [method.toUpperCase(), canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256(canonicalRequest)].join("\n");
  const kDate = await hmac("AWS4" + secretAccessKey, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));
  const out = { ...all };
  delete out.host;
  out.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers: out, signature, canonicalRequest, stringToSign };
}
