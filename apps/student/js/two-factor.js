// Shared email two-factor flows for the student app (server-side: sendLoginCode / verifyLoginCode / setTwoFactor).
// Needs firebase-config.js (callFunction, getSessionInfo, hasTwoFA) and the firebase-functions script on the page.
//
//   SafeSpace2FA.ensureStamp({ autoSend })  -> Promise<boolean>  asks for an emailed code unless this sign-in already passed 2FA
//   SafeSpace2FA.setEnabled(true|false)     -> Promise<boolean>  turns 2FA on/off (needs a code for this sign-in first)
(function () {
  var MODAL_ID = 'ss2faModal';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function errorMessage(err, fallback) {
    var c = String((err && err.code) || '');
    if (/invalid-argument$/.test(c)) return 'Incorrect code.';
    if (/deadline-exceeded$/.test(c)) return 'Code expired. Please request a new one.';
    if (/resource-exhausted$/.test(c)) return (err && err.message) || 'Too many requests. Please wait and try again.';
    if (/failed-precondition$/.test(c)) return 'No active code. Please request a new one.';
    if (/(unauthenticated|permission-denied)$/.test(c)) return 'Your session is not valid. Please sign in again.';
    return fallback || 'Something went wrong. Please try again.';
  }

  // This script is used on several pages; make sure the shared design system is present.
  var scriptSrc = (document.currentScript && document.currentScript.src) || '';
  function ensureStyles() {
    if (document.getElementById('ss-2fa-styles') || !scriptSrc) return;
    var base = scriptSrc.replace(/apps\/student\/js\/[^/]*$/, 'shared/assets/css/');
    ['safespace.css', 'components.css'].forEach(function (name) {
      if (document.querySelector('link[href$="' + name + '"]')) return;
      var l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = base + name; l.id = name === 'components.css' ? 'ss-2fa-styles' : '';
      document.head.appendChild(l);
    });
    if (!document.getElementById('ss-2fa-styles')) { var m = document.createElement('meta'); m.id = 'ss-2fa-styles'; document.head.appendChild(m); }
  }

  function showCodeModal(options, done) {
    var old = document.getElementById(MODAL_ID);
    if (old) old.remove();
    var title = options.title || 'Verify your email';
    ensureStyles();
    document.body.insertAdjacentHTML('beforeend',
      '<div id="' + MODAL_ID + '" class="ss-modal ss-page" style="z-index:10000">' +
      '<div class="ss-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="ss2faTitle" aria-describedby="ss2faMsg">' +
      '<button type="button" id="ss2faClose" class="ss-modal__close" aria-label="Close">&times;</button>' +
      '<h2 id="ss2faTitle" class="ss-modal__title">' + esc(title) + '</h2>' +
      '<p id="ss2faMsg" class="ss-modal__body" style="margin-bottom:var(--ss-space-4)">We will email you a 6-digit code.</p>' +
      '<div id="ss2faStep1"><button type="button" id="ss2faSend" class="ss-btn ss-btn--primary ss-btn--block">Send verification code</button></div>' +
      '<div id="ss2faStep2" style="display:none;">' +
      '<label class="ss-label" for="ss2faCode" style="display:block;margin-bottom:8px">Verification code</label>' +
      '<input type="text" id="ss2faCode" class="ss-control__input" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" maxlength="6" style="padding-left:16px;text-align:center;font-size:1.4rem;letter-spacing:0.3em;font-weight:800;margin-bottom:var(--ss-space-4)" />' +
      '<button type="button" id="ss2faVerify" class="ss-btn ss-btn--primary ss-btn--block">Verify</button>' +
      '<p style="margin:var(--ss-space-4) 0 0;text-align:center;font-size:var(--ss-text-sm);"><a href="#" id="ss2faResend" class="ss-link">Resend code</a></p>' +
      '</div>' +
      '<p id="ss2faErr" role="alert" style="color:var(--ss-danger);font-weight:700;font-size:var(--ss-text-sm);margin:var(--ss-space-3) 0 0;display:none;"></p>' +
      '</div></div>');

    var $ = function (id) { return document.getElementById(id); };
    var finished = false;
    function finish(ok) {
      if (finished) return;
      finished = true;
      var m = $(MODAL_ID);
      if (m) m.remove();
      done(ok);
    }
    function setErr(msg) { var e = $('ss2faErr'); e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none'; }

    var resendTimer = null;
    function lockResend() {
      var link = $('ss2faResend');
      if (!link) return;
      var until = Date.now() + 60000;
      link.dataset.locked = '1';
      link.style.opacity = '0.5'; link.style.pointerEvents = 'none';
      clearInterval(resendTimer);
      resendTimer = setInterval(function () {
        if (Date.now() >= until) { clearInterval(resendTimer); link.dataset.locked = ''; link.style.opacity = '1'; link.style.pointerEvents = ''; }
      }, 1000);
    }

    function sendCode() {
      setErr('');
      var btn = $('ss2faSend');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
      return window.callFunction('sendLoginCode', {}).then(function () {
        $('ss2faMsg').textContent = 'Enter the 6-digit code we sent to your email.';
        $('ss2faStep1').style.display = 'none';
        $('ss2faStep2').style.display = 'block';
        $('ss2faCode').focus();
        lockResend();
      }).catch(function (err) {
        if (/resource-exhausted$/.test(String((err && err.code) || ''))) {
          // a code went out a moment ago: let the user type it
          $('ss2faMsg').textContent = 'A code was sent recently. Check your email and enter it below.';
          $('ss2faStep1').style.display = 'none';
          $('ss2faStep2').style.display = 'block';
          lockResend();
          return;
        }
        setErr(errorMessage(err, 'Could not send the code. Please try again.'));
        if (btn) { btn.disabled = false; btn.textContent = 'Send verification code'; }
      });
    }

    $('ss2faClose').onclick = function () { clearInterval(resendTimer); finish(false); };
    $('ss2faSend').onclick = sendCode;
    $('ss2faResend').onclick = function (e) {
      e.preventDefault();
      if (this.dataset.locked) return;
      $('ss2faCode').value = '';
      sendCode();
    };
    $('ss2faVerify').onclick = function () {
      var code = $('ss2faCode').value.trim();
      if (!/^\d{6}$/.test(code)) { setErr('Please enter the 6-digit code.'); return; }
      var btn = this;
      btn.disabled = true;
      setErr('');
      window.callFunction('verifyLoginCode', { code: code }).then(function () {
        // pick up the twofa_until / twofa_auth_time claims the server just set
        return firebase.auth().currentUser.getIdToken(true);
      }).then(function () {
        clearInterval(resendTimer);
        finish(true);
      }).catch(function (err) {
        setErr(errorMessage(err, 'Verification failed. Try again.'));
        $('ss2faCode').value = '';
        btn.disabled = false;
      });
    };
    if (options.autoSend) sendCode();
  }

  function ensureStamp(options) {
    options = options || {};
    return window.getSessionInfo(null, true).then(function (info) {
      if (window.hasTwoFA(info)) return true;
      return new Promise(function (resolve) { showCodeModal(options, resolve); });
    });
  }

  function setEnabled(enabled) {
    return ensureStamp({ title: enabled ? 'Turn on two-factor authentication' : 'Turn off two-factor authentication' }).then(function (ok) {
      if (!ok) return false;
      return window.callFunction('setTwoFactor', { enabled: !!enabled }).then(function () {
        return firebase.auth().currentUser.getIdToken(true);
      }).then(function () { return true; });
    });
  }

  window.SafeSpace2FA = { ensureStamp: ensureStamp, setEnabled: setEnabled };
})();
