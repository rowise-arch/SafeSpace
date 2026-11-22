'use strict';
const crypto = require('node:crypto');
const { onCall } = require('firebase-functions/v2/https');
const { db, auth, HttpsError, requireRole, str, email, mergeClaims, hitLimiter, clearLimiter, sendMail } = require('./core');

const ROSTER = 'roster';
const INVITE_TTL_MS = 5 * 24 * 60 * 60 * 1000;
const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const GENERIC = 'No valid match found. Please check your details.';

/** Finds the roster entry matching all four details. Throws a generic error otherwise. */
async function matchRoster({ studentId, emailAddr, lastName, code }) {
  const limitKey = `activation_${sha(studentId)}`;
  if (await hitLimiter(limitKey, { max: 5, windowMs: 15 * 60 * 1000 })) {
    throw new HttpsError('resource-exhausted', 'Too many attempts. Try again later.');
  }
  const snap = await db().ref(ROSTER).orderByChild('student_id').equalTo(studentId).get();
  let hit = null;
  snap.forEach((child) => {
    const d = child.val() || {};
    if (
      String(d.email_address || '').toLowerCase() === emailAddr &&
      String(d.last_name || '').toLowerCase() === lastName.toLowerCase() &&
      d.activation_code && safeEq(d.activation_code, code)
    ) hit = { key: child.key, ...d };
  });
  if (!hit) throw new HttpsError('not-found', GENERIC);
  if (Number(hit.status) === 2) throw new HttpsError('already-exists', 'This account is already activated. Please sign in.');
  if (!hit.expiry_date || Date.now() > hit.expiry_date) throw new HttpsError('deadline-exceeded', 'Your activation code has expired.');
  await clearLimiter(limitKey);
  return hit;
}

const readActivation = (data) => ({
  studentId: str(data && data.studentId, 'studentId', { max: 40 }),
  emailAddr: email(data && data.email),
  lastName: str(data && data.lastName, 'lastName', { max: 80 }),
  code: str(data && data.code, 'code', { max: 40 }).toUpperCase(),
});

/** Step 1 (verify page): checks the activation details without creating anything. */
const checkStudentActivation = onCall(async (req) => {
  const hit = await matchRoster(readActivation(req.data));
  return { ok: true, firstName: hit.first_name || '' };
});

/** Step 2 (signup page): re-validates, creates the Auth user, sets the role claim and writes students/{uid}. */
const activateStudent = onCall(async (req) => {
  const d = req.data || {};
  const hit = await matchRoster(readActivation(d));
  const username = str(d.username, 'username', { max: 40 });
  const gender = str(d.gender, 'gender', { max: 30 });
  const password = str(d.password, 'password', { max: 128 });
  if (password.length < 8) throw new HttpsError('invalid-argument', 'Password must be at least 8 characters.');

  let user;
  try {
    user = await auth().createUser({ email: hit.email_address.toLowerCase(), password, displayName: username });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'An account with this email already exists.');
    throw new HttpsError('internal', 'Could not create the account.');
  }
  try {
    await mergeClaims(user.uid, { role: 'student' });
    const { key, activation_code, expiry_date, ...profile } = hit; // eslint-disable-line no-unused-vars
    await db().ref().update({
      [`students/${user.uid}`]: { ...profile, uid: user.uid, username, gender, status: 2, activated_at: Date.now() },
      [`${ROSTER}/${key}/status`]: 2,
      [`${ROSTER}/${key}/uid`]: user.uid,
      [`${ROSTER}/${key}/activation_code`]: null,
      [`${ROSTER}/${key}/expiry_date`]: 0,
    });
  } catch (e) {
    await auth().deleteUser(user.uid).catch(() => {});
    throw new HttpsError('internal', 'Could not finish activation. Please try again.');
  }
  return { ok: true, uid: user.uid };
});

const newCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
};

/** Admin: generate activation codes server-side and email them. Codes are never returned to the browser. */
const inviteStudents = onCall(async (req) => {
  requireRole(req, 'admin');
  const d = req.data || {};
  const resend = d.resend === true;
  const only = Array.isArray(d.ids) ? new Set(d.ids.map(String)) : null;
  const snap = await db().ref(ROSTER).get();
  const rows = snap.val() || {};
  let sent = 0;
  const failed = [];
  for (const [key, s] of Object.entries(rows)) {
    if (only && !only.has(key)) continue;
    const to = String((s && (s.email_address || s.Email_Address)) || '').trim();
    const status = Number(s && s.status);
    if (!to || status === 2 || (status === 1 && !resend)) continue;
    const code = newCode();
    try {
      await db().ref(`${ROSTER}/${key}`).update({ activation_code: code, expiry_date: Date.now() + INVITE_TTL_MS, status: 1 });
      await sendMail({
        to,
        subject: 'Activate your SafeSpace account',
        text: `Hello ${s.first_name || ''},\n\nYour SafeSpace activation code is ${code}. It is valid for 5 days.\nUse it with your student ID on the verification page.`,
      });
      sent++;
    } catch (e) {
      failed.push({ id: key, error: e.code || 'send-failed' });
    }
  }
  return { ok: true, sent, failed };
});

module.exports = { checkStudentActivation, activateStudent, inviteStudents };
