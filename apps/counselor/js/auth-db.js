// Minimal auth+db helper for the SafeSpace counselor app
// Purpose: centralize Firebase init, auth and simple DB retrieval helpers
// Import this as an ES module: import { initFirebase, auth, db, login, logout, getByPath, queryCounselorsBy } from './auth-db.js'

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getDatabase, connectDatabaseEmulator, get, ref, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js";

let _app = null;
let _db = null;
let _auth = null;
let _fns = null;

// Cloud Functions region; must match firebase/functions/index.js
const FUNCTIONS_REGION = 'asia-southeast1';

// Local development against the Firebase emulators (see firebase/README.md).
// Open any counselor page on localhost with ?emulator=1 to switch on, ?emulator=0 to switch off.
function useEmulators() {
  try {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return false;
    const q = new URLSearchParams(location.search).get('emulator');
    if (q === '1') localStorage.setItem('dev_use_emulators', '1');
    if (q === '0') localStorage.removeItem('dev_use_emulators');
    return localStorage.getItem('dev_use_emulators') === '1';
  } catch (e) { return false; }
}

// Default firebase config (centralized)
const _defaultFirebaseConfig = {
  apiKey: "AIzaSyD4eMHzsieWnIH6nHLgBl1PDTiIETeVmnA",
  authDomain: "rsu-safespace.firebaseapp.com",
  databaseURL: "https://rsu-safespace-default-rtdb.firebaseio.com",
  projectId: "rsu-safespace",
  storageBucket: "rsu-safespace.firebasestorage.app",
  messagingSenderId: "490237933031",
  appId: "1:490237933031:web:0d17829f4359da952db942",
  measurementId: "G-YY33W1QM2N"
};

export function initFirebase(config) {
  if (_app) return { app: _app, db: _db, auth: _auth };
  const emu = useEmulators();
  const base = config || _defaultFirebaseConfig;
  // The emulators run under the demo project id used by firebase/package.json scripts.
  const cfg = emu ? { ...base, projectId: 'demo-safespace', databaseURL: 'https://demo-safespace-default-rtdb.firebaseio.com' } : base;
  _app = initializeApp(cfg);
  _db = getDatabase(_app);
  _auth = getAuth(_app);
  _fns = getFunctions(_app, FUNCTIONS_REGION);
  if (emu) {
    connectAuthEmulator(_auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectDatabaseEmulator(_db, '127.0.0.1', 9000);
    connectFunctionsEmulator(_fns, '127.0.0.1', 5001);
    console.warn('[SafeSpace] Using Firebase emulators');
  }
  return { app: _app, db: _db, auth: _auth };
}

export function authInstance() { return _auth; }

// Call a Cloud Function (callable) and return its data.
export async function callFunction(name, data) {
  if (!_fns) throw new Error('Firebase not initialized. Call initFirebase(config) first.');
  const res = await httpsCallable(_fns, name)(data || {});
  return res.data;
}

// Role + 2FA state from the signed-in user's ID token claims (set server-side only).
export async function getSessionInfo(user, forceRefresh = false) {
  const u = user || (_auth && _auth.currentUser);
  if (!u) return { role: null, twofaUntil: 0, twofaAuthTime: 0, authTime: 0 };
  const tok = await u.getIdTokenResult(forceRefresh);
  return {
    role: tok.claims.role || null,
    twofaUntil: Number(tok.claims.twofa_until || 0),
    twofaAuthTime: Number(tok.claims.twofa_auth_time || 0),
    authTime: Number(tok.claims.auth_time || 0),
  };
}
// 2FA counts only if the server stamped THIS sign-in (same auth_time) and the stamp has not expired.
export const hasTwoFA = (info) => !!info && info.twofaUntil > Date.now() && info.twofaAuthTime > 0 && info.twofaAuthTime === info.authTime;
// A counselor session is only usable with the counselor role AND a valid server-verified 2FA stamp.
export const isCounselorSession = (info) => !!info && info.role === 'counselor' && hasTwoFA(info);
export function dbInstance() { return _db; }

// Simple wrapper: get a snapshot value by path
export async function getByPath(path) {
  if (!_db) throw new Error('Firebase not initialized. Call initFirebase(config) first.');
  const snap = await get(ref(_db, path));
  return snap.exists() ? snap.val() : null;
}

// Query helper for counselors by a field (email_address or uid)
export async function queryCounselorsBy(field, value) {
  if (!_db) throw new Error('Firebase not initialized. Call initFirebase(config) first.');
  const q = query(ref(_db, 'counselors'), orderByChild(field), equalTo(value));
  const snap = await get(q);
  if (!snap.exists()) return null;
  const res = [];
  snap.forEach(child => res.push({ key: child.key, val: child.val() }));
  return res;
}

// Auth helpers
export const login = (email, password) => {
  if (!_auth) throw new Error('Firebase not initialized. Call initFirebase(config) first.');
  return signInWithEmailAndPassword(_auth, email, password);
};
export const logout = () => {
  if (!_auth) throw new Error('Firebase not initialized. Call initFirebase(config) first.');
  return signOut(_auth);
};
export const watchAuth = (cb) => {
  if (!_auth) throw new Error('Firebase not initialized. Call initFirebase(config) first.');
  return onAuthStateChanged(_auth, cb);
};

// New: ensure that if a counselor is currently authenticated, manual navigation
// to student-portal pages will redirect back to the counselor area.
// Usage: call enforceCounselorRouting({ counselorUrl: '/Counselor/index.html', studentPathRegex: /\/student\//i })
// Returns the unsubscribe function from onAuthStateChanged.
export async function _isUserCounselor(user) {
  if (!user) return false;
  try {
    const byUid = await queryCounselorsBy('uid', user.uid);
    if (byUid && byUid.length) return true;
    const byEmail = await queryCounselorsBy('email_address', user.email);
    if (byEmail && byEmail.length) return true;
  } catch (e) {
    // swallow errors - assume non-counselor on failure
    console.error('Error checking counselor status', e);
  }
  return false;
}

export function enforceCounselorRouting({ counselorUrl = '/Counselor/', studentPathRegex = /\/student\//i } = {}) {
  if (!_auth) throw new Error('Firebase not initialized. Call initFirebase(config) first.');
  // callback runs on initial auth state and on changes
  const cb = async (user) => {
    if (!user) return;
    const isCounselor = await _isUserCounselor(user);
    if (!isCounselor) return;
    const href = window.location.pathname + window.location.search + window.location.hash;
    if (studentPathRegex.test(href)) {
      // use replace so back button doesn't return to the student page
      window.location.replace(counselorUrl);
    }
  };
  return onAuthStateChanged(_auth, cb);
}

// Clear user-specific cache and session data. This should be called when
// switching accounts to ensure stale data doesn't persist across users.
export function clearUserCache(options = {}) {
  try {
    // Remove any session-only items
    try { sessionStorage.clear(); } catch (e) { /* ignore */ }

    // Remove common local keys used by the app (prefix-based)
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith('safe_') || key.startsWith('counselor_') || key.startsWith('ss_')) toRemove.push(key);
      }
      toRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }

    // Optionally call a custom callback to let pages reset UI
    if (options.onClear && typeof options.onClear === 'function') {
      try { options.onClear(); } catch (e) {}
    }
  } catch (e) {
    console.warn('clearUserCache failed', e);
  }
}

