'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const request = async (url, options = {}) => {
    const r = await fetch(url, {credentials:'same-origin', cache:'no-store', ...options});
    if (r.status === 401) { location.replace('/login.html'); throw new Error('Session expired'); }
    if (!r.ok) throw new Error('Unable to load this information.');
    return r.json();
  };
  const message = (selector, text) => { $(selector).innerHTML = '<p class="muted">' + esc(text) + '</p>'; };
  const count = (id, n) => { $(id).textContent = Number(n).toLocaleString(); };
  function people(data) {
    const rows = data.employees || [];
    const counts = Object.create(null);
    rows.forEach(e => { counts[e.employment_status] = (counts[e.employment_status] || 0) + 1; });
    const threshold = Date.now() - 30 * 86400000;
    const now = Date.now();
    count('#totalCount', rows.length); count('#activeCount', counts.active || 0); count('#onboardingCount', counts.onboarding || 0);
    count('#newCount', rows.filter(e => { const t = Date.parse(e.hire_date); return Number.isFinite(t) && t >= threshold && t <= now; }).length);
    if (rows.length >= 1000) $('#dashboardMessage').textContent = 'The directory returns up to 1,000 employees; counts reflect the records returned.';
    const labels = [['active','Active'],['onboarding','Onboarding'],['on_leave','On leave'],['offboarding','Offboarding']];
    $('#statusBreakdown').innerHTML = labels.map(([key,label]) => '<div class="bar-row"><span>' + label + '</span><div class="bar-track"><div class="bar-fill ' + esc(key) + '" style="width:' + (rows.length ? Math.round((counts[key] || 0) * 100 / rows.length) : 0) + '%"></div></div><strong>' + (counts[key] || 0) + '</strong></div>').join('');
    $('#peopleList').innerHTML = rows.length ? rows.slice(0, 4).map(e => '<div class="person-row"><span class="person-initial">' + esc((e.first_name || '?').charAt(0).toUpperCase()) + '</span><div class="person-info"><strong>' + esc((e.first_name || '') + ' ' + (e.last_name || '')) + '</strong><small>' + esc(e.job_title || 'No job title') + '</small></div><span class="person-status">' + esc((e.employment_status || '').replace(/_/g,' ')) + '</span></div>').join('') : '<p class="muted">No current employees found.</p>';
  }
  function time(data) {
    const entries = data.entries || [];
    if (!data.hasEmployeeRecord) { message('#timeSummary','Your account is not linked to an employee record.'); return; }
    const e = entries[0];
    const detail = data.open ? 'Since ' + new Date(data.open.started_at).toLocaleString() : e ? 'Latest entry: ' + new Date(e.started_at).toLocaleString() : 'No time entries in the last 30 days.';
    $('#timeSummary').innerHTML = '<p class="time-state">' + (data.open ? 'Clocked in' : 'Not clocked in') + '</p><p class="muted">' + esc(detail) + '</p><button type="button" class="secondary time-action">' + (data.open ? 'Clock out' : 'Clock in') + '</button><p class="action-error" role="alert"></p>';
    $('.time-action').addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true;
      try { await request('/api/time', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:data.open?'clock_out':'clock_in'})}); time(await request('/api/time')); }
      catch { $('.action-error').textContent = 'Unable to update your time. Please try again.'; button.disabled = false; }
    });
  }
  function tasks(data) {
    const rows = (data.tasks || []).filter(t => !t.completed_at).sort((a,b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    $('#taskList').innerHTML = rows.length ? rows.slice(0,4).map(t => '<div class="task-row"><strong>' + esc(t.title) + '</strong><small>' + esc(t.employee_name || '') + (t.due_date ? ' · Due ' + esc(t.due_date) : '') + '</small><button type="button" class="task-complete" data-task="' + esc(t.id) + '">Mark complete</button></div>').join('') : '<p class="muted">No open onboarding tasks.</p>';
    document.querySelectorAll('[data-task]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try { await request('/api/onboarding/' + encodeURIComponent(button.dataset.task), {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({completed:true})}); tasks(await request('/api/onboarding?scope=team')); }
      catch { button.disabled = false; $('#dashboardMessage').textContent = 'Unable to complete that task. Please try again.'; }
    }));
  }
  document.querySelectorAll('[data-logout]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try { const r = await fetch('/api/bff/auth/logout', {method:'POST',credentials:'same-origin'}); if (!r.ok) throw new Error(); location.replace('/login.html'); }
    catch { $('#dashboardMessage').textContent = 'Could not log out. Please try again.'; button.disabled = false; }
  }));
  (async () => {
    try {
      const { user } = await request('/api/bff/auth/navigation');
      if (user.role === 'employee') { location.replace('/employee.html'); return; }
      if (user.role === 'auditor') { location.replace('/audit.html'); return; }
      if (!['owner','admin','hr_manager','manager'].includes(user.role)) { location.replace('/employee.html'); return; }
      const features = new Set(['people', ...(user.features || [])]), admin = ['owner','admin'].includes(user.role);
      document.querySelectorAll('[data-feature]').forEach(el => { if (!features.has(el.dataset.feature)) el.hidden = true; });
      document.querySelectorAll('[data-admin]').forEach(el => { if (!admin) el.hidden = true; });
      const name = user.displayName || 'there'; $('#profileName').textContent = name; $('#profileRole').textContent = user.role.replace(/_/g,' '); $('#avatar').textContent = name.charAt(0).toUpperCase();
      const hour = new Date().getHours(); $('#greeting').textContent = 'Good ' + (hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening') + ', ' + name;
      $('#today').textContent = new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(new Date());
      if (features.has('people')) request('/api/employees').then(people).catch(() => { message('#peopleList','People data is unavailable.'); message('#statusBreakdown','People data is unavailable.'); });
      else { message('#peopleList','People is not enabled for this workspace.'); message('#statusBreakdown','People is not enabled for this workspace.'); }
      if (features.has('time')) request('/api/time').then(time).catch(() => message('#timeSummary','Time data is unavailable.')); else message('#timeSummary','Time tracking is not enabled for this workspace.');
      if (features.has('onboarding')) request('/api/onboarding?scope=team').then(tasks).catch(() => message('#taskList','Onboarding tasks are unavailable.')); else message('#taskList','Onboarding is not enabled for this workspace.');
    } catch { $('#dashboardMessage').textContent = 'Unable to load your workspace. Please refresh or sign in again.'; }
  })();
})();
