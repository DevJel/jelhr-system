'use strict';
window.Workflow = (() => {
  const $ = s => document.querySelector(s);
  const esc = value => V04.esc(value);
  const hrRoles = ['owner','admin','hr_manager'];
  const teamRoles = [...hrRoles,'manager','auditor'];
  const show = (text, kind='error') => V04.message($('#message'), text, kind);
  async function init(feature) {
    let data;
    try { data = await V04.me(); }
    catch { location.replace('/login.html'); return null; }
    const user = data.user || {};
    document.querySelectorAll('[data-feature]').forEach(el => { el.hidden = !(user.features || []).includes(el.dataset.feature); });
    const home = $('#homeLink');
    home.href = user.role === 'employee' ? '/employee.html' : user.role === 'auditor' ? '/demo.html' : '/index.html';
    home.textContent = user.role === 'employee' ? 'My workspace' : 'Dashboard';
    $('#logout').addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      try { await V04.api('/api/bff/auth/logout',{method:'POST'}); location.replace('/login.html'); }
      catch { show('Unable to log out. Please try again.'); event.currentTarget.disabled = false; }
    });
    if (!(user.features || []).includes(feature)) { show('This feature is not enabled for your account.'); return null; }
    document.querySelector('.workflow-grid').hidden = false;
    return { user, employeeId: data.employee?.id || user.employeeId || null, hr:hrRoles.includes(user.role), team:teamRoles.includes(user.role), writable:user.role!=='auditor' };
  }
  return { $, esc, show, init };
})();
