// main.js

// Helper: Format timestamp to readable string
export function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d)) return ts;
  return d.toLocaleString();
}

// Helper: Generate random password string
export function generateRandomString(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*=+?';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Helper: Modal open/close
export function openModal(modal) {
  if (modal) {
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
  }
}
export function closeModal(modal) {
  if (modal) {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  }
}

// Helper: Row selection
export function enableRowSelection(tbody) {
  if (!tbody) return;
  tbody.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr");
    if (!tr) return;
    const prev = tbody.querySelector("tr.selected");
    if (prev && prev !== tr) prev.classList.remove("selected");
    tr.classList.toggle("selected");
  });
}

// Helper: Search filter
export function enableSearchFilter(searchInput, tbody, columns = 7) {
  if (!searchInput || !tbody) return;
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    for (const row of Array.from(tbody.rows)) {
      const texts = Array.from(row.cells).slice(0, columns).map(c => (c.textContent || "").toLowerCase());
      row.style.display = (!q || texts.some(t => t.includes(q))) ? "" : "none";
    }
  });
}

// =============================
// Firebase + Counselors API
// =============================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getDatabase, ref, get, set, update, remove } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { getAuth, sendPasswordResetEmail, signOut, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { connectAuthEmulator } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { connectDatabaseEmulator } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-functions.js";
import { getStorage, ref as storageRef, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-storage.js";

const firebaseConfig = {
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
// open any admin page on localhost with ?emulator=1 to switch on, ?emulator=0 to switch off.
let useEmulators = false;
try {
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    const emuParam = new URLSearchParams(location.search).get('emulator');
    if (emuParam === '1') localStorage.setItem('dev_use_emulators', '1');
    if (emuParam === '0') localStorage.removeItem('dev_use_emulators');
    useEmulators = localStorage.getItem('dev_use_emulators') === '1';
  }
} catch (e) { /* ignore */ }
if (useEmulators) {
  firebaseConfig.projectId = 'demo-safespace';
  firebaseConfig.databaseURL = 'https://demo-safespace-default-rtdb.firebaseio.com';
}

// Default app (for admin session)
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const functions = getFunctions(app, 'asia-southeast1'); // keep in sync with firebase/functions/index.js
if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(db, '127.0.0.1', 9000);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  console.warn('[SafeSpace admin] Using Firebase emulators');
}

// Calls a callable Cloud Function (see firebase/functions); returns its data.
export async function callFunction(name, data) {
  const res = await httpsCallable(functions, name)(data || {});
  return res.data;
}

// Export app, auth, db and common helpers so other pages can use the same initialized instances
export {
  app,
  auth,
  db,
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  getStorage,
  storageRef,
  getDownloadURL
};

// Read all counselors
export async function fetchCounselors() {
  const snap = await get(ref(db, "counselors"));
  return snap.exists() ? snap.val() : {};
}

// Read one counselor
export async function getCounselor(id) {
  if (!id) return null;
  const snap = await get(ref(db, `counselors/${id}`));
  return snap.exists() ? snap.val() : null;
}

//Reset counselor password
export async function sendReset(emailreset) {
  try {
    await sendPasswordResetEmail(auth, emailreset);
    alert("A password reset link has been sent to the counselor's registered email address (" + emailreset + ")");
  } catch (error) {
    alert("Error: " + error.message);
  }
}

// Generate next counselor ID as 3 digits (001, 002, ...), avoiding collisions
async function generateNextCounselorId() {
  const snap = await get(ref(db, "counselors"));
  let maxNum = 0;
  if (snap.exists()) {
    const all = snap.val();
    for (const k of Object.keys(all)) {
      const child = all[k];
      let n = null;
      if (child && child.counselor_id) {
        n = parseInt(child.counselor_id, 10);
      } else if (/^\d+$/.test(k)) {
        n = parseInt(k, 10);
      }
      if (!isNaN(n) && n > maxNum) maxNum = n;
    }
  }
  let next = maxNum + 1;
  let id = String(next).padStart(3, "0");
  while ((await get(ref(db, `counselors/${id}`))).exists()) {
    next++;
    id = String(next).padStart(3, "0");
  }
  return id;
}

// Creates a counselor on the server: login account, role claim, database record and a set-password email.
// No password is ever generated or shown in the browser. Returns { id, uid }.
export async function addCounselorRecord(data) {
  const d = data || {};
  const res = await callFunction('createCounselor', {
    email_address: d.email_address, first_name: d.first_name, last_name: d.last_name,
    username: d.username, specialization: d.specialization, department: d.department,
    campus: d.campus, photo_url: d.photo_url, phone_number: d.phone_number, birthday: d.birthday,
    gender: d.gender, role: d.role,
    college: d.college || d.college_name || d.collegeName || d.college_display || ''
  });
  return { id: res.uid, uid: res.uid, counselor_id: res.counselor_id };
}

