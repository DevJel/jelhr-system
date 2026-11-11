'use strict';
(() => {
 const { $, esc, show, init } = Workflow;
 let me, data, editing = null;
 const dateTime = s => s ? new Date(s).toLocaleString() : '—';
 const api = (path, options) => V04.api(path, options);
 async function load() {
  const params = new URLSearchParams();
  if ($('#scope').value === 'team' && me.team) params.set('scope','team');
  if ($('#from').value) params.set('from',$('#from').value);
  if ($('#to').value) params.set('to',$('#to').value);
  data = await api('/api/time?' + params.toString()); render();
 }
 function render() {
  const open = data.open;
  $('#clockState').textContent = !data.hasEmployeeRecord ? 'Your account has no linked employee record.' : open ? 'Clocked in since ' + dateTime(open.started_at) : 'Not clocked in.';
  $('#clockForm').hidden = !data.hasEmployeeRecord || !me.writable;
  $('#breakField').hidden = !open; $('#clockButton').textContent = open ? 'Clock out' : 'Clock in';
  const rows = data.entries || [];
  $('#entries').innerHTML = rows.length ? rows.map(e => {
   const own = e.employee_id === me.employeeId;
   const review = me.writable && me.team && !own && e.ended_at;
   const edit = me.writable && own && e.approval_status === 'pending';
   return '<article class="entry"><strong>' + esc(e.employee_name || 'Employee') + '</strong><div class="item-meta"><span>Start: ' + esc(dateTime(e.started_at)) + '</span><span>End: ' + esc(dateTime(e.ended_at)) + '</span><span>Break: ' + esc(e.break_minutes || 0) + ' min</span><span>Status: ' + esc(e.approval_status || 'pending') + '</span></div>' + (e.note ? '<p>' + esc(e.note) + '</p>' : '') + '<div class="item-actions">' + (edit ? '<button class="v-btn light" type="button" data-action="edit" data-id="' + esc(e.id) + '">Edit</button>' : '') + (review ? '<button class="v-btn light" type="button" data-action="approved" data-id="' + esc(e.id) + '">Approve</button><button class="v-btn light" type="button" data-action="rejected" data-id="' + esc(e.id) + '">Reject</button><button class="v-btn light" type="button" data-action="pending" data-id="' + esc(e.id) + '">Reset to pending</button>' : '') + '</div></article>';
  }).join('') : '<p class="v-muted">No time entries found for these filters.</p>';
 }
 $('#clockForm').addEventListener('submit', async e => {
  e.preventDefault(); const button = $('#clockButton'); button.disabled = true;
  try {
   const body = {action:data.open?'clock_out':'clock_in',note:$('#note').value.trim()};
   if (data.open) body.breakMinutes = Number($('#breakMinutes').value || 0);
   await api('/api/time',{method:'POST',body:JSON.stringify(body)}); $('#note').value=''; $('#breakMinutes').value='0'; await load(); show('Time entry updated.','success');
  } catch (err) { show(err.message); } finally { button.disabled = false; }
 });
 $('#filterForm').addEventListener('submit', async e => { e.preventDefault(); if ($('#from').value && $('#to').value && $('#from').value > $('#to').value) return show('The start date must be before the end date.'); try { await load(); } catch(err) { show(err.message); } });
 $('#entries').addEventListener('click', async e => {
  const button=e.target.closest('[data-action]'); if(!button) return;
  const entry=(data.entries||[]).find(item=>item.id===button.dataset.id); if(!entry) return;
  if(button.dataset.action==='edit'){ editing=entry.id; $('#editNote').value=entry.note||''; $('#editBreak').value=entry.break_minutes||0; $('#editSection').hidden=false; $('#editNote').focus(); return; }
  button.disabled=true;
  try { await api('/api/time/'+encodeURIComponent(entry.id),{method:'PATCH',body:JSON.stringify({approvalStatus:button.dataset.action})}); await load(); show('Time review saved.','success'); } catch(err) { show(err.message); button.disabled=false; }
 });
 $('#editCancel').addEventListener('click',()=>{editing=null;$('#editSection').hidden=true;});
 $('#editForm').addEventListener('submit',async e=>{e.preventDefault(); if(!editing)return; const button=e.submitter; button.disabled=true; try{await api('/api/time/'+encodeURIComponent(editing),{method:'PATCH',body:JSON.stringify({note:$('#editNote').value,breakMinutes:Number($('#editBreak').value)})}); editing=null; $('#editSection').hidden=true; await load(); show('Time entry saved.','success');}catch(err){show(err.message);}finally{button.disabled=false;}});
 init('time').then(async context=>{ if(!context)return; me=context; $('#scopeField').hidden=!me.team; if(me.team)$('#scope').value='team'; try{await load();}catch(err){show(err.message);$('#clockState').textContent='Unable to load time data.';$('#entries').textContent='Unable to load time data.';} });
})();
