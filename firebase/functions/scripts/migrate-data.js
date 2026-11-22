'use strict';
// One-off data migration to the new data model (see docs/data-model.md). Idempotent; DRY RUN by default.
//
//   node scripts/migrate-data.js [--apply] [--backup <file.json>]
//
//   students/{oldKey} with a uid      -> students/{uid}      (psych_tests/{oldKey} follows to psych_tests/{uid})
//   students/{oldKey} without a uid   -> roster/{oldKey}     (pre-registered, not activated yet; invitations come from here)
//   counselors/{oldKey} with a uid    -> counselors/{uid}    (old id kept in counselor_id)
//   role claims                       -> student / counselor / admin   (same rules as backfill-claims.js)
//   mfa_required claim                -> students whose record says email2FA === true
//   leftovers                         -> 2FA codes / secrets and activation codes of activated students are deleted
//
// Before --apply the nodes it touches are saved to a backup file. Nothing is deleted without being copied first, and
// every record moves in one atomic multi-path update. A record whose target already exists is reported and skipped.
//
// Production: set GOOGLE_APPLICATION_CREDENTIALS, GCLOUD_PROJECT and DATABASE_URL. Emulator: set the *_EMULATOR_HOST variables.
const fs = require('node:fs');
const admin = require('firebase-admin');

const apply = process.argv.includes('--apply');
const bIdx = process.argv.indexOf('--backup');
const backupFile = bIdx > 0 ? process.argv[bIdx + 1] : `migration-backup-${Date.now()}.json`;

const project = process.env.GCLOUD_PROJECT || 'demo-safespace';
const databaseURL = process.env.FIREBASE_DATABASE_EMULATOR_HOST
  ? `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${project}-default-rtdb`
  : process.env.DATABASE_URL;
admin.initializeApp({ projectId: project, databaseURL });

const SECRET_FIELD = /^(temp2FA|email2FACode|totp|otp|mfaSecret)/i;
const tally = {};
const bump = (k) => { tally[k] = (tally[k] || 0) + 1; };
const say = (verb, msg) => console.log(`${apply ? verb : `would ${verb}`}`.padEnd(14) + msg);

async function setClaims(uid, label, patch) {
  let user;
  try { user = await admin.auth().getUser(uid); } catch (e) { console.log(`skip          ${label}: no Auth user for uid ${uid}`); bump('claims_no_auth_user'); return; }
  const claims = user.customClaims || {};
  if (patch.role && claims.role && claims.role !== patch.role) { console.log(`CONFLICT      ${label}: has role=${claims.role}, wanted ${patch.role}`); bump('claims_conflict'); return; }
  const next = { ...claims, ...patch };
  if (JSON.stringify(next) === JSON.stringify(claims)) { bump('claims_same'); return; }
  if (apply) await admin.auth().setCustomUserClaims(uid, next);
  say('set', `${label}: ${JSON.stringify(patch)} (${user.email})`);
  bump('claims_set');
}

function cleanStudent(rec) {
  const out = { ...rec };
  let removed = 0;
  for (const k of Object.keys(out)) {
    if (SECRET_FIELD.test(k)) { delete out[k]; removed++; }
  }
  if (out.uid && Number(out.status) === 2 && out.activation_code !== undefined) { delete out.activation_code; removed++; }
  if (removed) bump('secret_fields_removed');
  return out;
}

(async () => {
  const db = admin.database();
  const [students, counselors, psych, admins, roster] = await Promise.all(
    ['students', 'counselors', 'psych_tests', 'admins', 'roster'].map(async (p) => (await db.ref(p).get()).val() || {}));

  const moves = [];     // [description, one atomic multi-path update]

  for (const [key, s] of Object.entries(students)) {
    if (!s || typeof s !== 'object') continue;
    const cleaned = cleanStudent(s);
    if (s.uid && key === s.uid) {                                    // already in the new shape
      if (JSON.stringify(cleaned) !== JSON.stringify(s)) moves.push([`clean   students/${key}`, { [`students/${key}`]: cleaned }]);
      bump('students_ok');
    } else if (s.uid) {                                              // activated, old key
      if (students[s.uid]) { console.log(`CONFLICT      students/${key}: students/${s.uid} already exists, left alone`); bump('conflicts'); continue; }
      const u = { [`students/${s.uid}`]: { ...cleaned, student_id: cleaned.student_id || key }, [`students/${key}`]: null };
      if (psych[key] && !psych[s.uid]) { u[`psych_tests/${s.uid}`] = psych[key]; u[`psych_tests/${key}`] = null; }
      moves.push([`move    students/${key} -> students/${s.uid}${u[`psych_tests/${s.uid}`] ? ' (+ psych_tests)' : ''}`, u]);
      bump('students_moved');
    } else {                                                         // pre-registered, never activated
      if (roster[key]) { console.log(`CONFLICT      students/${key}: roster/${key} already exists, left alone`); bump('conflicts'); continue; }
      moves.push([`move    students/${key} -> roster/${key} (not activated)`, { [`roster/${key}`]: { ...cleaned, student_id: cleaned.student_id || key }, [`students/${key}`]: null }]);
      bump('students_to_roster');
    }
  }

  for (const [key, c] of Object.entries(counselors)) {
    if (!c || typeof c !== 'object') continue;
    if (!c.uid) { console.log(`skip          counselors/${key}: no uid (never got a login account)`); bump('counselors_no_uid'); continue; }
    if (key === c.uid) { bump('counselors_ok'); continue; }
    if (counselors[c.uid]) { console.log(`CONFLICT      counselors/${key}: counselors/${c.uid} already exists, left alone`); bump('conflicts'); continue; }
    moves.push([`move    counselors/${key} -> counselors/${c.uid}`, { [`counselors/${c.uid}`]: { ...c, counselor_id: c.counselor_id || key }, [`counselors/${key}`]: null }]);
    bump('counselors_moved');
  }

  if (apply && moves.length) {
    const touched = {};
    for (const [, u] of moves) for (const path of Object.keys(u)) { const [top, k] = path.split('/'); touched[`${top}/${k}`] = true; }
    const backup = {};
    for (const path of Object.keys(touched)) backup[path] = (await db.ref(path).get()).val();
    fs.writeFileSync(backupFile, JSON.stringify({ at: new Date().toISOString(), project, nodes: backup }, null, 1));
    console.log(`Backup of ${Object.keys(backup).length} nodes written to ${backupFile}`);
  }
  for (const [desc, u] of moves) {
    if (apply) await db.ref().update(u);
    say(desc.split(/\s+/)[0], desc.replace(/^\S+\s+/, ''));
  }

  // Claims (use the uid from the records, wherever they live now)
  for (const [key, c] of Object.entries(counselors)) if (c && c.uid) await setClaims(c.uid, `counselors/${key}`, { role: 'counselor' });
  for (const uid of Object.keys(admins)) await setClaims(uid, `admins/${uid}`, { role: 'admin' });
  for (const [key, s] of Object.entries(students)) {
    if (!s || !s.uid) continue;
    await setClaims(s.uid, `students/${key}`, s.email2FA === true ? { role: 'student', mfa_required: true } : { role: 'student' });
  }

  console.log(apply ? 'Applied.' : 'Dry run only - re-run with --apply.', tally);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
