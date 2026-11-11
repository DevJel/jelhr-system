'use strict';
(() => {
 const $=s=>document.querySelector(s), esc=value=>V04.esc(value), message=$('#message');
 let ready=false;
 async function load(){
  const button=$('#refresh'); button.disabled=true; message.hidden=true;
  try {
   const data=await V04.api('/api/audit?limit=100'); const events=data.events||[];
   $('#events').innerHTML=events.length?events.map(e=>'<article class="entry"><strong>'+esc(e.action||'Activity')+'</strong><div class="item-meta"><span>'+esc(e.actor_name||e.actor_email||'System')+'</span><span>'+esc(e.resource_type||'Record')+'</span><span>'+esc(e.created_at?new Date(e.created_at).toLocaleString():'—')+'</span></div></article>').join(''):'<p class="v-muted">No audit events found.</p>';
  } catch(err){$('#events').textContent='Unable to load audit activity.';V04.message(message,err.message);}
  finally {button.disabled=!ready;}
 }
 $('#refresh').addEventListener('click',load);
 $('#logout').addEventListener('click',async e=>{e.currentTarget.disabled=true;try{await V04.api('/api/bff/auth/logout',{method:'POST'});location.replace('/login.html');}catch{V04.message(message,'Unable to log out. Please try again.');e.currentTarget.disabled=false;}});
 (async()=>{try{const data=await V04.api('/api/bff/auth/navigation');const user=data.user||{};if(!['owner','admin','auditor'].includes(user.role)){location.replace(user.role==='employee'?'/employee.html':'/index.html');return;}document.querySelectorAll('[data-feature]').forEach(el=>{el.hidden=!(user.features||[]).includes(el.dataset.feature);});$('#dashboardLink').hidden=user.role==='auditor';ready=true;await load();}catch{location.replace('/login.html');}})();
})();
