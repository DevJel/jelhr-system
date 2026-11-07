import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyTurnstile } from "../functions/api/auth/login.js";

const request = new Request("https://hr.example.com/api/auth/login", { method: "POST" });

test("Turnstile Siteverify accepts only a successful token for the exact host and action", async () => {
  const env = {
    TURNSTILE_SECRET_KEY: "test-secret",
    __fetch: async (url, options) => {
      assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
      assert.equal(options.method, "POST");
      return Response.json({ success: true, hostname: "hr.example.com", action: "login" });
    }
  };
  assert.equal(await verifyTurnstile(env, "token", "203.0.113.4", "hr.example.com", request), true);
});

test("Turnstile rejects wrong host, wrong action, unsuccessful and missing tokens", async () => {
  const base = { TURNSTILE_SECRET_KEY: "test-secret", __fetch: async () => Response.json({ success: true, hostname: "evil.example", action: "login" }) };
  assert.equal(await verifyTurnstile(base, "token", "203.0.113.4", "hr.example.com", request), false);
  const wrongAction = { ...base, __fetch: async () => Response.json({ success: true, hostname: "hr.example.com", action: "careers_apply" }) };
  assert.equal(await verifyTurnstile(wrongAction, "token", "203.0.113.4", "hr.example.com", request), false);
  const failed = { ...base, __fetch: async () => Response.json({ success: false, hostname: "hr.example.com", action: "login" }) };
  assert.equal(await verifyTurnstile(failed, "token", "203.0.113.4", "hr.example.com", request), false);
  assert.equal(await verifyTurnstile(base, "", "203.0.113.4", "hr.example.com", request), false);
});

test("Turnstile fails closed when the encrypted secret is absent", async () => {
  assert.equal(await verifyTurnstile({}, "token", "203.0.113.4", "hr.example.com", request), false);
});
