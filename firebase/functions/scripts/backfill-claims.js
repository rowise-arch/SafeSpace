'use strict';
// One-off migration: give existing accounts their `role` custom claim.
//   counselors/*  (with a uid)  -> counselor
//   admins/*                    -> admin
//   students/*    (with a uid)  -> student
// Dry run by default. Usage: node scripts/backfill-claims.js [--apply]
// Production: set GOOGLE_APPLICATION_CREDENTIALS and DATABASE_URL. Emulator: set the *_EMULATOR_HOST variables.
const admin = require('firebase-admin');
const apply = process.argv.includes('--apply');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, databaseURL: process.env.DATABASE_URL });

async function setRole(uid, role, label) {
  let user;
  try { user = await admin.auth().getUser(uid); } catch (e) { console.log(`skip   ${label}: no auth user for uid ${uid}`); return 'missing'; }
  const claims = user.customClaims || {};
  if (claims.role === role) return 'same';
  if (claims.role && claims.role !== role) { console.log(`CONFLICT ${label}: already has role=${claims.role}, wanted ${role}`); return 'conflict'; }
  if (apply) await admin.auth().setCustomUserClaims(uid, { ...claims, role });
  console.log(`${apply ? 'set   ' : 'would '} ${label}: role=${role} (${user.email})`);
  return 'set';
}

(async () => {
  const db = admin.database();
  const tally = {};
  const bump = (k) => { tally[k] = (tally[k] || 0) + 1; };
  const counselors = (await db.ref('counselors').get()).val() || {};
  for (const [key, c] of Object.entries(counselors)) if (c && c.uid) bump(await setRole(c.uid, 'counselor', `counselors/${key}`));
  const admins = (await db.ref('admins').get()).val() || {};
  for (const uid of Object.keys(admins)) bump(await setRole(uid, 'admin', `admins/${uid}`));
  const students = (await db.ref('students').get()).val() || {};
  for (const [key, s] of Object.entries(students)) if (s && s.uid) bump(await setRole(s.uid, 'student', `students/${key}`));
  console.log(apply ? 'Applied.' : 'Dry run only - re-run with --apply.', tally);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
