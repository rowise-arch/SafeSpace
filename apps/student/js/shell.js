// Student shell accessibility helpers. Works on any page that has the shared sidebar/topbar markup; no page edits needed.
//  - landmarks: <nav> for the sidebar, <main> for the content, skip link
//  - keyboard access for the clickable divs (menu, notifications, profile)
//  - aria-current on the active sidebar link
//  - Esc closes the mobile menu
(function () {
  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

  function makeButton(el, label) {
    if (!el || el.getAttribute('role')) return;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    if (label) el.setAttribute('aria-label', label);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
    });
  }

  ready(function () {
    var sidebar = document.getElementById('sidebar') || document.querySelector('.sidebar');
    var content = document.getElementById('content') || document.querySelector('.content');

    if (sidebar) {
      sidebar.setAttribute('role', 'navigation');
      sidebar.setAttribute('aria-label', 'Main');
      var active = sidebar.querySelector('a.active');
      if (active) active.setAttribute('aria-current', 'page');
    }
    if (content) {
      content.setAttribute('role', 'main');
      if (!content.id) content.id = 'content';
      content.setAttribute('tabindex', '-1');
      if (!document.querySelector('.ss-skip-link')) {
        var skip = document.createElement('a');
        skip.className = 'ss-skip-link';
        skip.href = '#' + content.id;
        skip.textContent = 'Skip to main content';
        document.body.insertBefore(skip, document.body.firstChild);
      }
    }

    var burger = document.querySelector('.hamburger');
    makeButton(burger, 'Toggle navigation menu');
    makeButton(document.querySelector('.notif-wrapper'), 'Notifications');
    makeButton(document.querySelector('.topbar .profile'), 'Your profile');

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !sidebar || !sidebar.classList.contains('mobile-open')) return;
      sidebar.classList.remove('mobile-open');
      var overlay = document.querySelector('.sidebar-overlay');
      if (overlay) overlay.classList.remove('active');
      if (burger) burger.focus();
    });
  });
})();
