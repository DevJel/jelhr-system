'use strict';
const routes = Object.freeze({
 '/employees.html':'/people-v04.html',
 '/security.html':'/security-v04.html',
 '/settings.html':'/settings-v04.html',
 '/demo.html':'/audit.html'
});
const path = location.pathname.replace(/\/+$/, '');
location.replace(routes[path] || routes[path + '.html'] || '/index.html');
