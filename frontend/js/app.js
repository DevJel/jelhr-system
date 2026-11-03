/* JelHR interactive demo layer. Demo records stay in this browser until an authenticated API is configured. */
(() => {
  const KEY = "jelhr.demo.v1";
  const seed = {
    employees: [
      {id:"emp-001",name:"Lora Piterson",email:"lora@example.test",role:"UX/UI Designer",department:"Product",status:"Active",start:"2023-03-01"},
      {id:"emp-002",name:"Harry Bender",email:"harry@example.test",role:"Engineering Lead",department:"Engineering",status:"Active",start:"2022-01-10"},
      {id:"emp-003",name:"Katy Fuller",email:"katy@example.test",role:"People Operations",department:"HR",status:"Active",start:"2023-08-14"},
      {id:"emp-004",name:"Jonathan Kelly",email:"jonathan@example.test",role:"Product Manager",department:"Product",status:"Onboarding",start:"2024-09-02"},
      {id:"emp-005",name:"Billie Wright",email:"billie@example.test",role:"Backend Engineer",department:"Engineering",status:"Active",start:"2021-11-08"},
      {id:"emp-006",name:"Sarah Page",email:"sarah@example.test",role:"Finance Analyst",department:"Finance",status:"On leave",start:"2022-06-20"}
    ],
    tasks: [
      {id:"task-1",title:"Team introduction",owner:"People Operations",done:true,due:"2026-11-01"},
      {id:"task-2",title:"Complete employee profile",owner:"New employee",done:true,due:"2026-11-02"},
      {id:"task-3",title:"Review company handbook",owner:"New employee",done:false,due:"2026-11-04"},
      {id:"task-4",title:"Security and access setup",owner:"IT",done:false,due:"2026-11-05"},
      {id:"task-5",title:"Manager check-in",owner:"Manager",done:false,due:"2026-11-07"},
      {id:"task-6",title:"Role and goals alignment",owner:"Manager",done:false,due:"2026-11-10"},
      {id:"task-7",title:"Benefits orientation",owner:"People Operations",done:false,due:"2026-11-11"},
      {id:"task-8",title:"30-day review",owner:"Manager",done:false,due:"2026-12-02"}
    ],
    profile:{name:"Lora Piterson",email:"lora@example.test",company:"JelHR Demo Workspace",timezone:"Asia/Kuala_Lumpur"},
    entries:[], sessions:[{id:"session-current",device:"This browser",location:"Current session",lastSeen:new Date().toISOString(),active:true}]
  };
  const read = () => { try { return {...seed,...JSON.parse(localStorage.getItem(KEY)||"{}")}; } catch { return {...seed}; } };
  let state = read();
  const save = () => localStorage.setItem(KEY, JSON.stringify(state));
  const el = (s, root=document) => root.querySelector(s);
  const all = (s, root=document) => [...root.querySelectorAll(s)];
  const safe = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const toast = msg => {
    let node=el("#jelhr-toast");
    if(!node){node=document.createElement("div");node.id="jelhr-toast";node.setAttribute("role","status");node.style.cssText="position:fixed;right:18px;bottom:78px;z-index:1000;background:#171717;color:#fff;padding:12px 16px;border-radius:12px;font-size:13px;box-shadow:0 8px 30px #0002";document.body.append(node);}
    node.textContent=msg;node.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.hidden=true,2600);
  };
  const demoNotice = () => {
    if(el(".demo-notice")) return;
    const n=document.createElement("div");n.className="demo-notice";
    n.textContent="DEMO WORKSPACE · Changes are saved in this browser only";
    n.style.cssText="margin:0 0 16px;padding:9px 12px;border:1px solid #e9dca4;background:#fff8dc;color:#5e4b13;border-radius:10px;font-size:11px;font-weight:700;letter-spacing:.04em";
    const main=el(".main");if(main)main.prepend(n);
  };
  const updateStats = () => {
    const completed=state.tasks.filter(t=>t.done).length;
    all(".stat-label").forEach(n=>{
      if(n.textContent.includes("Onboarding tasks")){const v=n.previousElementSibling;if(v)v.textContent=completed+"/"+state.tasks.length;}
      if(n.textContent.includes("Employees")){const v=n.previousElementSibling;if(v)v.textContent=state.employees.length;}
    });
    const p=el(".main .page-header p");
    if(p && location.pathname.endsWith("onboarding.html"))p.textContent="Progress "+Math.round(completed/state.tasks.length*100)+"% · "+completed+" of "+state.tasks.length+" tasks complete";
  };
  const renderEmployees = () => {
    const tbody=el(".table tbody");if(!tbody)return;
    tbody.innerHTML=state.employees.map(e=>`<tr><td><strong>${safe(e.name)}</strong><div style="font-size:11px;color:var(--muted)">${safe(e.email)}</div></td><td>${safe(e.role)}</td><td>${safe(e.department)}</td><td><span class="badge ${e.status==="Active"?"badge-green":e.status==="Onboarding"?"badge-yellow":"badge-gray"}">${safe(e.status)}</span></td><td>${safe(e.start)}</td></tr>`).join("");
    const count=el(".page-header p");if(count)count.textContent="Directory · "+state.employees.length+" people in "+state.profile.company;
  };
  const employeeTools = () => {
    const card=el(".main .card");if(!card||!el(".table"))return;
    const tools=document.createElement("div");tools.style.cssText="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px";
    tools.innerHTML='<input id="employee-search" aria-label="Search employees" placeholder="Search name, role or department" style="flex:1;min-width:180px;height:38px;border:1px solid var(--border);border-radius:10px;padding:0 12px"><select id="employee-filter" aria-label="Filter employees" style="height:38px;border:1px solid var(--border);border-radius:10px;padding:0 10px"><option value="">All statuses</option><option>Active</option><option>Onboarding</option><option>On leave</option></select>';
    card.prepend(tools);
    const filter=()=>{const q=el("#employee-search").value.toLowerCase(),status=el("#employee-filter").value;all(".table tbody tr").forEach((tr,i)=>{const e=state.employees[i];tr.hidden=!(e&&(JSON.stringify(e).toLowerCase().includes(q))&&(!status||e.status===status));});};
    el("#employee-search").addEventListener("input",filter);el("#employee-filter").addEventListener("change",filter);
  };
  const bindEmployeeActions = () => {
    const buttons=all(".page-header button");
    buttons.forEach(b=>{
      if(b.textContent.includes("Export"))b.addEventListener("click",()=>{
        const rows=[["Name","Email","Role","Department","Status","Start date"],...state.employees.map(e=>[e.name,e.email,e.role,e.department,e.status,e.start])];
        const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\r\n");
        const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));const a=document.createElement("a");a.href=url;a.download="jelhr-employees-demo.csv";a.click();URL.revokeObjectURL(url);toast("Employee CSV exported");
      });
      if(b.textContent.includes("Add employee"))b.addEventListener("click",()=>{
        const name=prompt("Employee full name");if(!name?.trim())return;
        const email=prompt("Work email");if(!email?.trim()||!/^\S+@\S+\.\S+$/.test(email)){toast("Enter a valid email address");return;}
        const role=prompt("Job title")||"New employee",department=prompt("Department")||"Unassigned";
        state.employees.push({id:crypto.randomUUID(),name:name.trim(),email:email.trim(),role,department,status:"Onboarding",start:new Date().toISOString().slice(0,10)});
        save();renderEmployees();toast("Employee added to this demo workspace");
      });
    });
  };
  const renderTasks = () => {
    const card=el(".main .card:not(.card-cream)");if(!card||!location.pathname.endsWith("onboarding.html"))return;
    card.innerHTML=state.tasks.map((t,i)=>`<label class="list-row" style="cursor:pointer;border-bottom:1px solid var(--border)"><input type="checkbox" data-task="${safe(t.id)}" ${t.done?"checked":""} style="width:18px;height:18px;accent-color:#111"><span style="flex:1"><span style="display:block;font-weight:600;font-size:13px;text-decoration:${t.done?"line-through":"none"}">${safe(t.title)}</span><span style="font-size:11px;color:var(--muted)">Owner: ${safe(t.owner)} · Due: ${safe(t.due)}</span></span><span class="badge ${t.done?"badge-green":"badge-gray"}">${t.done?"Done":"Pending"}</span></label>`).join("");
    all("[data-task]").forEach(c=>c.addEventListener("change",()=>{const t=state.tasks.find(x=>x.id===c.dataset.task);if(t)t.done=c.checked;save();renderTasks();updateStats();toast("Onboarding checklist updated");}));
  };
  const bindSettings = () => {
    if(!location.pathname.endsWith("settings.html"))return;
    const inputs=all(".main input");if(inputs[0])inputs[0].value=state.profile.name;if(inputs[1])inputs[1].value=state.profile.email;
    const btn=el(".main button");if(btn)btn.addEventListener("click",()=>{state.profile.name=inputs[0]?.value.trim()||state.profile.name;state.profile.email=inputs[1]?.value.trim()||state.profile.email;save();toast("Demo profile saved");});
  };
  const bindTimer = () => {
    const btn=el("#timerBtn"),display=el("#timerDisplay");if(!btn||!display)return;
    let started=0,elapsed=0,interval=null;
    const paint=()=>{const s=elapsed+(started?Math.floor((Date.now()-started)/1000):0);display.textContent=[Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(v=>String(v).padStart(2,"0")).join(":");};
    btn.addEventListener("click",()=>{if(started){elapsed+=Math.floor((Date.now()-started)/1000);started=0;clearInterval(interval);btn.textContent="▶ Resume timer";btn.className="btn btn-accent";state.entries.push({id:crypto.randomUUID(),seconds:elapsed,endedAt:new Date().toISOString()});save();toast("Timer paused · demo entry saved");}else{started=Date.now();interval=setInterval(paint,1000);btn.textContent="Ⅱ Pause timer";btn.className="btn btn-dark";}});paint();
  };
  const bindSecurity = () => {
    const btn=all("button").find(b=>b.textContent.toLowerCase().includes("revoke all sessions"));if(!btn)return;
    btn.addEventListener("click",()=>{if(!confirm("Revoke demo sessions in this browser? This does not revoke real account sessions."))return;state.sessions=[];save();toast("Demo session list cleared");});
  };
  document.addEventListener("DOMContentLoaded",()=>{
    demoNotice();renderEmployees();employeeTools();bindEmployeeActions();renderTasks();bindSettings();bindTimer();bindSecurity();updateStats();
    const profile=el(".user-meta .name");if(profile)profile.textContent=state.profile.name;
  });
})();