// Authentication gate and shared navigation.
(async function () {
  var path=location.pathname.split('/').pop()||'index.html';
  if(path==='login.html')return;
  try{
    var response=await fetch('/api/bff/auth/navigation',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new Error('not signed in');
    var data=await response.json(),role=data.user.role,features=new Set(data.user.features||[]);
    if(role==='employee'&&path!=='employee.html'){location.replace('employee.html');return}
    if(role==='auditor'&&path!=='demo.html'){location.replace('demo.html');return}
    if(['owner','admin','hr_manager'].includes(role)===false && ['offboarding.html','employees.html','security.html','settings.html'].includes(path)){location.replace('employee.html');return}
    var profile=document.querySelector('.user-meta .name'),roleNode=document.querySelector('.user-meta .role');
    if(profile)profile.textContent=data.user.displayName;
    if(roleNode)roleNode.textContent=role.replace('_',' ');
  }catch(e){location.replace('login.html');return}
  document.querySelectorAll('.nav a,.mobile-nav a').forEach(function(a){var file=(a.getAttribute('href')||'').split('/').pop();if(file===path)a.classList.add('active')});
  document.querySelectorAll('a[href="dashboard-full.html"]').forEach(function(a){a.remove()});
  if(['owner','admin','hr_manager'].includes(role)){
    var links=[['people-v04.html','People directory','people'],['recruitment.html','Recruitment','recruitment'],['assistant.html','Assistant','ai'],['security-v04.html','Security',null]];
    if(['owner','admin'].includes(role)){links.push(['users.html','Users',null],['settings-v04.html','Workspace settings',null])}
    links=links.filter(function(item){return !item[2]||features.has(item[2])});
    var featureRoutes={'recruitment.html':'recruitment','assistant.html':'ai','onboarding.html':'onboarding','offboarding.html':'offboarding','time.html':'time'};
    var needed=featureRoutes[path];if(needed&&!features.has(needed)){location.replace('index.html');return}
    document.querySelectorAll('.nav,.top-links,.mobile-nav').forEach(function(node){links.forEach(function(item){if(!node.querySelector('a[href="'+item[0]+'"]')){var a=document.createElement('a');a.href=item[0];a.textContent=item[1];node.appendChild(a)}})});
    var select=document.querySelector('#page-select');if(select)links.forEach(function(item){if(!select.querySelector('option[value="'+item[0]+'"]')){var o=document.createElement('option');o.value=item[0];o.textContent=item[1];select.appendChild(o)}});
  }
  var script=document.createElement('script');script.src='js/app.js';script.defer=true;document.body.appendChild(script);
})();
