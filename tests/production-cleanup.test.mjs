import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {makeEnv,client,setupOrg,addEmployee,employeeLogin} from './helpers.mjs';
import {aiStatus,runAI} from '../functions/_shared/ai.js';
import {emailStatus} from '../functions/_shared/email.js';
import {issueOtp} from '../functions/_shared/otp.js';

test('production and unknown environments reject development-only providers',async()=>{
 for(const environment of ['production',undefined,'staging']){
  assert.equal(aiStatus({AI_PROVIDER:'mock',JELHR_ENV:environment}).configured,false);
  assert.equal(emailStatus({EMAIL_PROVIDER:'log',JELHR_ENV:environment}).configured,false);
  await assert.rejects(runAI({AI_PROVIDER:'mock',JELHR_ENV:environment},{system:'test',prompt:'test'}),e=>e.status===503);
 }
 assert.equal(aiStatus({AI_PROVIDER:'mock',JELHR_ENV:'test'}).configured,true);
 assert.equal(emailStatus({EMAIL_PROVIDER:'log',JELHR_ENV:'development'}).configured,true);
});

test('OTP test hook cannot expose a code in production or an unknown environment',async()=>{
 const env=makeEnv(), {owner}=await setupOrg(env);
 const employee=await addEmployee(owner,{email:'otp-user@acme.test'});
 const login=await employeeLogin(env,owner,employee,'otp-login@acme.test');
 const user=await env.DB.prepare('SELECT id,organization_id,email,display_name FROM users WHERE id=?').bind(login.userId).first();
 env.__exposeOtp=true;
 for(const value of ['production',undefined]){env.JELHR_ENV=value;const r=await issueOtp(env,user,'login');assert.equal(r.devCode,undefined);assert.equal(r.sent,false);}
});

test('audit page is backed by tenant-scoped read-only audit data',async()=>{
 const env=makeEnv(),a=await setupOrg(env,'A','a.owner@a.test'),b=await setupOrg(env,'B','b.owner@b.test');
 const employee=await addEmployee(a.owner,{email:'target@a.test'});
 const audEmployee=await addEmployee(a.owner,{email:'auditor@a.test'});
 const auditor=(await employeeLogin(env,a.owner,audEmployee,'auditor.login@a.test','auditor')).client;
 const employeeClient=(await employeeLogin(env,a.owner,employee,'target.login@a.test')).client;
 assert.equal((await client(env).get('/api/audit')).status,401);
 assert.equal((await employeeClient.get('/api/audit')).status,403);
 const aEvents=await auditor.get('/api/audit?limit=100');assert.equal(aEvents.status,200);assert.ok(aEvents.data.events.some(e=>e.resource_id===employee));
 const bEvents=await b.owner.get('/api/audit?limit=100');assert.equal(bEvents.status,200);assert.ok(!bEvents.data.events.some(e=>e.resource_id===employee));
 assert.equal((await auditor.post('/api/employees',{firstName:'Forbidden'})).status,403);
});

test('legacy routes no longer load browser-local fabricated data',()=>{
 for(const file of ['app.js','demo.js','nav.js'])assert.equal(existsSync('frontend/js/'+file),false,file);
 for(const page of ['demo','employees','security','settings']){
  const html=readFileSync(`frontend/${page}.html`,'utf8');assert.match(html,/legacy-redirect\.js/);assert.doesNotMatch(html,/Lora Piterson|Nixtio|Sample employees|High Risk/i);
 }
 assert.match(readFileSync('frontend/js/audit.js','utf8'),/\/api\/audit\?limit=100/);
 assert.match(readFileSync('frontend/js/v04-nav.js','utf8'),/security-v04\.html/);
});


test('Cloudflare extensionless routes preserve legacy redirects and navigation guards',async()=>{
 const legacy=readFileSync('frontend/js/legacy-redirect.js','utf8');
 for(const [name,dest] of [['employees','people-v04'],['security','security-v04'],['settings','settings-v04'],['demo','audit']]){
  for(const suffix of ['', '.html']){let target;runInNewContext(legacy,{location:{pathname:'/'+name+suffix,replace:v=>target=v}});assert.equal(target,'/'+dest+'.html');}
 }
 const nav=readFileSync('frontend/js/v04-nav.js','utf8');
 async function redirect(path,role,features=[]){const targets=[];runInNewContext(nav,{location:{pathname:path,replace:v=>targets.push(v)},fetch:async()=>({ok:true,json:async()=>({user:{role,features}})}),document:{querySelectorAll:()=>[]}});await new Promise(resolve=>setImmediate(resolve));return targets;}
 for(const suffix of ['', '.html']){
  assert.deepEqual(await redirect('/security-v04'+suffix,'auditor'),[]);
  assert.deepEqual(await redirect('/employee-documents'+suffix,'employee'),[]);
  assert.deepEqual(await redirect('/settings-v04'+suffix,'employee'),['/employee.html']);
  assert.deepEqual(await redirect('/settings-v04'+suffix,'manager'),['/index.html']);
  assert.deepEqual(await redirect('/assistant'+suffix,'manager'),['/index.html']);
  assert.deepEqual(await redirect('/assistant'+suffix,'manager',['ai']),[]);
 }
});
