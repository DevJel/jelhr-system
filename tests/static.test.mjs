import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const FRONT = "frontend";
const pages = readdirSync(FRONT).filter(f => f.endsWith(".html"));
const scripts = readdirSync(join(FRONT, "js/pages")).map(f => join(FRONT, "js/pages", f)).concat(join(FRONT, "js/core.js"));
const sprite = readFileSync(join(FRONT, "assets/icons.svg"), "utf8");

test("every page is CSP-clean, mobile-ready and themed", () => {
  for (const page of pages) {
    const html = readFileSync(join(FRONT, page), "utf8");
    assert.match(html, /<meta name="viewport"/, `${page}: viewport`);
    assert.match(html, /css\/app\.css/, `${page}: stylesheet`);
    assert.match(html, /favicon\.svg/, `${page}: favicon`);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${page}: inline script`);
    assert.doesNotMatch(html, /\sstyle=/i, `${page}: inline style attribute`);
    assert.doesNotMatch(html, /\son[a-z]+=/i, `${page}: inline event handler`);
    for (const [, src] of html.matchAll(/(?:src|href)="([^"#?:]+\.(?:js|css|svg|webp|png|ico|webmanifest))"/g)) {
      assert.ok(existsSync(join(FRONT, src.replace(/^\//, ""))), `${page}: missing ${src}`);
    }
  }
});

test("scripts never use inline styles in markup, eval or string handlers", () => {
  for (const file of scripts) {
    const js = readFileSync(file, "utf8");
    assert.doesNotMatch(js, /style="/, `${file}: style attribute in markup`);
    assert.doesNotMatch(js, /\beval\(|new Function\(/, `${file}: eval`);
    assert.doesNotMatch(js, /\son(click|change|submit|load)=/, `${file}: inline handler`);
  }
});

test("every icon referenced in scripts exists in the sprite", () => {
  const used = new Set();
  for (const file of scripts) for (const [, name] of readFileSync(file, "utf8").matchAll(/icon\("([a-z-]+)"/g)) used.add(name);
  for (const name of ["logo", "eye"]) used.add(name);
  for (const name of used) assert.match(sprite, new RegExp(`id="${name}"`), `icon ${name} missing from sprite`);
});

test("every illustration referenced exists as WebP", () => {
  const all = scripts.map(f => readFileSync(f, "utf8")).join("\n") + pages.map(p => readFileSync(join(FRONT, p), "utf8")).join("\n");
  for (const [, name] of all.matchAll(/assets\/img\/([a-z-]+)\.webp/g)) assert.ok(existsSync(join(FRONT, "assets/img", name + ".webp")), name);
  for (const [, name] of all.matchAll(/emptyState\([^)]*"([a-z-]+)"\)/g)) assert.ok(existsSync(join(FRONT, "assets/img", name + ".webp")), name);
});

test("security headers and deployment config", () => {
  const headers = readFileSync(join(FRONT, "_headers"), "utf8");
  assert.match(headers, /Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self';/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /Strict-Transport-Security/);
  const config = readFileSync("wrangler.toml", "utf8");
  assert.match(config, /pages_build_output_dir = "\.\/frontend"/);
  assert.match(config, /binding = "DB"/);
  assert.match(config, /database_id = "99699f6d-e0e8-4e1c-a161-80dd698761d9"/);
  assert.ok(!existsSync("src/index.js"), "unused Worker entry must not shadow Pages Functions");
});

test("migrations are ordered and additive", () => {
  const files = readdirSync("migrations").filter(f => f.endsWith(".sql")).sort();
  assert.deepEqual(files.map(f => f.slice(0, 4)), files.map((_, i) => String(i + 1).padStart(4, "0")));
  for (const f of files.slice(2)) assert.doesNotMatch(readFileSync(join("migrations", f), "utf8"), /DROP TABLE|DROP COLUMN/i, f);
});

test("no secrets are committed", () => {
  assert.ok(!existsSync(".dev.vars"), ".dev.vars must not be committed");
  const gitignore = readFileSync(".gitignore", "utf8");
  assert.match(gitignore, /\.dev\.vars/);
});
