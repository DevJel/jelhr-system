// Browser check: signs in as each role, visits every page, records console errors and CSP
// violations, and saves screenshots. Requires Playwright + a running server:
//   node scripts/dev-server.mjs --seed &   then   node scripts/ui-check.mjs [outDir]
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:8788";
const OUT = process.argv[2] || "ui-check";
const PASSWORD = "Correct-Horse-Battery-9";
mkdirSync(OUT, { recursive: true });

const problems = [];
async function session(browser, email, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("console", m => { if (m.type() === "error" && !/status of 401/.test(m.text())) problems.push(`[${email}] console: ${m.text()} @ ${page.url()}`); });
  page.on("pageerror", e => problems.push(`[${email}] pageerror: ${e.message} @ ${page.url()}`));
  await page.goto(BASE + "/login.html");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("#submitBtn");
  await page.waitForURL(u => !u.pathname.endsWith("login.html"), { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  return { ctx, page };
}
async function shot(page, path, name) {
  await page.goto("about:blank");
  await page.goto(BASE + "/" + path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

const browser = await chromium.launch();
const owner = await session(browser, "owner@northwind.test");
for (const [p, n] of [["index.html", "01-dashboard"], ["employees.html", "02-people"], ["employees.html#tab=applicants", "03-applicants"], ["employees.html#tab=former", "04-former"],
  ["offboarding.html", "05-offboarding"], ["documents.html", "07-documents"], ["communications.html", "08-communications"], ["communications.html#tab=history", "09-comms-history"],
  ["time.html#tab=team", "10-time-team"], ["onboarding.html#tab=team", "11-onboarding-team"], ["security.html#tab=users", "12-security-users"], ["security.html#tab=audit", "13-audit"], ["settings.html#tab=organization", "14-settings"]]) {
  await shot(owner.page, p, n);
}
// Open a case detail
await owner.page.goto(BASE + "/offboarding.html");
await owner.page.waitForLoadState("networkidle");
await owner.page.click("[data-action=open]");
await owner.page.waitForLoadState("networkidle");
await owner.page.waitForTimeout(600);
await owner.page.screenshot({ path: `${OUT}/06-offboarding-case.png`, fullPage: true });
// Confirm dialog for finalize
await owner.page.click("[data-action=complete]");
await owner.page.waitForTimeout(400);
await owner.page.screenshot({ path: `${OUT}/06b-confirm.png` });
await owner.page.click("[data-cancel]");

// Employee signs a document
const emp = await session(browser, "billie.login@northwind.test");
await shot(emp.page, "employee.html", "20-employee-home");
await emp.page.waitForSelector(".quick-links a", { timeout: 15000 });
await emp.page.click(".quick-links a");
await emp.page.waitForLoadState("networkidle");
await emp.page.waitForTimeout(500);
const box = await emp.page.locator("#pad canvas").boundingBox();
await emp.page.mouse.move(box.x + 30, box.y + 120);
await emp.page.mouse.down();
for (let i = 0; i < 40; i++) await emp.page.mouse.move(box.x + 30 + i * 8, box.y + 120 - Math.sin(i / 3) * 40);
await emp.page.mouse.up();
await emp.page.check("[name=consent]");
await emp.page.screenshot({ path: `${OUT}/21-sign.png`, fullPage: true });
await emp.page.click("#signForm [type=submit]");
await emp.page.waitForTimeout(300);
await emp.page.click("dialog [type=submit]");
await emp.page.waitForSelector("#certificate", { timeout: 8000 });
await emp.page.waitForTimeout(700);
await emp.page.screenshot({ path: `${OUT}/22-signed.png`, fullPage: true });

// Mobile
const mobile = await session(browser, "owner@northwind.test", { width: 390, height: 844 });
await shot(mobile.page, "index.html", "30-mobile-dashboard");
await shot(mobile.page, "offboarding.html", "31-mobile-offboarding");
await shot(mobile.page, "employees.html", "32-mobile-people");

// Login + platform
const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const ap = await anon.newPage();
ap.on("console", m => { if (m.type() === "error" && !/401|404/.test(m.text())) problems.push(`[anon] console: ${m.text()}`); });
await ap.goto(BASE + "/login.html"); await ap.waitForTimeout(500);
await ap.screenshot({ path: `${OUT}/00-login.png` });
await ap.goto(BASE + "/platform.html"); await ap.waitForLoadState("networkidle");
await ap.fill("[name=email]", "platform@jelhr.local"); await ap.fill("[name=password]", "local-platform-password-123");
await ap.click("#pform [type=submit]"); await ap.waitForTimeout(1200);
await ap.screenshot({ path: `${OUT}/40-platform.png`, fullPage: true });
await ap.goto(BASE + "/nope"); await ap.screenshot({ path: `${OUT}/41-404.png` });

await browser.close();
console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "No console errors or CSP violations.");
process.exitCode = problems.length ? 1 : 0;
