'use strict';
const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');
const nodemailer = require('nodemailer');

if (!admin.apps.length) {
  // In the emulator, pin the default instance so rules/indexes from firebase.json apply to the same namespace
  // the tests (and the emulator UI) use. In production this is a no-op: the project's own database is used.
  const emuHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  const project = process.env.GCLOUD_PROJECT;
  admin.initializeApp(emuHost && project ? { databaseURL: `http://${emuHost}?ns=${project}-default-rtdb` } : undefined);
}
const db = () => admin.database();
const auth = () => admin.auth();

const IN_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';

// ---- guards ---------------------------------------------------------------
function requireAuth(req) {
  if (!req.auth || !req.auth.uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  return req.auth.uid;
}
function requireRole(req, ...roles) {
  requireAuth(req);
  const role = req.auth.token && req.auth.token.role;
  if (!role || !roles.includes(role)) throw new HttpsError('permission-denied', 'Not allowed.');
  return role;
}
function str(value, name, { max = 200, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpsError('invalid-argument', `${name} is required.`);
    return '';
  }
  if (typeof value !== 'string' || value.length > max) throw new HttpsError('invalid-argument', `${name} is invalid.`);
  return value.trim();
}
function email(value, name = 'email') {
  const v = str(value, name, { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new HttpsError('invalid-argument', `${name} is invalid.`);
  return v;
}

// ---- custom claims ----------------------------------------------------------
async function mergeClaims(uid, patch) {
  const user = await auth().getUser(uid);
  const next = { ...(user.customClaims || {}), ...patch };
  for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
  await auth().setCustomUserClaims(uid, next);
  return next;
}

// ---- rate limiting (state lives under /function_state, never readable by clients) ----
async function hitLimiter(key, { max, windowMs }) {
  const r = db().ref(`function_state/limits/${key}`);
  const now = Date.now();
  const res = await r.transaction((cur) => {
    if (!cur || now - cur.start > windowMs) return { start: now, count: 1 };
    return { start: cur.start, count: cur.count + 1 };
  });
  return res.snapshot.val().count > max;
}
const clearLimiter = (key) => db().ref(`function_state/limits/${key}`).remove();

// ---- mail -------------------------------------------------------------------
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' },
  });
  return transporter;
}
async function sendMail({ to, subject, text }) {
  const t = getTransporter();
  if (t) {
    await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text });
    return;
  }
  if (IN_EMULATOR) {
    // Emulator only: capture the mail so developers/tests can read it. Never returned to the client.
    await db().ref('_dev_outbox').push({ to, subject, text, at: Date.now() });
    console.log(`[dev mail] to=${to} subject="${subject}"\n${text}`);
    return;
  }
  throw new HttpsError('failed-precondition', 'Email is not configured.');
}

module.exports = { admin, db, auth, HttpsError, requireAuth, requireRole, str, email, mergeClaims, hitLimiter, clearLimiter, sendMail, IN_EMULATOR };
