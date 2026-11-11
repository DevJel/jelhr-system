import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeEnv, client, setupOrg, addEmployee, employeeLogin } from './helpers.mjs';

test('time and onboarding persistence and access boundaries', async () => {
 const env=makeEnv(), a=await setupOrg(env,'Team A','a-owner@a.test'), b=await setupOrg(env,'Team B','b-owner@b.test');
 const managerId=await addEmployee(a.owner,{email:'manager@a.test'});
 const empId=await addEmployee(a.owner,{email:'worker@a.test',managerId});
 const otherId=await addEmployee(a.owner,{email:'other@a.test'});
 const manager=(await employeeLogin(env,a.owner,managerId,'manager.login@a.test','manager')).client;
 const emp=(await employeeLogin(env,a.owner,empId,'worker.login@a.test')).client;
 const other=(await employeeLogin(env,a.owner,otherId,'other.login@a.test')).client;
 assert.equal((await client(env).get('/api/time')).status,401);
 assert.equal((await emp.get('/api/time?scope=team')).status,403);
 const start=await emp.post('/api/time',{action:'clock_in',note:'Synthetic'});assert.equal(start.status,201);
 assert.equal((await emp.get('/api/time')).data.open.id,start.data.id);
 const stop=await emp.post('/api/time',{action:'clock_out',breakMinutes:0});assert.equal(stop.status,200);
 assert.equal((await emp.patch(`/api/time/${start.data.id}`,{note:'Revised',breakMinutes:0})).status,200);
 assert.equal((await emp.patch(`/api/time/${start.data.id}`,{breakMinutes:1440})).status,400,'break cannot exceed elapsed shift');
 assert.equal((await other.patch(`/api/time/${start.data.id}`,{note:'not allowed'})).status,403);
 assert.equal((await b.owner.patch(`/api/time/${start.data.id}`,{approvalStatus:'approved'})).status,404);
 assert.equal((await manager.patch(`/api/time/${start.data.id}`,{approvalStatus:'approved'})).status,200);
 assert.equal((await emp.get('/api/time')).data.entries[0].approval_status,'approved');
 assert.equal((await emp.patch(`/api/time/${start.data.id}`,{note:'Too late'})).status,409);
 assert.equal((await a.owner.post('/api/onboarding',{employeeId:empId,title:'Test task'})).status,201);
 let task=(await emp.get('/api/onboarding')).data.tasks[0];assert.equal(task.title,'Test task');
 assert.equal((await other.patch(`/api/onboarding/${task.id}`,{completed:true})).status,404);
 assert.equal((await b.owner.patch(`/api/onboarding/${task.id}`,{completed:true})).status,404);
 assert.equal((await manager.patch(`/api/onboarding/${task.id}`,{completed:true})).status,200);
 assert.ok((await emp.get('/api/onboarding')).data.tasks[0].completed_at);
 assert.equal((await emp.patch(`/api/onboarding/${task.id}`,{completed:false})).status,200);
 assert.equal((await emp.get('/api/onboarding')).data.tasks[0].completed_at,null);
 assert.equal((await emp.del(`/api/onboarding/${task.id}`)).status,403);
 assert.equal((await a.owner.del(`/api/onboarding/${task.id}`)).status,200);
 assert.equal((await emp.get('/api/onboarding')).data.tasks.length,0);
});

test('workflow screens use authenticated API routes instead of demo storage', () => {
 for(const name of ['time','onboarding']) {
  const html=readFileSync(`frontend/${name}.html`,'utf8');
  assert.doesNotMatch(html,/js\/nav\.js|js\/app\.js|sample checklist|6\.1h/i);
  assert.match(html,/js\/workflow\.js/);
 }
 const time=readFileSync('frontend/js/time.js','utf8'), onboarding=readFileSync('frontend/js/onboarding-live.js','utf8');
 assert.match(time,/\/api\/time/);assert.match(time,/approvalStatus/);assert.match(onboarding,/\/api\/onboarding/);assert.match(onboarding,/completed:/);
});
