// Authentication gate and shared navigation.
(async function () {
  var path=location.pathname.split('/').pop()||'index.html';
  if(path==='login.html')return;
  try{
    var response=await fetch('/api/bff/auth/navigation',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error('not signed in');
    var data=await response.json(),role=data.user.role;
    if(role==='employee'&&path!=='employee.html'){location.replace('employee.html');return}
    if(role==='auditor'&&path!=='demo.html'){location.replace('demo.html');return}
    if(['owner','admin','hr_manager'].includes(role)===false && ['offboarding.html','employees.html','security.html','settings.html'].includes(path)){location.replace('employee.html');return}
    var profile=document.querySelector('.user-meta .name'),roleNode=document.querySelector('.user-meta .role');
    if(profile)profile.textContent=data.user.displayName;
    if(roleNode)roleNode.textContent=role.replace('_',' ');
  }catch(e){location.replace('login.html');return}
  document.querySelectorAll('.nav a,.mobile-nav a').forEach(function(a){var file=(a.getAttribute('href')||'').split('/').pop();if(file===path)a.classList.add('active')});
  document.querySelectorAll('a[href="dashboard-full.html"]').forEach(function(a){a.remove()});
  var script=document.createElement('script');script.src='js/app.js';script.defer=true;document.body.appendChild(script);
})();
