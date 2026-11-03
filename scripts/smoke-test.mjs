import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
const pages = ["index.html","employees.html","time.html","onboarding.html","security.html","settings.html"];
for (const page of pages) {
  const path=join("frontend",page);
  assert.ok(existsSync(path), `Missing page: ${path}`);
  const html=readFileSync(path,"utf8");
  assert.match(html,/<meta name="viewport"/i,`${page} must include a mobile viewport`);
  assert.match(html,/css\/app\.css/, `${page} must load shared styles`);
  assert.match(html,/js\/nav\.js/, `${page} must load shared navigation`);
}
const app=readFileSync("frontend/js/app.js","utf8");
assert.match(app,/jelhr\.demo\.v1/,"Demo persistence key must be stable");
assert.match(app,/renderEmployees/,"Employee directory interactions must be present");
assert.match(app,/renderTasks/,"Onboarding checklist interactions must be present");
const worker=readFileSync("src/index.js","utf8");
assert.match(worker,/\/api\/health/,"Worker health route must exist");
assert.match(worker,/env\.DB/,"Worker must check its D1 binding");
const config=readFileSync("wrangler.toml","utf8");
assert.match(config,/database_id = "99699f6d-e0e8-4e1c-a161-80dd698761d9"/,"Wrangler must target the provisioned D1 database");
console.log("JelHR smoke tests passed.");
