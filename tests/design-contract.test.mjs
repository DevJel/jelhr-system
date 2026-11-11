import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(p, 'utf8');

test('redesigned sign-in keeps the secure login and MFA controls', () => {
  const html = read('frontend/login.html');
  for (const id of ['loginForm','identifier','password','workspace','turnstileWidget','submitBtn','otpStep','mfaMethod','otpCode','verifyOtpBtn','passkeyBtn','ssoLink']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  const js = read('frontend/js/login.js');
  assert.match(js, /\/api\/bff\/auth\/login/);
  assert.match(js, /\/api\/bff\/auth\/mfa/);
  assert.match(js, /turnstileToken/);
  const headers = read('frontend/_headers');
  assert.match(headers, /\/login\.html[\s\S]*! Content-Security-Policy[\s\S]*script-src 'self' https:\/\/challenges\.cloudflare\.com[\s\S]*frame-src https:\/\/challenges\.cloudflare\.com/);
});

test('dashboard uses authenticated APIs rather than reference demo data', () => {
  const html = read('frontend/index.html');
  const js = read('frontend/js/dashboard.js');
  for (const path of ['/api/bff/auth/navigation','/api/employees','/api/time','/api/onboarding','/api/bff/auth/logout']) assert.ok(js.includes(path), path);
  assert.doesNotMatch(html, /2,420|Jhone|Payroll Check|sonia@hashbyt/);
  assert.match(js, /escape|esc\s*=/);
  assert.match(js, /method:'PATCH'/);
  assert.match(js, /method:'POST'/);
  assert.match(js, /\['people', \.\.\.\(user\.features/);
  assert.doesNotMatch(read('frontend/js/v04-nav.js'), /"people-v04\.html":"people"/);
});
