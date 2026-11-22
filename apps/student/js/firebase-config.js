// firebase_config.js
// Initializes Firebase and exposes `window.db` for pages that expect it.
// Replace the values below with your project's config if different.
(function() {
  // Firebase config for rsu-safespace (used by verification pages)
  // NOTE: keep this file out of public repos if these keys are sensitive for your workflow.
  var firebaseConfig = {
    apiKey: "AIzaSyD4eMHzsieWnIH6nHLgBl1PDTiIETeVmnA",
    authDomain: "rsu-safespace.firebaseapp.com",
    databaseURL: "https://rsu-safespace-default-rtdb.firebaseio.com",
    projectId: "rsu-safespace",
    storageBucket: "rsu-safespace.firebasestorage.app",
    messagingSenderId: "490237933031",
    appId: "1:490237933031:web:0d17829f4359da952db942",
    measurementId: "G-YY33W1QM2N"
  };

  // Local development against the Firebase emulators (see firebase/README.md):
  // open any student page on localhost with ?emulator=1 to switch on, ?emulator=0 to switch off.
  var useEmulators = false;
  try {
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      var emuParam = new URLSearchParams(location.search).get('emulator');
      if (emuParam === '1') localStorage.setItem('dev_use_emulators', '1');
      if (emuParam === '0') localStorage.removeItem('dev_use_emulators');
      useEmulators = localStorage.getItem('dev_use_emulators') === '1';
    }
  } catch (e) { /* ignore */ }
  if (useEmulators) {
    firebaseConfig.projectId = 'demo-safespace';
    firebaseConfig.databaseURL = 'https://demo-safespace-default-rtdb.firebaseio.com';
  }

  try {
    if (!window.firebase) {
      console.warn('Firebase SDK not loaded yet. Ensure firebase-app.js and firebase-auth.js are included before firebase_config.js.');
    }

    if (window.firebase && !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
      console.log('Firebase initialized');
      if (useEmulators) {
        try { if (firebase.auth) firebase.auth().useEmulator('http://127.0.0.1:9099'); } catch (e) { /* ignore */ }
        try { if (firebase.database) firebase.database().useEmulator('127.0.0.1', 9000); } catch (e) { /* ignore */ }
        console.warn('[SafeSpace] Using Firebase emulators');
      }
    }

    // Expose database reference for pages that expect `window.db`
    if (window.firebase && firebase.database) {
      window.db = firebase.database();
    }

    // ---- Cloud Functions + server-side session state ----
    var FUNCTIONS_REGION = 'asia-southeast1'; // keep in sync with firebase/functions/index.js
    var _fns = null;
    // Calls a callable Cloud Function; pages that use it must include the firebase-functions script.
    window.callFunction = function (name, data) {
      if (!window.firebase || !firebase.functions) return Promise.reject(new Error('Add the firebase-functions script to this page.'));
      if (!_fns) {
        _fns = firebase.app().functions(FUNCTIONS_REGION);
        if (useEmulators) _fns.useEmulator('127.0.0.1', 5001);
      }
      return _fns.httpsCallable(name)(data || {}).then(function (r) { return r.data; });
    };
    // Role and 2FA state come from ID-token claims that only the server can set.
    window.getSessionInfo = function (user, forceRefresh) {
      user = user || (firebase.auth && firebase.auth().currentUser);
      if (!user) return Promise.resolve({ role: null, mfaRequired: false, twofaUntil: 0, twofaAuthTime: 0, authTime: 0 });
      return user.getIdTokenResult(!!forceRefresh).then(function (t) {
        var c = t.claims || {};
        return {
          role: c.role || null,
          mfaRequired: c.mfa_required === true,
          twofaUntil: Number(c.twofa_until || 0),
          twofaAuthTime: Number(c.twofa_auth_time || 0),
          authTime: Number(c.auth_time || 0)
        };
      });
    };
    // 2FA counts only if the server stamped THIS sign-in and the stamp has not expired.
    window.hasTwoFA = function (i) { return !!i && i.twofaUntil > Date.now() && i.twofaAuthTime > 0 && i.twofaAuthTime === i.authTime; };
    // The student's own consultations. The database rules only allow queries scoped to the signed-in user,
    // so pages must use this instead of reading the whole `consultations` collection.
    window.myConsultations = function (uid) {
      uid = uid || (firebase.auth().currentUser || {}).uid;
      if (!uid) return Promise.reject(new Error('Not signed in'));
      return window.db.ref('consultations').orderByChild('studentId').equalTo(uid).once('value');
    };
    // A usable student session: student role and, if the student turned 2FA on, this sign-in passed it.
    window.isStudentSession = function (i) { return !!i && i.role === 'student' && (!i.mfaRequired || window.hasTwoFA(i)); };

    // Initialize Firebase Messaging if available
    if (window.firebase && firebase.messaging) {
      const messaging = firebase.messaging();
      
      // Register service worker for background messages
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/firebase-messaging-sw.js')
          .then((registration) => {
            console.log('Service Worker registered for FCM');
          })
          .catch((err) => {
            console.log('Service Worker registration failed', err);
          });
      }

      // Handle foreground messages
      messaging.onMessage((payload) => {
        console.log('Foreground FCM message received:', payload);
        // Use existing notification system
        if (window.NotificationUtils && window.NotificationUtils.showNotification) {
          window.NotificationUtils.showNotification(
            payload.notification?.title || 'SafeSpace',
            payload.notification?.body || 'New notification'
          );
        }
      });
    }

    // Lightweight global incoming-call notifier
    // Listens for consultations belonging to the signed-in student and shows a browser
    // notification when a counselor sets roomStatus === 1. This runs on any page that
    // includes firebase_config.js (index.html, messages.html, etc.) so the
    // student will receive notifications even when the chat page isn't open.
    // Reusable authentication enforcement function
    window.enforceAuthRedirect = function() {
      if (window.firebase && firebase.auth && firebase.database) {
        firebase.auth().onAuthStateChanged(function(user) {
          if (!user) {
            console.log('[AuthRedirect] No user signed in, redirecting to signin.html');
            window.location.replace('signin.html');
            return;
          }
          // Role and 2FA come from server-set claims (see firebase/functions)
          window.getSessionInfo(user, false).then(function (info) {
            if (!window.isStudentSession(info)) {
              console.log('[AuthRedirect] Not a verified student session, redirecting to signin.html');
              window.location.replace('signin.html');
            }
          }).catch(function (error) {
            console.log('[AuthRedirect] Error reading session:', error);
            window.location.replace('signin.html');
          });
        });
      } else {
        console.log('[AuthRedirect] Firebase not loaded, redirecting to signin.html');
        window.location.replace('signin.html');
      }
    };
    try{
      if (window.firebase && firebase.auth && window.db){
        const _notified = {}; // consultId -> boolean
        firebase.auth().onAuthStateChanged(user => {
          // clear previous listener if any
          if (window._globalConsultListenerRef){ try{ window._globalConsultListenerRef.off(); }catch(e){} window._globalConsultListenerRef = null; }
          if (!user) return;
          const uid = user.uid;
          // Load notification settings
          firebase.database().ref('student_notif').child(uid).once('value').then(function(notifSnap) {
            const data = notifSnap.val() || { appointment: true, message: true, call: true };
            window.notificationSettings = data;
            window.inAppNotifications = data.inAppNotifications || [];
          }).catch(function (e) { console.log('[notif] settings not readable yet', e && e.code); });
          // Get and store FCM token
          if (firebase.messaging) {
            const messaging = firebase.messaging();
            messaging.getToken({ 
              vapidKey: 'BKxQyMq5pQ8wXcQkGjJcGjJcGjJcGjJcGjJcGjJcGjJcGjJcGjJcGjJcGjJcGjJcGjJcGjJcGjJcGjJcGjJcGjJcGjJc' // Replace with your actual VAPID key
            }).then((currentToken) => {
              if (currentToken) {
                // Store token in database for server-side sending
                firebase.database().ref('student_fcm_tokens').child(uid).set(currentToken);
                console.log('FCM token stored for user');
              } else {
                console.log('No FCM registration token available.');
              }
            }).catch((err) => {
              console.log('An error occurred while retrieving FCM token:', err);
            });
          }
          // Listen to consultations root and filter client-side (keeps compatibility with many data shapes)
          // scoped query: database rules only allow a student to read their own consultations
          const ref = window.db.ref('consultations').orderByChild('studentId').equalTo(uid);
          window._globalConsultListenerRef = ref;
          ref.on('value', snap => {
            const all = snap.val() || {};
            Object.keys(all).forEach(k => {
              const c = all[k] || {};
              // resolve student id heuristically (match many possible fields)
              function consultStudentId(cobj){
                const studentFields = ['studentId','student_id','student_uid','studentUid','student'];
                for (let f of studentFields){ if (cobj && cobj[f]) return String(cobj[f]); }
                if (cobj && cobj.student && typeof cobj.student === 'object'){
                  return cobj.student.uid || cobj.student.id || null;
                }
                return null;
              }
              const sid = consultStudentId(c);
              if (!sid || String(sid) !== String(uid)) return; // not this student's consultation

              // detect canonical room
              const candidates = [c.videoRoom, c.jitsiRoom, c.room, c.video_room, c.video_url, c.meetRoom, c.meetingUrl, c.meeting_link, c.meetingRoom, c.roomName];
              let room = candidates.find(Boolean);
              if (!room && c.meta) room = c.meta.room || c.meta.videoRoom || c.meta.meetingRoom;

              const status = (c.roomStatus !== undefined && c.roomStatus !== null) ? Number(c.roomStatus) : null;

              // Show notification when status transitions to 1
              if (status === 1 && !_notified[k]){
                _notified[k] = true;
                // request permission early when needed
                if (typeof Notification !== 'undefined' && Notification.permission === 'default'){
                  Notification.requestPermission().catch(()=>{});
                }

                // Helper: show an on-page incoming-call modal when messages.html's modal isn't available
                function showSiteIncomingCall(caller, roomId, consultId, photo, counselorId){
                  try{
                    // If the current page has a messages-specific helper, prefer it
                    if (window.showIncomingCall && typeof window.showIncomingCall === 'function'){
                      try{ window.showIncomingCall(caller || 'Counselor', roomId || '', consultId || ''); return; } catch(e){}
                    }

                    // Avoid showing multiple modals for the same consult
                    window._siteIncomingShown = window._siteIncomingShown || {};
                    if (window._siteIncomingShown[consultId]) return;
                    window._siteIncomingShown[consultId] = true;

                    // Fetch photo if not provided
                    let photo_url = photo;
                    if (!photo_url && counselorId && window.db) {
                      (async () => {
                        try {
                          let p = null;
                          const directSnap = await window.db.ref('counselors/' + counselorId).once('value');
                          if (directSnap.exists()) {
                            p = directSnap.val();
                          } else {
                            const snap = await window.db.ref('counselors').orderByChild('uid').equalTo(counselorId).once('value');
                            const v = snap.val();
                            if (v) p = v[Object.keys(v)[0]];
                          }
                          if (p && (p.photo_url || p.photo)) {
                            photo_url = p.photo_url || p.photo;
                            // Update the modal if it's already shown
                            const modal = document.getElementById('site-incoming-call-full-' + String(consultId).replace(/[^a-z0-9_-]/ig,''));
                            if (modal) {
                              let img = modal.querySelector('img');
                              if (!img) {
                                // Replace the placeholder div with img
                                const avatarDiv = modal.querySelector('div[style*="width:120px"]');
                                if (avatarDiv && !avatarDiv.querySelector('img')) {
                                  avatarDiv.innerHTML = '';
                                  img = document.createElement('img');
                                  img.src = photo_url;
                                  img.alt = "Counselor";
                                  img.style.width = '120px';
                                  img.style.height = '120px';
                                  img.style.borderRadius = '999px';
                                  img.style.objectFit = 'cover';
                                  img.style.margin = '0 auto 18px';
                                  img.style.boxShadow = '0 8px 18px rgba(0,0,0,0.12)';
                                  avatarDiv.appendChild(img);
                                }
                              } else if (img.src !== photo_url) {
                                img.src = photo_url;
                              }
                            }
                          }
                        } catch (e) {
                          console.warn('Failed to fetch counselor photo for site incoming call', e);
                        }
                      })();
                    }

                    // Create modal HTML (minimal inline styles so it works across pages)
                    const id = 'site-incoming-call-full-' + String(consultId).replace(/[^a-z0-9_-]/ig,'');
                    if (document.getElementById(id)) return;
                    const photoHtml = photo_url ? `<img src="${escapeHtml(photo_url)}" alt="Counselor" style="width:120px;height:120px;border-radius:999px;object-fit:cover;margin:0 auto 18px;box-shadow:0 8px 18px rgba(0,0,0,0.12);">` : `<div style="width:120px;height:120px;border-radius:999px;background:#fff;margin:0 auto 18px;box-shadow:0 8px 18px rgba(0,0,0,0.12);"></div>`;
                    const html = `
                      <div id="${id}" style="position:fixed;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.6));z-index:99999;display:flex;align-items:center;justify-content:center;">
                        <div style="width:100%;max-width:760px;height:500px;border-radius:12px;overflow:hidden;box-shadow:0 14px 40px rgba(2,6,23,0.6);display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#b3f0d7,#70d7a8);position:relative;">
                          <div style="position:absolute;top:18px;right:18px;color:rgba(255,255,255,0.85);font-size:14px;">Incoming call</div>
                          <div style="text-align:center;max-width:560px;margin:auto;padding:36px;">
                            ${photoHtml}
                            <div style="font-size:28px;color:#ffffff;font-weight:800;text-shadow:0 2px 6px rgba(0,0,0,0.15);">${escapeHtml(caller || 'Counselor')}</div>
                            <div style="color:rgba(255,255,255,0.95);margin-top:6px;margin-bottom:26px;">Video call</div>

                            <div style="display:flex;gap:36px;justify-content:center;align-items:center;margin-top:6px;">
                              <button id="${id}_decline" aria-label="Decline" style="width:84px;height:84px;border-radius:999px;border:none;background:#ef4444;color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;box-shadow:0 8px 18px rgba(0,0,0,0.15);cursor:pointer;">
                                <!-- X icon -->
                                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6L18 18M6 18L18 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                              </button>

                              <button id="${id}_answer" aria-label="Answer" style="width:96px;height:96px;border-radius:999px;border:6px solid rgba(255,255,255,0.85);background:#10b981;color:#fff;display:flex;align-items:center;justify-content:center;font-size:32px;box-shadow:0 10px 24px rgba(16,185,129,0.28);cursor:pointer;">
                                <!-- Camera icon -->
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 10.5L19 8V16L15 13.5" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="6" width="12" height="12" rx="2" stroke="white" stroke-width="1.6"/></svg>
                              </button>
                            </div>

                            <div style="margin-top:18px;color:rgba(255,255,255,0.95);font-size:13px;">Open Messages to join the call or press Answer</div>
                          </div>
                        </div>
                      </div>
                    `;
                    const wrapper = document.createElement('div'); wrapper.innerHTML = html;
                    document.body.appendChild(wrapper.firstElementChild);

                    // helpers: start ringtone and title flash
                    startSiteRingtone(); startFlashTitle();

                    // answer -> navigate directly to the video room page
                    document.getElementById(id + '_answer').addEventListener('click', function(){
                      stopSiteRingtone(); stopFlashTitle();
                      try{
                        // prefer opening the dedicated full-screen video page which auto-initializes Jitsi
                        const consultParam = encodeURIComponent(consultId || '');
                        const roomParam = roomId ? ('&room=' + encodeURIComponent(roomId)) : '';
                        const nameParam = (typeof caller === 'string' && caller) ? ('&name=' + encodeURIComponent(caller)) : '';
                        // open in same tab so popups are not blocked
                        window.location.href = 'video.html?consult=' + consultParam + roomParam + nameParam;
                      }catch(e){
                        // fallback to messages view if something goes wrong
                        try{ const consultParam = encodeURIComponent(consultId || ''); const roomParam = roomId ? ('&room=' + encodeURIComponent(roomId)) : ''; window.location.href = 'messages.html?consult=' + consultParam + roomParam; }catch(e){}
                      }
                    });

                    // decline -> clear DB and remove modal
                    document.getElementById(id + '_decline').addEventListener('click', async function(){
                      stopSiteRingtone(); stopFlashTitle();
                      try{
                        if (consultId && window.db){
                          await window.db.ref('consultations/' + consultId).update({ roomStatus: 0, clearedBy: 'student_decline', clearedAt: Date.now() });
                        }
                      }catch(e){ console.warn('decline clear failed', e); }
                      const el = document.getElementById(id); if (el) el.remove();
                      try{ delete window._siteIncomingShown[consultId]; }catch(e){}
                    });

                    // remove modal if user navigates away
                    window.addEventListener('beforeunload', function(){ const el = document.getElementById(id); if (el) el.remove(); });
                  }catch(e){ console.warn('site incoming call show failed', e); }
                }

                // small escaping helper for inline HTML
                function escapeHtml(str){ return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

                // Ringtone & title flash helpers (simple, low dependency)
                window._siteRingtone = window._siteRingtone || {audioCtx:null,osc:null,interval:null};
                function startSiteRingtone(){
                  try{
                    if (window._siteRingtone.playing) return; window._siteRingtone.playing = true;
                    const AudioCtx = window.AudioContext || window.webkitAudioContext;
                    if (!AudioCtx) return;
                    const ctx = new AudioCtx(); window._siteRingtone.audioCtx = ctx;
                    const o = ctx.createOscillator(); const g = ctx.createGain();
                    o.type = 'sine'; o.frequency.value = 880; // start
                    g.gain.value = 0.0001; // start very low to avoid autoplay rejection spike
                    o.connect(g); g.connect(ctx.destination);
                    o.start();
                    // ramp up and play a quick motif loop
                    let step = 0; window._siteRingtone.interval = setInterval(()=>{
                      const freqs = [880, 988, 1047, 880];
                      const f = freqs[step % freqs.length];
                      try{ o.frequency.setValueAtTime(f, ctx.currentTime); g.gain.cancelScheduledValues(ctx.currentTime); g.gain.setValueAtTime(0.12, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6); }catch(e){}
                      step++;
                    }, 700);
                    window._siteRingtone.osc = o;
                  }catch(e){ console.warn('startSiteRingtone failed', e); }
                }
                function stopSiteRingtone(){
                  try{
                    window._siteRingtone.playing = false;
                    if (window._siteRingtone.interval) clearInterval(window._siteRingtone.interval);
                    if (window._siteRingtone.osc){ try{ window._siteRingtone.osc.stop(); }catch(e){} window._siteRingtone.osc.disconnect(); }
                    if (window._siteRingtone.audioCtx){ try{ window._siteRingtone.audioCtx.close(); }catch(e){} }
                    window._siteRingtone = {audioCtx:null,osc:null,interval:null};
                  }catch(e){ }
                }

                // Title flash
                window._siteTitleFlash = window._siteTitleFlash || { timer: null, original: document.title };
                function startFlashTitle(){ try{ if (window._siteTitleFlash.timer) return; window._siteTitleFlash.original = document.title; let on = false; window._siteTitleFlash.timer = setInterval(()=>{ document.title = (on ? 'Incoming call… ' : window._siteTitleFlash.original); on = !on; }, 1000); }catch(e){} }
                function stopFlashTitle(){ try{ if (window._siteTitleFlash.timer) clearInterval(window._siteTitleFlash.timer); document.title = window._siteTitleFlash.original || document.title; window._siteTitleFlash.timer = null; }catch(e){} }

                // First show browser notification (if allowed)
                try{
                  // Check notification settings
                  let allowNotif = true;
                  if (window.notificationSettings && window.notificationSettings.call === false) {
                    allowNotif = false;
                  }
                  if (!allowNotif) return;

                  if (typeof Notification !== 'undefined' && Notification.permission === 'granted'){
                    const title = (c.counselorName || 'Counselor') + ' — Video call';
                    const body = (c.counselorName ? c.counselorName + ' is calling you' : 'Incoming video call');
                    const n = new Notification(title, { body, tag: k, renotify: true });
                    n.onclick = function(){ try{ window.focus(); const consultParam = encodeURIComponent(k); const roomParam = room ? ('&room=' + encodeURIComponent(room)) : ''; window.location.href = 'messages.html?consult=' + consultParam + roomParam; }catch(e){} try{ this.close(); }catch(e){} };
                    setTimeout(()=>{ try{ n.close(); }catch(e){} }, 12000);
                  }
                  // Add to in-app notification bell
                  if (window.showInAppNotification) {
                    window.showInAppNotification('Incoming video call from counselor', () => { window.location.href = 'messages.html?consult=' + encodeURIComponent(k); });
                  }
                }catch(e){ console.warn('global notification failed', e); }

                // Then ensure the in-page modal appears (either by delegating to messages.html's helper or injecting one here)
                try{ showSiteIncomingCall(c.counselorName || 'Counselor', room, k, (c.photo_url || (c.counselor && c.counselor.photo_url)), c.counselorId); }catch(e){ console.warn('showSiteIncomingCall error', e); }
              }

                // Expose the site helper so pages (like messages.html) can delegate to it
                try{ if (typeof showSiteIncomingCall === 'function') window.showSiteIncomingCall = showSiteIncomingCall; }catch(e){}

              // Clear notified flag when status goes back to 0
              if (status === 0 && _notified[k]){
                delete _notified[k];
              }
            });
          });
        });
      }
    }catch(e){ console.warn('global notifier init failed', e); }

    // Also make firebase available globally if not already
    window.firebase = window.firebase || firebase;
  } catch (err) {
    console.error('Error initializing Firebase in firebase_config.js', err);
  }

})();

