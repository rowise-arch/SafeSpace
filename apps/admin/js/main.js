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
import { getAuth, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
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

// Default app (for admin session)
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

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
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  getStorage,
  storageRef,
  getDownloadURL
};

// Secondary app just for creating users safely (avoids messing with admin session)
const secondaryApp = initializeApp(firebaseConfig, "Secondary");
const secondaryAuth = getAuth(secondaryApp);

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

// Add counselor record and create auth user; returns { id, password, uid }
export async function addCounselorRecord({
  username,
  first_name,
  last_name,
  email_address,
  specialization,
  department,
  status = "Active",
  campus,
  photo_url,
  // accept college aliases that other code may provide
  college,
  college_name,
  collegeName,
  college_display
}) {
  const id = await generateNextCounselorId();
  // Create login account if email provided
  const password = generateRandomString();
  let uid = null;
  if (email_address) {
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email_address, password);
      uid = cred.user?.uid || null;
    } finally {
      try { await signOut(secondaryAuth); } catch {}
    }
  }

  // Only add to database if Auth user creation succeeded (or no email provided)
  // Normalize college value from any provided alias
  const collegeValue = (college || college_name || collegeName || college_display || "").toString();

  const payload = {
    counselor_id: id,
    username: username || "",
    first_name: first_name || "",
    last_name: last_name || "",
    email_address: email_address || "",
    specialization: specialization || "",
    department: department || "",
    status: status || "Active",
    campus: campus || "",
    photo_url: photo_url || "",
    college: collegeValue,
    login: "Enable",
    login_access: true,
    created_at: new Date().toISOString(),
    uid: uid || null
  };

  await set(ref(db, `counselors/${id}`), payload);

  return { id, password, uid };
}

// Update counselor fields
export async function updateCounselor(id, data) {
  await update(ref(db, `counselors/${id}`), data || {});
}

// Delete counselor
export async function deleteCounselor(id) {
  await remove(ref(db, `counselors/${id}`));
}

// Toggle login access
export async function toggleCounselorLogin(id, enabled) {
  await update(ref(db, `counselors/${id}`), {
    login: enabled ? "Enable" : "Disable",
    login_access: !!enabled
  });
}

// -----------------------------
// Admin authentication helpers
// -----------------------------
// Checks Realtime Database under `admins/{uid}` for admin record
export async function isAdminUid(uid) {
  if (!uid) return false;
  try {
    console.debug('isAdminUid: checking admins/' + uid);
    const snap = await get(ref(db, `admins/${uid}`));
    console.debug('isAdminUid: db snapshot received for', uid, snap.exists());
    if (!snap.exists()) return false;
    const val = snap.val();
    console.debug('isAdminUid: data=', val);
    if (!val) return false;
    const role = val.role || val.position || '';
    const enabled = (val.enable || val.enabled || '').toString().toLowerCase();
    // treat missing enable as allowed but prefer explicit 'enable'
    const isEnabled = !enabled || enabled === 'enable' || enabled === 'true';
    return (role === 'admin' || role === 'Administrator' || role === 'administrator') && isEnabled;
  } catch (err) {
    console.error('isAdminUid error', err);
    return false;
  }
}

// Sign in and enforce admin-only access. Redirects to admin-dashboard.html on success.
export async function adminLogin(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const user = cred.user;
  console.debug('adminLogin: signed in user', user && user.uid, user && user.email);
  const ok = await isAdminUid(user.uid);
  if (!ok) {
    try { await signOut(auth); } catch (e) {}
    throw new Error('Access denied. User is not an admin.');
  }
  // authorized
  // redirect to the actual appointment page in this project
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
      const ok = await isAdminUid(user.uid);
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
      const ok = await isAdminUid(user.uid);
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