// Update counselor fields
export async function updateCounselor(id, data) {
  await update(ref(db, `counselors/${id}`), data || {});
}

async function uidOfCounselor(id) {
  const rec = await getCounselor(id);
  if (!rec) throw new Error('Counselor not found.');
  return rec.uid || id;
}

// Delete counselor: removes the login account and the profile (server-side)
export async function deleteCounselor(id) {
  await callFunction('deleteCounselor', { uid: await uidOfCounselor(id) });
}

// Toggle login access: enforced by Firebase Auth (disabled accounts cannot sign in) and mirrored in the record
export async function toggleCounselorLogin(id, enabled) {
  await callFunction('setCounselorAccess', { uid: await uidOfCounselor(id), enabled: !!enabled });
}

// -----------------------------
// Admin authentication helpers
// -----------------------------
// The role comes from a custom claim that only the server can set (firebase/functions/scripts/set-role.js);
// admin access additionally needs a 2FA stamp tied to THIS sign-in (same rule as the database).
export async function getSessionInfo(user, forceRefresh) {
  user = user || auth.currentUser;
  if (!user) return { role: null, twofaUntil: 0, twofaAuthTime: 0, authTime: 0 };
  const t = await user.getIdTokenResult(!!forceRefresh);
  const c = t.claims || {};
  return { role: c.role || null, twofaUntil: Number(c.twofa_until || 0), twofaAuthTime: Number(c.twofa_auth_time || 0), authTime: Number(c.auth_time || 0) };
}
export function hasTwoFA(i) { return !!i && i.twofaUntil > Date.now() && i.twofaAuthTime > 0 && i.twofaAuthTime === i.authTime; }
export async function isAdminSession(user) {
  const i = await getSessionInfo(user, false);
  return i.role === 'admin' && hasTwoFA(i);
}
// Kept for pages that still call it: true only for the signed-in user when they hold a verified admin session
export async function isAdminUid(uid) {
  if (!auth.currentUser || (uid && auth.currentUser.uid !== uid)) return false;
  return isAdminSession(auth.currentUser);
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// Pages that call promptTwoFA may not load the shared design system; make sure it is there.
function ensureDesignStyles() {
  const base = new URL('../../../shared/assets/css/', import.meta.url).href;
  ['safespace.css', 'components.css'].forEach((name) => {
    if (document.querySelector('link[href$="' + name + '"]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = base + name;
    document.head.appendChild(l);
  });
}

// Email-code dialog. Resolves true once the server accepted the code for this sign-in, false if the user closed it.
export function promptTwoFA(title) {
  return new Promise((resolve) => {
    const old = document.getElementById('ss2faModal');
    if (old) old.remove();
    ensureDesignStyles();
    document.body.insertAdjacentHTML('beforeend',
      '<div id="ss2faModal" class="ss-modal ss-page" style="z-index:100000">' +
      '<div class="ss-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="ss2faTitle" aria-describedby="ss2faMsg">' +
      '<button type="button" id="ss2faClose" class="ss-modal__close" aria-label="Close">&times;</button>' +
      '<h2 id="ss2faTitle" class="ss-modal__title">' + esc(title || 'Two-Factor Authentication') + '</h2>' +
      '<p id="ss2faMsg" class="ss-modal__body" style="margin-bottom:var(--ss-space-4)">Sending a 6-digit code to your email...</p>' +
      '<div id="ss2faStep2" style="display:none;">' +
      '<label class="ss-label" for="ss2faCode" style="display:block;margin-bottom:8px">Verification code</label>' +
      '<input id="ss2faCode" class="ss-control__input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" style="padding-left:16px;text-align:center;font-size:1.4rem;letter-spacing:0.3em;font-weight:800;margin-bottom:var(--ss-space-4)" />' +
      '<button type="button" id="ss2faVerify" class="ss-btn ss-btn--primary ss-btn--block">Verify</button>' +
      '<p style="margin:var(--ss-space-4) 0 0;text-align:center;font-size:var(--ss-text-sm);"><a href="#" id="ss2faResend" class="ss-link">Resend code</a></p></div>' +
      '<p id="ss2faErr" role="alert" style="color:var(--ss-danger);font-weight:700;font-size:var(--ss-text-sm);margin:var(--ss-space-3) 0 0;display:none;"></p></div></div>');
    const $ = (id) => document.getElementById(id);
    const setErr = (m) => { const e = $('ss2faErr'); e.textContent = m || ''; e.style.display = m ? 'block' : 'none'; };
    let done = false;
    const finish = (ok) => { if (done) return; done = true; const m = $('ss2faModal'); if (m) m.remove(); resolve(ok); };
    const msg = (e, fallback) => {
      const c = String((e && e.code) || '');
      if (/invalid-argument$/.test(c)) return 'Incorrect code.';
      if (/deadline-exceeded$/.test(c)) return 'Code expired. Please request a new one.';
      if (/resource-exhausted$/.test(c)) return 'Too many requests. Please wait a minute and try again.';
      if (/failed-precondition$/.test(c)) return 'No active code. Please request a new one.';
      return fallback;
    };
    const send = async () => {
      setErr('');
      try {
        await callFunction('sendLoginCode', {});
        $('ss2faMsg').textContent = 'Enter the 6-digit code we sent to your email.';
      } catch (e) {
        if (/resource-exhausted$/.test(String((e && e.code) || ''))) $('ss2faMsg').textContent = 'A code was sent recently. Check your email and enter it below.';
        else { $('ss2faMsg').textContent = 'Could not send the code.'; setErr(msg(e, 'Please try again.')); }
      }
      $('ss2faStep2').style.display = 'block';
      $('ss2faCode').focus();
    };
    $('ss2faClose').onclick = () => finish(false);
    $('ss2faResend').onclick = (ev) => { ev.preventDefault(); $('ss2faCode').value = ''; send(); };
    $('ss2faVerify').onclick = async () => {
      const code = $('ss2faCode').value.trim();
      if (!/^\d{6}$/.test(code)) { setErr('Please enter the 6-digit code.'); return; }
      const btn = $('ss2faVerify'); btn.disabled = true; setErr('');
      try {
        await callFunction('verifyLoginCode', { code });
        await auth.currentUser.getIdToken(true); // pick up the new claims
        finish(true);
      } catch (e) {
        setErr(msg(e, 'Verification failed. Try again.'));
        $('ss2faCode').value = ''; btn.disabled = false;
      }
    };
    send();
  });
}

// Sign in, check the admin role claim, then require the emailed code. Redirects to dashboard.html on success.
export async function adminLogin(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const user = cred.user;
  const fail = async (m) => { try { await signOut(auth); } catch (e) {} throw new Error(m); };
  const info = await getSessionInfo(user, true);
  if (info.role !== 'admin') await fail('Access denied. User is not an admin.');
  if (!hasTwoFA(info)) {
    const ok = await promptTwoFA('Admin sign-in verification');
    if (!ok) await fail('Sign-in cancelled. Admin accounts require email verification.');
  }
  window.location.href = 'dashboard.html';
}

export async function signOutUser() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error('signOutUser error', err);
  }
}

// Expose a helper globally so non-module scripts can call logout safely
window.signOutUser = signOutUser;
window.auth = auth;
window.signOut = signOut;

// Helper that signs out (if possible) and redirects to login.html
window.signOutAndRedirect = async function() {
  try {
    if (typeof window.signOutUser === 'function') {
      await window.signOutUser();
    } else if (window.auth && typeof window.signOut === 'function') {
      await window.signOut(window.auth);
    }
  } catch (err) {
    console.error('signOutAndRedirect error', err);
  } finally {
    try { localStorage.removeItem('authToken'); } catch(e){}
    window.location.href = 'login.html';
  }
};

// Redirect helper: if the user is already authenticated and an admin, redirect away from signin/login pages
export function redirectIfAuthenticated() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    try {
      const ok = await isAdminSession(user);
      if (ok) {
        window.location.href = 'dashboard.html';
      }
    } catch (err) {
      console.error('redirectIfAuthenticated error', err);
    }
  });
}

