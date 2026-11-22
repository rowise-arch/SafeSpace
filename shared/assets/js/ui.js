// SafeSpace shared UI helpers. Plain script (no modules), safe to load on any page after components.css.
//
//   SafeSpaceUI.alert(message, { title, onClose, icon })   accessible modal, returns a Promise that resolves when closed
//   SafeSpaceUI.confirm(message, { title, confirmText, cancelText, danger })  -> Promise<boolean>
//   SafeSpaceUI.setLoading(button, true|false)             spinner + aria-busy; the label text stays for screen readers
//   Password fields: <button data-ss-toggle-password="#passwordId"> toggles visibility (wired automatically)
//   window.showModal(message, callback)                    compatibility shim for the old per-page helper
(function () {
  var MODAL_ID = 'alertModal'; // ids kept stable: browser tests and old code look for them

  function text(el, message) {
    // Plain text only (never HTML): <br> from old messages becomes a line break.
    el.textContent = '';
    String(message == null ? '' : message).split(/<br\s*\/?>/i).forEach(function (part, i) {
      if (i) el.appendChild(document.createElement('br'));
      el.appendChild(document.createTextNode(part));
    });
  }

  function openModal(build) {
    return new Promise(function (resolve) {
      var previous = document.activeElement;
      var old = document.getElementById(MODAL_ID);
      if (old) old.remove();

      var overlay = document.createElement('div');
      overlay.className = 'ss-modal';
      overlay.id = MODAL_ID;
      var dialog = document.createElement('div');
      dialog.className = 'ss-modal__dialog';
      dialog.setAttribute('role', 'alertdialog');
      dialog.setAttribute('aria-modal', 'true');
      overlay.appendChild(dialog);

      var done = false;
      function close(result) {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        if (previous && previous.focus) { try { previous.focus(); } catch (e) { /* ignore */ } }
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(false); return; }
        if (e.key !== 'Tab') return;                       // keep focus inside the dialog
        var f = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      document.addEventListener('keydown', onKey, true);
      overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(false); });

      var focusEl = build(dialog, close);
      document.body.appendChild(overlay);
      if (focusEl) focusEl.focus();
    });
  }

  function addCloseX(dialog, close) {
    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'ss-modal__close';
    x.setAttribute('aria-label', 'Close');
    x.innerHTML = '<i class="fas fa-xmark" aria-hidden="true"></i>';
    x.onclick = function () { close(false); };
    dialog.appendChild(x);
  }

  function head(dialog, id, title, message, iconClass, danger) {
    var icon = document.createElement('div');
    icon.className = 'ss-modal__icon' + (danger ? ' ss-modal__icon--danger' : '');
    icon.innerHTML = '<i class="fas ' + (iconClass || 'fa-circle-info') + '" aria-hidden="true"></i>';
    dialog.appendChild(icon);
    if (title) {
      var h = document.createElement('h2');
      h.className = 'ss-modal__title';
      h.id = id + 'Title';
      h.textContent = title;
      dialog.appendChild(h);
      dialog.setAttribute('aria-labelledby', h.id);
    }
    var p = document.createElement('p');
    p.className = 'ss-modal__body';
    p.id = id + 'Body';
    text(p, message);
    dialog.appendChild(p);
    dialog.setAttribute('aria-describedby', p.id);
  }

  function button(label, cls, id) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ss-btn ' + cls;
    b.textContent = label;
    if (id) b.id = id;
    return b;
  }

  var UI = {
    alert: function (message, opts) {
      opts = opts || {};
      return openModal(function (dialog, close) {
        addCloseX(dialog, close);
        head(dialog, MODAL_ID, opts.title, message, opts.icon, opts.danger);
        var actions = document.createElement('div');
        actions.className = 'ss-modal__actions';
        var ok = button(opts.okText || 'OK', 'ss-btn--primary', 'modalOkBtn');
        ok.onclick = function () { close(true); };
        actions.appendChild(ok);
        dialog.appendChild(actions);
        return ok;
      }).then(function (r) { if (opts.onClose) opts.onClose(); return r; });
    },
    confirm: function (message, opts) {
      opts = opts || {};
      return openModal(function (dialog, close) {
        addCloseX(dialog, close);
        head(dialog, MODAL_ID, opts.title || 'Are you sure?', message, opts.icon || 'fa-circle-question', opts.danger);
        var actions = document.createElement('div');
        actions.className = 'ss-modal__actions';
        var no = button(opts.cancelText || 'Cancel', 'ss-btn--ghost', 'modalCancelBtn');
        var yes = button(opts.confirmText || 'Confirm', opts.danger ? 'ss-btn--danger' : 'ss-btn--primary', 'modalOkBtn');
        no.onclick = function () { close(false); };
        yes.onclick = function () { close(true); };
        actions.appendChild(no);
        actions.appendChild(yes);
        dialog.appendChild(actions);
        return opts.danger ? no : yes;
      });
    },
    setLoading: function (btn, on) {
      if (!btn) return;
      btn.classList.toggle('is-loading', !!on);
      btn.disabled = !!on;
      if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
    }
  };

  // Password show/hide
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-ss-toggle-password]');
    if (!t) return;
    var input = document.querySelector(t.getAttribute('data-ss-toggle-password'));
    if (!input) return;
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    t.setAttribute('aria-pressed', show ? 'true' : 'false');
    t.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    var i = t.querySelector('i');
    if (i) { i.classList.toggle('fa-eye', !show); i.classList.toggle('fa-eye-slash', show); }
  });

  window.SafeSpaceUI = UI;
  // Old pages call showModal(message, callback) and expect plain text/HTML-less messages.
  if (typeof window.showModal !== 'function') {
    window.showModal = function (message, callback) { return UI.alert(message, { onClose: callback }); };
  }
})();
