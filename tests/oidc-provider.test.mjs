import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, client, setupOrg, ORIGIN } from "../scripts/lib/client.mjs";

async function oidcEnv() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const env = makeEnv({
    JELHR_OIDC_ISSUER: ORIGIN,
    JELHR_OIDC_PRIVATE_JWK: JSON.stringify(privateJwk),
    JELHR_OIDC_KID: "test-operava-key",
    OPERAVA_OIDC_CLIENTS_JSON: JSON.stringify({
      esign: { redirectUris: ["https://esign.example.test/auth/oidc/callback"], scopes: ["openid", "profile", "email"] }
    })
  });
  return { env, publicJwk };
}

const b64url = bytes => Buffer.from(bytes).toString("base64url");
async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(digest) };
}

test("first-party OIDC authorization code, PKCE, RS256 tokens and userinfo", async () => {
  const { env, publicJwk } = await oidcEnv();
  const { owner, orgId } = await setupOrg(env);
  const { verifier, challenge } = await pkce();
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const redirectUri = "https://esign.example.test/auth/oidc/callback";
  const authorize = new URL(ORIGIN + "/oauth/authorize");
  authorize.search = new URLSearchParams({
    response_type: "code", client_id: "esign", redirect_uri: redirectUri,
    scope: "openid profile email", state, nonce, code_challenge: challenge,
    code_challenge_method: "S256"
  }).toString();
  const started = await owner.get(authorize.pathname + authorize.search);
  assert.equal(started.status, 302);
  const callback = new URL(started.headers.get("Location"));
  assert.equal(callback.origin, "https://esign.example.test");
  assert.equal(callback.searchParams.get("state"), state);
  const code = callback.searchParams.get("code");
  assert.ok(code);

  const bad = await owner.post("/oauth/token", {
    grant_type: "authorization_code", client_id: "esign", redirect_uri: redirectUri,
    code, code_verifier: "A".repeat(43)
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, "invalid_grant");

  const exchanged = await owner.post("/oauth/token", {
    grant_type: "authorization_code", client_id: "esign", redirect_uri: redirectUri,
    code, code_verifier: verifier
  });
  assert.equal(exchanged.status, 200);
  assert.equal(exchanged.data.token_type, "Bearer");
  assert.equal(exchanged.data.expires_in, 300);

  const [h, p, s] = exchanged.data.id_token.split(".");
  const header = JSON.parse(Buffer.from(h, "base64url").toString());
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  const verifyKey = await crypto.subtle.importKey(
    "jwk", { ...publicJwk, key_ops: ["verify"], ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  const signatureOk = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", verifyKey, Buffer.from(s, "base64url"),
    new TextEncoder().encode(h + "." + p)
  );
  assert.equal(header.alg, "RS256");
  assert.equal(signatureOk, true);
  assert.equal(claims.iss, ORIGIN);
  assert.equal(claims.aud, "esign");
  assert.equal(claims.nonce, nonce);
  assert.equal(claims.tenantId, orgId);
  assert.equal(claims.userId, claims.sub);

  const userinfo = await owner.raw("GET", "/oauth/userinfo", undefined, {
    Authorization: "Bearer " + exchanged.data.access_token
  });
  assert.equal(userinfo.status, 200);
  assert.equal(userinfo.data.sub, claims.sub);
  assert.equal(userinfo.data.tenantId, orgId);

  const replay = await owner.post("/oauth/token", {
    grant_type: "authorization_code", client_id: "esign", redirect_uri: redirectUri,
    code, code_verifier: verifier
  });
  assert.equal(replay.status, 400);
  assert.equal(replay.data.error, "invalid_grant");
});

test("OIDC rejects unregistered redirect URIs and unauthenticated authorize redirects to login", async () => {
  const { env } = await oidcEnv();
  const unauthenticated = client(env);
  const params = new URLSearchParams({
    response_type: "code", client_id: "esign",
    redirect_uri: "https://evil.example/callback", scope: "openid",
    state: "state-value-that-is-long-enough", nonce: "nonce-value-that-is-long-enough",
    code_challenge: "A".repeat(43), code_challenge_method: "S256"
  });
  const rejected = await unauthenticated.get("/oauth/authorize?" + params.toString());
  assert.equal(rejected.status, 400);
  assert.equal(rejected.data.error, "invalid_redirect_uri");

  params.set("redirect_uri", "https://esign.example.test/auth/oidc/callback");
  const login = await unauthenticated.get("/oauth/authorize?" + params.toString());
  assert.equal(login.status, 302);
  const location = new URL(login.headers.get("Location"));
  assert.equal(location.pathname, "/login.html");
  assert.ok(location.searchParams.get("returnTo").startsWith("/oauth/authorize?"));
});

test("confidential Cloudflare Access OIDC client authenticates with client_secret_basic", async () => {
  const secret = "operava-cloudflare-access-client-secret-for-tests";
  const secretHash = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const env = makeEnv({
    JELHR_OIDC_ISSUER: ORIGIN,
    JELHR_OIDC_PRIVATE_JWK: JSON.stringify(privateJwk),
    JELHR_OIDC_KID: "test-operava-access-key",
    OPERAVA_OIDC_CLIENTS_JSON: JSON.stringify({
      "cloudflare-access": {
        redirectUris: ["https://test-team.cloudflareaccess.com/cdn-cgi/access/callback"],
        scopes: ["openid", "profile", "email"],
        clientSecretHash: secretHash
      }
    })
  });
  const { owner } = await setupOrg(env);
  const { verifier, challenge } = await pkce();
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const redirectUri = "https://test-team.cloudflareaccess.com/cdn-cgi/access/callback";
  const params = new URLSearchParams({
    response_type: "code", client_id: "cloudflare-access", redirect_uri: redirectUri,
    scope: "openid profile email", state, nonce, code_challenge: challenge,
    code_challenge_method: "S256"
  });
  const started = await owner.get("/oauth/authorize?" + params.toString());
  assert.equal(started.status, 302);
  const code = new URL(started.headers.get("Location")).searchParams.get("code");
  assert.ok(code);
  const body = { grant_type: "authorization_code", redirect_uri: redirectUri, code, code_verifier: verifier };
  const wrong = await owner.raw("POST", "/oauth/token", body, {
    Authorization: "Basic " + Buffer.from("cloudflare-access:wrong-secret").toString("base64")
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error, "invalid_client");
  const ok = await owner.raw("POST", "/oauth/token", body, {
    Authorization: "Basic " + Buffer.from("cloudflare-access:" + secret).toString("base64")
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.id_token);
});