// Require authentication for the current page. If unauthenticated, redirects
// to the supplied `loginPage` (defaults to 'login.html'). Also
// clears cached data when the signed-in UID changes.
export function requireSignIn({ loginPage = 'login.html', onUserChange } = {}) {
  if (!_auth) throw new Error('Firebase not initialized. Call initFirebase(config) first.');
  let lastUid = null;
  const unsub = onAuthStateChanged(_auth, async (user) => {
    try {
      if (!user || !user.uid) {
        // Not signed in -> redirect (avoid infinite loop if already on login page)
        const path = window.location.pathname || '';
        if (!path.endsWith(loginPage)) {
          try { clearUserCache(); } catch (e) {}
          window.location.replace(loginPage);
        }
        return;
      }

      // Signed in, but not as a verified counselor (no role claim, other role, or 2FA missing/expired):
      // send back to the login page, which explains why and starts 2FA when needed.
      if (!isCounselorSession(await getSessionInfo(user))) {
        const path = window.location.pathname || '';
        if (!path.endsWith(loginPage)) window.location.replace(loginPage);
        return;
      }

      // Signed in: if UID changed, clear caches so pages reload user-specific data
      if (lastUid && lastUid !== user.uid) {
        try { clearUserCache({ onClear: onUserChange }); } catch (e) {}
      }
      lastUid = user.uid;
      // Let caller react to user change
      if (onUserChange && typeof onUserChange === 'function') {
        try { onUserChange(user); } catch (e) {}
      }
    } catch (e) {
      console.error('requireSignIn handler error', e);
    }
  });
  return () => { try { unsub(); } catch (e) {} };
}

// Attach for debugging convenience (optional)
window._authDbHelper = { callFunction, getSessionInfo, initFirebase, authInstance, dbInstance, getByPath, queryCounselorsBy, login, logout, watchAuth, enforceCounselorRouting };

// Example: The app that imports this file should call initFirebase() once before using other helpers.
