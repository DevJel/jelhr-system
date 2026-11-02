// Highlight active nav link based on current page
(function () {
  var path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a, .mobile-nav a').forEach(function (a) {
    var href = a.getAttribute('href');
    if (!href) return;
    var file = href.split('/').pop();
    if (file === path || (path === '' && file === 'index.html')) {
      a.classList.add('active');
    }
  });
})();
