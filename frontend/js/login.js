/* ISO/IEC 27001:2022 A.8.28: secure-coding guidance considered; no compliance certification is implied. */
'use strict';
const form = document.querySelector('#loginForm');
const button = document.querySelector('#submitBtn');
const error = document.querySelector('#error');
form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true; button.textContent = 'Verifying…'; error.textContent = '';
  try {
    const response = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body:JSON.stringify({email:form.elements.email.value, password:form.elements.password.value}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to sign in');
    location.replace(data.user.role === 'employee' ? 'employee.html' : 'index.html');
  } catch (failure) { error.textContent = failure.message || 'Unable to sign in.'; }
  finally { button.disabled = false; button.textContent = 'Sign in'; }
});