// Require admin auth on protected pages; redirects to signin if not authorized
export function requireAdminAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    try {
      const ok = await isAdminSession(user);
      if (!ok) {
        try { await signOut(auth); } catch(e){}
        window.location.href = 'login.html';
      }
    } catch (err) {
      console.error('requireAdminAuth error', err);
      try { await signOut(auth); } catch(e){}
      window.location.href = 'login.html';
    }
  });
}

// -----------------------------
// Theme handling (global)
// -----------------------------
const THEME_KEY = 'safespace_theme';

function safeGetTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; }
}

function safeSetTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
}

function applyTheme(theme) {
  if (!theme || theme === 'system') {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  }
}

export function setTheme(theme) {
  safeSetTheme(theme);
  applyTheme(theme);
}

export function getTheme() {
  return safeGetTheme();
}

export function initTheme() {
  const t = safeGetTheme();
  applyTheme(t);
}

// Listen for system preference changes and update when user selected 'system'
try {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const mqHandler = () => {
    if (safeGetTheme() === 'system') applyTheme('system');
  };
  if (mq.addEventListener) mq.addEventListener('change', mqHandler);
  else if (mq.addListener) mq.addListener(mqHandler);
} catch (e) { /* no-op */ }

// Initialize immediately on module import so every page respects stored choice
try { initTheme(); } catch (e) { console.error('initTheme error', e); }

// Make setTheme accessible to non-module scripts
window.setTheme = setTheme;



