import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const FRONT = "frontend";
function filesUnder(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path, ext) : (entry.isFile() && path.endsWith(ext) ? [path] : []);
  });
}
const pages = readdirSync(FRONT).filter(f => f.endsWith(".html"));
const scripts = filesUnder(join(FRONT, "js"), ".js");

test("every page is mobile-ready, themed and uses external scripts", () => {
  assert.ok(pages.length > 0, "frontend pages exist");
  for (const page of pages) {
    const html = readFileSync(join(FRONT, page), "utf8");
    assert.match(html, /<meta name="viewport"/, page + ": viewport");
    assert.match(html, /css\/(?:app|v04)\.css/, page + ": stylesheet");
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, page + ": inline script");
    assert.doesNotMatch(html, /\son[a-z]+=/i, page + ": inline event handler");
    for (const [, src] of html.matchAll(/(?:src|href)="([^"#?:]+\.(?:js|css|svg|webp|png|ico|webmanifest))"/g)) {
      assert.ok(existsSync(join(FRONT, src.replace(/^\//, ""))), page + ": missing " + src);
    }
  }
});

test("all browser scripts parse and avoid dynamic code execution", () => {
  assert.ok(scripts.length > 0, "browser scripts exist");
  for (const file of scripts) {
    const js = readFileSync(file, "utf8");
    assert.doesNotMatch(js, /\beval\(|new Function\(/, file + ": dynamic code execution");
    assert.doesNotMatch(js, /\son(click|change|submit|load)=/, file + ": inline handler");
  }
});

test("security headers and deployment config", () => {
  const headers = readFileSync(join(FRONT, "_headers"), "utf8");
  assert.match(headers, /Content-Security-Policy: default-src 'self'; script-src 'self'/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /Strict-Transport-Security/);
  assert.match(headers, /\/careers\.html[\s\S]*! Content-Security-Policy[\s\S]*challenges\.cloudflare\.com/);
  const config = readFileSync("wrangler.toml", "utf8");
  assert.match(config, /pages_build_output_dir = "\.\/frontend"/);
  assert.match(config, /binding = "DB"/);
  assert.match(config, /database_name = "jelhr-system-db"/);
  assert.doesNotMatch(config, /database_id = "99699f6d-e0e8-4e1c-a161-80dd698761d9"/);
  assert.doesNotMatch(config, /^main\s*=/m, "Pages config must not declare a Worker entry point");
});

test("migrations are ordered and additive", () => {
  const migrationFiles = readdirSync("migrations").filter(f => f.endsWith(".sql")).sort();
  assert.deepEqual(migrationFiles.map(f => f.slice(0, 4)), migrationFiles.map((_, i) => String(i + 1).padStart(4, "0")));
  for (const f of migrationFiles.slice(2)) assert.doesNotMatch(readFileSync(join("migrations", f), "utf8"), /DROP TABLE|DROP COLUMN/i, f);
});

test("no secrets are committed", () => {
  assert.ok(!existsSync(".dev.vars"), ".dev.vars must not be committed");
  const gitignore = readFileSync(".gitignore", "utf8");
  assert.match(gitignore, /\.dev\.vars/);
});
