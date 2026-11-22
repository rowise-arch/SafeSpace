'use strict';
const crypto = require('node:crypto');
const { onCall } = require('firebase-functions/v2/https');
const { db, auth, HttpsError, requireAuth, str, mergeClaims, sendMail } = require('./core');

const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const SESSION_MS = 12 * 60 * 60 * 1000; // how long the twofa_until claim stays valid

const hash = (salt, code) => crypto.createHash('sha256').update(salt + ':' + code).digest('hex');

/** Signed-in (password) user asks for an emailed one-time code. */
const sendLoginCode = onCall(async (req) => {
  const uid = requireAuth(req);
  if (!req.auth.token.role) throw new HttpsError('permission-denied', 'Account has no role.');
  const user = await auth().getUser(uid);
  if (!user.email) throw new HttpsError('failed-precondition', 'Account has no email.');

  const ref = db().ref(`function_state/twofa/${uid}`);
  const prev = (await ref.get()).val();
  const now = Date.now();
  if (prev && now - prev.sentAt < RESEND_MS) {
    throw new HttpsError('resource-exhausted', 'Please wait before requesting another code.');
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const salt = crypto.randomBytes(16).toString('hex');
  await ref.set({ hash: hash(salt, code), salt, expiresAt: now + CODE_TTL_MS, attempts: 0, sentAt: now });
  await sendMail({
    to: user.email,
    subject: 'Your SafeSpace verification code',
    text: `Your verification code is ${code}. It expires in 5 minutes. If you did not try to sign in, change your password.`,
  });
  return { ok: true, expiresInSeconds: CODE_TTL_MS / 1000 };
});

/** Verifies the code, then stamps a short-lived `twofa_until` custom claim. Client must refresh its ID token. */
const verifyLoginCode = onCall(async (req) => {
  const uid = requireAuth(req);
  const code = str(req.data && req.data.code, 'code', { max: 12 });
  const ref = db().ref(`function_state/twofa/${uid}`);

  // Count the attempt atomically *before* comparing, so parallel guesses cannot beat the limit.
  const tx = await ref.transaction((cur) => {
    if (cur === null) return null; // first pass sees no cached value; returning null forces the server's real value to be fetched
    if (!cur) return;
    if (cur.attempts >= MAX_ATTEMPTS) return; // abort: locked
    return { ...cur, attempts: cur.attempts + 1 };
  });
  const state = tx.snapshot.val();
  if (!state) throw new HttpsError('failed-precondition', 'No code requested.');
  if (!tx.committed) {
    await ref.remove();
    throw new HttpsError('resource-exhausted', 'Too many attempts. Request a new code.');
  }
  if (Date.now() > state.expiresAt) {
    await ref.remove();
    throw new HttpsError('deadline-exceeded', 'Code expired. Request a new one.');
  }
  const a = Buffer.from(hash(state.salt, code), 'hex');
  const b = Buffer.from(state.hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpsError('invalid-argument', 'Incorrect code.');
  }
  await ref.remove();
  const twofaUntil = Date.now() + SESSION_MS;
  await mergeClaims(uid, { twofa_until: twofaUntil });
  return { ok: true, twofaUntil };
});

module.exports = { sendLoginCode, verifyLoginCode };
