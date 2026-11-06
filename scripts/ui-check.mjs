// Fast static UI smoke check for Pages output. Full browser/device checks are a
// separate release gate and must be run against the local Pages runtime.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = "frontend";
const required = ["recruitment.html","careers.html","accept-invite.html","assistant.html","platform-login.html","platform.html","users.html","settings-v04.html","security-v04.html","people-v04.html","employee-documents.html"];
const scripts = readdirSync(join(root,"js"),{withFileTypes:true}).flatMap(x=>x.isFile()&&x.name.endsWith(".js")?[join(root,"js",x.name)]:[]);
const errors=[];
for(const name of required) if(!existsSync(join(root,name))) errors.push("Missing v0.4 page: "+name);
for(const name of readdirSync(root).filter(x=>x.endsWith(".html"))){
 const html=readFileSync(join(root,name),"utf8");
 if(!/<meta name="viewport"/.test(html))errors.push(name+": missing mobile viewport");
 if(!/css\/(?:app|v04)\.css/.test(html))errors.push(name+": missing application stylesheet");
 if(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html))errors.push(name+": inline script");
 for(const [,asset] of html.matchAll(/(?:src|href)="([^"#?:]+\.(?:js|css|svg|webp|png|ico|webmanifest))"/g)){
  if(!existsSync(join(root,asset.replace(/^\//,""))))errors.push(name+": missing "+asset);
 }
}
for(const file of scripts){
 const check=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});
 if(check.status!==0)errors.push(file+": "+(check.stderr||check.stdout).trim());
}
const headers=readFileSync(join(root,"_headers"),"utf8");
if(!/\/careers\.html[\s\S]*! Content-Security-Policy[\s\S]*challenges\.cloudflare\.com/.test(headers))errors.push("Careers page CSP does not explicitly allow Turnstile");
if(errors.length){console.error("UI static checks failed:\n"+errors.join("\n"));process.exitCode=1}
else console.log("UI static checks passed: "+required.length+" v0.4 routes, "+scripts.length+" browser scripts parsed, local assets and careers CSP verified. Browser/device checks remain a release gate.");
