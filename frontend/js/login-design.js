'use strict';
const passwordToggle = document.querySelector('#passwordToggle');
const passwordInput = document.querySelector('#password');
passwordToggle.addEventListener('click', () => {
  const visible = passwordInput.type === 'password';
  passwordInput.type = visible ? 'text' : 'password';
  passwordToggle.textContent = visible ? 'Hide' : 'Show';
  passwordToggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  passwordToggle.setAttribute('aria-pressed', String(visible));
});
