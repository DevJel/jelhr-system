/* ISO/IEC 27001:2022 A.8.28: secure-coding guidance considered; no compliance certification is implied. */
'use strict';
const allowedPages = new Set(['index.html','employees.html','time.html','onboarding.html','offboarding.html','security.html','settings.html']);
document.querySelector('#page-select').addEventListener('change', event => { if (allowedPages.has(event.target.value)) location.href = event.target.value; });
document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-panel]').forEach(item => { const active = item === button; item.classList.toggle('selected', active); item.setAttribute('aria-pressed', String(active)); });
  document.querySelectorAll('[data-section]').forEach(section => section.classList.toggle('mobile-active', section.dataset.section === button.dataset.panel));
}));
document.querySelector('[data-section="overview"]').classList.add('mobile-active');
