'use strict';
const crypto = require('node:crypto');
const { onCall } = require('firebase-functions/v2/https');
const { db, auth, HttpsError, requireRole, str, email, mergeClaims, sendMail } = require('./core');

async function nextCounselorId() {
  const snap = await db().ref('counselors').get();
  let max = 0;
  snap.forEach((c) => {
    const n = parseInt((c.val() || {}).counselor_id, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  });
  return String(max + 1).padStart(3, '0');
}

/** Admin: creates the login account (claim role=counselor) and counselors/{uid}; emails a set-password link. */
const createCounselor = onCall(async (req) => {
  requireRole(req, 'admin');
  const d = req.data || {};
  const emailAddr = email(d.email_address, 'email_address');
  const first_name = str(d.first_name, 'first_name', { max: 80 });
  const last_name = str(d.last_name, 'last_name', { max: 80 });

  let user;
  try {
    // Random throwaway password: the counselor sets their own via the emailed link.
    user = await auth().createUser({
      email: emailAddr,
      password: crypto.randomBytes(24).toString('base64url'),
      displayName: `${first_name} ${last_name}`.trim(),
    });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'An account with this email already exists.');
    throw new HttpsError('internal', 'Could not create the account.');
  }
  try {
    await mergeClaims(user.uid, { role: 'counselor' });
    const counselor_id = await nextCounselorId();
    await db().ref(`counselors/${user.uid}`).set({
      counselor_id, uid: user.uid, email_address: emailAddr, first_name, last_name,
      username: str(d.username, 'username', { max: 60, required: false }),
      specialization: str(d.specialization, 'specialization', { max: 120, required: false }),
      department: str(d.department, 'department', { max: 120, required: false }),
      college: str(d.college, 'college', { max: 120, required: false }),
      campus: str(d.campus, 'campus', { max: 120, required: false }),
      photo_url: str(d.photo_url, 'photo_url', { max: 2000, required: false }),
      status: 'Active', login: 'Enable', login_access: true, created_at: new Date().toISOString(),
    });
    const link = await auth().generatePasswordResetLink(emailAddr);
    await sendMail({
      to: emailAddr,
      subject: 'Your SafeSpace counselor account',
      text: `Hello ${first_name},\n\nAn administrator created a SafeSpace counselor account for you.\nSet your password here: ${link}\n`,
    });
    return { ok: true, uid: user.uid, counselor_id };
  } catch (e) {
    await auth().deleteUser(user.uid).catch(() => {});
    await db().ref(`counselors/${user.uid}`).remove().catch(() => {});
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('internal', 'Could not finish creating the counselor.');
  }
});

/** Admin: enable/disable a counselor. Disabling is enforced by Auth itself, not just a database flag. */
const setCounselorAccess = onCall(async (req) => {
  requireRole(req, 'admin');
  const uid = str(req.data && req.data.uid, 'uid', { max: 128 });
  const enabled = !!(req.data && req.data.enabled);
  const exists = (await db().ref(`counselors/${uid}`).get()).exists();
  if (!exists) throw new HttpsError('not-found', 'Counselor not found.');
  await auth().updateUser(uid, { disabled: !enabled });
  if (!enabled) await auth().revokeRefreshTokens(uid);
  await db().ref(`counselors/${uid}`).update({ login: enabled ? 'Enable' : 'Disable', login_access: enabled });
  return { ok: true };
});

/** Admin: remove a counselor's login and profile. */
const deleteCounselor = onCall(async (req) => {
  requireRole(req, 'admin');
  const uid = str(req.data && req.data.uid, 'uid', { max: 128 });
  if (!(await db().ref(`counselors/${uid}`).get()).exists()) throw new HttpsError('not-found', 'Counselor not found.');
  await auth().deleteUser(uid).catch((e) => { if (e.code !== 'auth/user-not-found') throw e; });
  await db().ref(`counselors/${uid}`).remove();
  return { ok: true };
});

module.exports = { createCounselor, setCounselorAccess, deleteCounselor };
