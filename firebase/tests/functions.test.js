import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';

// firebase-admin lives in functions/node_modules
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');

const PROJECT = 'demo-safespace';
const adminApp = admin.initializeApp({ projectId: PROJECT, databaseURL: `https://${PROJECT}-default-rtdb.firebaseio.com` }, 'test-admin');
const adb = adminApp.database();
const aauth = adminApp.auth();

const clientApp = initializeApp({ projectId: PROJECT, apiKey: 'fake-api-key' }, 'test-client');
const cauth = getAuth(clientApp);
connectAuthEmulator(cauth, 'http://127.0.0.1:9099', { disableWarnings: true });
const fns = getFunctions(clientApp, 'asia-southeast1');
connectFunctionsEmulator(fns, '127.0.0.1', 5001);
const call = (name, data) => httpsCallable(fns, name)(data).then((r) => r.data);
const code = async (p) => { try { await p; } catch (e) { return e.code; } return 'NO-ERROR'; };

const PW = 'Sup3r-secret!';
let n = 0;
async function makeUser(role, extra = {}) {
  const email = `${role}${++n}-${Date.now()}@example.com`;
  const u = await aauth.createUser({ email, password: PW });
  await aauth.setCustomUserClaims(u.uid, { role, ...extra });
  return { uid: u.uid, email };
}
async function signIn(email) {
  const cred = await signInWithEmailAndPassword(cauth, email, PW);
  await cred.user.getIdToken(true);
  return cred.user;
}
// Test shortcut for the 2FA step: stamps THIS sign-in (the real code flow is covered by its own test)
async function signInAdmin(email, uid) {
  const user = await signIn(email);
  const { claims } = await user.getIdTokenResult();
  await aauth.setCustomUserClaims(uid, { role: 'admin', twofa_until: Date.now() + 3600e3, twofa_auth_time: claims.auth_time });
  await user.getIdToken(true);
  return user;
}
async function lastMail(to) {
  const snap = await adb.ref('_dev_outbox').get(); // small in tests; avoids needing an index
  const all = Object.values(snap.val() || {}).filter((m) => m.to === to).sort((a, b) => a.at - b.at);
  return all[all.length - 1];
}
const extractCode = (text) => text.match(/\b(\d{6})\b/)[1];

before(async () => { await adb.ref('_dev_outbox').remove(); });
after(async () => { await deleteApp(clientApp); await adminApp.delete(); });

// ---------------------------------------------------------------- 2FA
test('2FA: code is emailed (never returned), verifies once, stamps the claim', async () => {
  const { email } = await makeUser('counselor');
  const user = await signIn(email);
  const res = await call('sendLoginCode', {});
  assert.deepEqual(Object.keys(res).sort(), ['expiresInSeconds', 'ok']);
  const mail = await lastMail(email);
  const good = extractCode(mail.text);

  assert.equal(await code(call('verifyLoginCode', { code: good === '000000' ? '111111' : '000000' })), 'functions/invalid-argument');
  const ok = await call('verifyLoginCode', { code: good });
  assert.equal(ok.ok, true);
  const tok = await user.getIdTokenResult(true);
  assert.ok(tok.claims.twofa_until > Date.now());
  assert.equal(tok.claims.role, 'counselor', 'role claim must survive the merge');
  assert.equal(tok.claims.twofa_auth_time, tok.claims.auth_time, 'stamp is bound to this sign-in');
  // a later password sign-in has a new auth_time, so the old stamp no longer matches
  await signOut(cauth);
  await new Promise((r) => setTimeout(r, 1200));
  const again = await signIn(email);
  const tok2 = (await again.getIdTokenResult(true)).claims;
  assert.ok(tok2.auth_time > tok.claims.auth_time);
  assert.notEqual(tok2.twofa_auth_time, tok2.auth_time, 'a fresh sign-in must require 2FA again');
  // single use
  assert.equal(await code(call('verifyLoginCode', { code: good })), 'functions/failed-precondition');
  await signOut(cauth);
});

test('2FA: resend is throttled and codes lock after 5 wrong attempts', async () => {
  const { email } = await makeUser('student');
  await signIn(email);
  await call('sendLoginCode', {});
  assert.equal(await code(call('sendLoginCode', {})), 'functions/resource-exhausted');
  const good = extractCode((await lastMail(email)).text);
  const wrong = good === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) assert.equal(await code(call('verifyLoginCode', { code: wrong })), 'functions/invalid-argument');
  // even the right code is refused once locked
  assert.equal(await code(call('verifyLoginCode', { code: good })), 'functions/resource-exhausted');
  await signOut(cauth);
});

test('2FA: requires sign-in and a role', async () => {
  assert.equal(await code(call('sendLoginCode', {})), 'functions/unauthenticated');
  const u = await aauth.createUser({ email: `norole${Date.now()}@example.com`, password: PW });
  await signIn(u.email);
  assert.equal(await code(call('sendLoginCode', {})), 'functions/permission-denied');
  await signOut(cauth);
});

// ---------------------------------------------------------------- student activation
async function seedRoster(over = {}) {
  const sid = `2026-${Math.floor(Math.random() * 1e6)}`;
  const emailAddr = `s${sid}@example.com`;
  const ref = adb.ref('roster').push();
  await ref.set({ student_id: sid, email_address: emailAddr, first_name: 'Ana', last_name: 'Reyes', status: 1,
    activation_code: 'ABCD2345', expiry_date: Date.now() + 86400000, ...over });
  return { sid, emailAddr, key: ref.key };
}

test('activation: wrong details give one generic error and are rate limited', async () => {
  const { sid, emailAddr } = await seedRoster();
  const bad = { studentId: sid, email: emailAddr, lastName: 'Reyes', code: 'WRONG123' };
  for (let i = 0; i < 5; i++) assert.equal(await code(call('checkStudentActivation', bad)), 'functions/not-found');
  // 6th attempt is blocked even with the right code
  assert.equal(await code(call('checkStudentActivation', { ...bad, code: 'ABCD2345' })), 'functions/resource-exhausted');
});

test('activation: expired code is rejected', async () => {
  const { sid, emailAddr } = await seedRoster({ expiry_date: Date.now() - 1000 });
  assert.equal(await code(call('checkStudentActivation', { studentId: sid, email: emailAddr, lastName: 'Reyes', code: 'ABCD2345' })), 'functions/deadline-exceeded');
});

test('activation: success creates the account, claim and students/{uid}; cannot be reused', async () => {
  const { sid, emailAddr, key } = await seedRoster();
  const d = { studentId: sid, email: emailAddr, lastName: 'reyes', code: 'abcd2345' };
  assert.deepEqual(await call('checkStudentActivation', d), { ok: true, firstName: 'Ana' });
  assert.equal(await code(call('activateStudent', { ...d, username: 'ana', gender: 'F', password: 'short' })), 'functions/invalid-argument');
  const res = await call('activateStudent', { ...d, username: 'ana', gender: 'F', password: PW });
  const rec = (await adb.ref(`students/${res.uid}`).get()).val();
  assert.equal(rec.uid, res.uid);
  assert.equal(rec.status, 2);
  assert.equal(rec.activation_code, undefined, 'activation code must not be copied to the student profile');
  assert.equal((await aauth.getUser(res.uid)).customClaims.role, 'student');
  const roster = (await adb.ref(`roster/${key}`).get()).val();
  assert.equal(roster.status, 2);
  assert.equal(roster.activation_code, undefined);
  // the code is wiped on success, so reuse is indistinguishable from a wrong code (nothing leaks)
  assert.equal(await code(call('activateStudent', { ...d, username: 'x', gender: 'F', password: PW })), 'functions/not-found');
  await signIn(emailAddr); // the new password works
  await signOut(cauth);
});

// ---------------------------------------------------------------- student 2FA preference
test('student 2FA: needs a code first, then becomes a claim that re-applies on every new sign-in', async () => {
  const { uid, email } = await makeUser('student');
  await adb.ref(`students/${uid}`).set({ uid, first_name: 'T' });
  const user = await signIn(email);
  assert.equal(await code(call('setTwoFactor', { enabled: true })), 'functions/permission-denied');
  await call('sendLoginCode', {});
  await call('verifyLoginCode', { code: extractCode((await lastMail(email)).text) });
  await user.getIdToken(true);
  assert.deepEqual(await call('setTwoFactor', { enabled: true }), { ok: true, enabled: true });
  const claims = (await user.getIdTokenResult(true)).claims;
  assert.equal(claims.mfa_required, true);
  assert.equal(claims.role, 'student');
  assert.equal((await adb.ref(`students/${uid}/email2FA`).get()).val(), true);
  // a later sign-in has no stamp but still carries mfa_required, so the rules will demand a code
  await signOut(cauth);
  await new Promise((r) => setTimeout(r, 1200));
  const again = await signIn(email);
  const c2 = (await again.getIdTokenResult(true)).claims;
  assert.equal(c2.mfa_required, true);
  assert.notEqual(c2.twofa_auth_time, c2.auth_time);
  // switching it off also needs a stamp for this sign-in
  assert.equal(await code(call('setTwoFactor', { enabled: false })), 'functions/permission-denied');
  await signOut(cauth);
});

test('admin: disable and re-enable a student', async () => {
  const stu = await makeUser('student');
  await adb.ref(`students/${stu.uid}`).set({ uid: stu.uid, login: 'Enable' });
  const { email, uid: adminUid } = await makeUser('admin');
  await signIn(stu.email);
  assert.equal(await code(call('setStudentAccess', { uid: stu.uid, enabled: false })), 'functions/permission-denied');
  await signOut(cauth);
  await signInAdmin(email, adminUid);
  await call('setStudentAccess', { uid: stu.uid, enabled: false });
  assert.equal((await aauth.getUser(stu.uid)).disabled, true);
  assert.equal((await adb.ref(`students/${stu.uid}/login`).get()).val(), 'Disable');
  await signOut(cauth);
  assert.equal(await signInWithEmailAndPassword(cauth, stu.email, PW).then(() => 'signed-in', (e) => e.code), 'auth/user-disabled');
  await signInAdmin(email, adminUid);
  await call('setStudentAccess', { uid: stu.uid, enabled: true });
  assert.equal((await aauth.getUser(stu.uid)).disabled, false);
  assert.equal(await code(call('setStudentAccess', { uid: 'nobody', enabled: true })), 'functions/not-found');
  await signOut(cauth);
});

// ---------------------------------------------------------------- admin functions
test('admin functions reject non-admins', async () => {
  const { email } = await makeUser('student');
  await signIn(email);
  for (const [fn, data] of [['createCounselor', { email_address: 'a@b.co', first_name: 'A', last_name: 'B' }],
    ['setCounselorAccess', { uid: 'x', enabled: false }], ['deleteCounselor', { uid: 'x' }], ['inviteStudents', {}],
    ['setStudentAccess', { uid: 'x', enabled: false }]]) {
    assert.equal(await code(call(fn, data)), 'functions/permission-denied', fn);
  }
  await signOut(cauth);
});

test('admin: create, disable and delete a counselor', async () => {
  const { email, uid: adminUid } = await makeUser('admin');
  await signInAdmin(email, adminUid);
  const target = `new.counselor${Date.now()}@example.com`;
  const res = await call('createCounselor', { email_address: target, first_name: 'Maria', last_name: 'Cruz', specialization: 'Anxiety' });
  assert.equal(res.password, undefined, 'no password may be returned to the browser');
  const rec = (await adb.ref(`counselors/${res.uid}`).get()).val();
  assert.equal(rec.uid, res.uid);
  assert.equal(rec.login_access, true);
  assert.equal((await aauth.getUser(res.uid)).customClaims.role, 'counselor');
  assert.match((await lastMail(target)).text, /Set your password here: http/);
  assert.equal(await code(call('createCounselor', { email_address: target, first_name: 'M', last_name: 'C' })), 'functions/already-exists');

  await call('setCounselorAccess', { uid: res.uid, enabled: false });
  assert.equal((await aauth.getUser(res.uid)).disabled, true);
  assert.equal((await adb.ref(`counselors/${res.uid}/login`).get()).val(), 'Disable');
  await call('setCounselorAccess', { uid: res.uid, enabled: true });
  assert.equal((await aauth.getUser(res.uid)).disabled, false);

  await call('deleteCounselor', { uid: res.uid });
  assert.equal((await adb.ref(`counselors/${res.uid}`).get()).exists(), false);
  assert.equal(await aauth.getUser(res.uid).then(() => 'exists', (e) => e.code), 'auth/user-not-found');
  await signOut(cauth);
});

test('admin functions also find records keyed by the old ids (uid stored in the record)', async () => {
  const { email, uid: adminUid } = await makeUser('admin');
  await signInAdmin(email, adminUid);
  const stu = await makeUser('student');
  const cou = await makeUser('counselor');
  await adb.ref('students/2024-0001').set({ uid: stu.uid, login: 'Enable' });
  await adb.ref('counselors/007').set({ uid: cou.uid, login: 'Enable', login_access: true });
  await call('setStudentAccess', { uid: stu.uid, enabled: false });
  assert.equal((await adb.ref('students/2024-0001/login').get()).val(), 'Disable');
  assert.equal((await adb.ref(`students/${stu.uid}`).get()).exists(), false, 'no stray node under the uid');
  await call('setCounselorAccess', { uid: cou.uid, enabled: false });
  assert.equal((await adb.ref('counselors/007/login_access').get()).val(), false);
  await call('deleteCounselor', { uid: cou.uid });
  assert.equal((await adb.ref('counselors/007').get()).exists(), false);
  await adb.ref('students/2024-0001').remove();
  await signOut(cauth);
});

test('admin: deleteStudent removes login, profile, tests and roster link but keeps clinical records', async () => {
  const { email, uid: adminUid } = await makeUser('admin');
  const stu = await makeUser('student');
  const other = await makeUser('student');
  await adb.ref().update({
    'students/2024-DEL': { uid: stu.uid, first_name: 'Gone' },
    'psych_tests/2024-DEL/t1': { title: 'x' },
    'roster/2024-DEL': { student_id: '2024-DEL', uid: stu.uid, status: 2 },
    [`appointments_by_student/${stu.uid}/a1`]: { status: 'completed' },
    [`Session_report/${stu.uid}/case1/meta`]: { x: 1 },
  });
  await signIn(stu.email);
  assert.equal(await code(call('deleteStudent', { uid: stu.uid })), 'functions/permission-denied');
  await signOut(cauth);
  await signInAdmin(email, adminUid);
  assert.equal(await code(call('deleteStudent', { uid: 'nobody' })), 'functions/not-found');
  await call('deleteStudent', { uid: stu.uid });
  assert.equal(await aauth.getUser(stu.uid).then(() => 'exists', (e) => e.code), 'auth/user-not-found');
  for (const path of ['students/2024-DEL', 'psych_tests/2024-DEL', 'roster/2024-DEL']) assert.equal((await adb.ref(path).get()).exists(), false, path);
  assert.equal((await adb.ref(`appointments_by_student/${stu.uid}/a1`).get()).exists(), true);
  assert.equal((await adb.ref(`Session_report/${stu.uid}/case1`).get()).exists(), true);
  assert.equal((await aauth.getUser(other.uid)).uid, other.uid, 'other accounts untouched');
  await signOut(cauth);
});

test('admin: inviteStudents emails codes server-side and never returns them', async () => {
  const { email, uid: adminUid } = await makeUser('admin');
  await signInAdmin(email, adminUid);
  const emailAddr = `invite${Date.now()}@example.com`;
  const ref = adb.ref('roster').push();
  await ref.set({ student_id: `I-${Date.now()}`, email_address: emailAddr, first_name: 'Joy', last_name: 'Lim' });
  const res = await call('inviteStudents', { ids: [ref.key] });
  assert.equal(res.sent, 1);
  assert.ok(!JSON.stringify(res).match(/[A-Z2-9]{8}/), 'response must not contain the code');
  const row = (await ref.get()).val();
  assert.equal(row.status, 1);
  assert.match(row.activation_code, /^[A-Z2-9]{8}$/);
  assert.ok(row.expiry_date > Date.now());
  assert.ok((await lastMail(emailAddr)).text.includes(row.activation_code));
  // already invited -> skipped unless resend
  assert.equal((await call('inviteStudents', { ids: [ref.key] })).sent, 0);
  assert.equal((await call('inviteStudents', { ids: [ref.key], resend: true })).sent, 1);
  await signOut(cauth);
});

test('admin: functions need a 2FA code for this sign-in', async () => {
  const { email, uid } = await makeUser('admin');
  const stu = await makeUser('student');
  await adb.ref(`students/${stu.uid}`).set({ uid: stu.uid, login: 'Enable' });
  await signIn(email);
  assert.equal(await code(call('setStudentAccess', { uid: stu.uid, enabled: false })), 'functions/permission-denied');
  // real flow: emailed code -> stamp for this sign-in
  await call('sendLoginCode', {});
  await call('verifyLoginCode', { code: extractCode((await lastMail(email)).text) });
  await cauth.currentUser.getIdToken(true);
  assert.deepEqual(await call('setStudentAccess', { uid: stu.uid, enabled: true }), { ok: true });
  await signOut(cauth);
  // a fresh sign-in is not stamped any more (auth_time has 1 s resolution, so let the clock tick)
  await new Promise((r) => setTimeout(r, 1200));
  await signIn(email);
  assert.equal(await code(call('setStudentAccess', { uid: stu.uid, enabled: false })), 'functions/permission-denied');
  await signOut(cauth);
  assert.ok(uid);
});

// ---------------------------------------------------------------- data migration script
test('migrate-data: dry run changes nothing; apply re-keys, cleans, sets claims, backs up; second run is a no-op', async () => {
  const script = new URL('../functions/scripts/migrate-data.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const backup = join(tmpdir(), `migration-backup-test-${Date.now()}.json`);
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: process.env });
  const mk = async (email) => (await aauth.createUser({ email, password: PW })).uid;
  const k = Date.now();
  const stuA = await mk(`mig.a${k}@example.com`), stuB = await mk(`mig.b${k}@example.com`), cou = await mk(`mig.c${k}@example.com`), taken = await mk(`mig.t${k}@example.com`);
  await adb.ref().update({
    [`students/OLD-${k}A`]: { uid: stuA, first_name: 'Ana', status: 2, activation_code: 'LEFTOVER', temp2FACode: '123456', email2FACodeExpiry: 1 },
    [`students/OLD-${k}B`]: { uid: stuB, first_name: 'Ben', status: 2, email2FA: true },
    [`students/PRE-${k}`]: { student_id: `PRE-${k}`, email_address: 'pre@example.com', status: 1, activation_code: 'ABCD2345', expiry_date: 1 },
    [`counselors/C-${k}`]: { uid: cou, first_name: 'Cora', login: 'Enable' },
    [`psych_tests/OLD-${k}A/t1`]: { title: 'Test' },
    [`students/OLD-${k}T`]: { uid: taken, first_name: 'Dup' },
    [`students/${taken}`]: { uid: taken, first_name: 'Already new' },
  });

  const dry = run();
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run only/);
  assert.equal((await adb.ref(`students/OLD-${k}A`).get()).exists(), true, 'dry run must not move anything');
  assert.equal((await adb.ref(`students/${stuA}`).get()).exists(), false);
  assert.equal((await aauth.getUser(stuA)).customClaims, undefined, 'dry run must not set claims');

  const res = run('--apply', '--backup', backup);
  assert.equal(res.status, 0, res.stderr + res.stdout);
  const a = (await adb.ref(`students/${stuA}`).get()).val();
  assert.equal(a.student_id, `OLD-${k}A`);
  assert.equal(a.activation_code, undefined);
  assert.equal(a.temp2FACode, undefined);
  assert.equal(a.email2FACodeExpiry, undefined);
  assert.equal((await adb.ref(`students/OLD-${k}A`).get()).exists(), false);
  assert.equal((await adb.ref(`psych_tests/${stuA}/t1/title`).get()).val(), 'Test');
  assert.equal((await adb.ref(`psych_tests/OLD-${k}A`).get()).exists(), false);
  const pre = (await adb.ref(`roster/PRE-${k}`).get()).val();
  assert.equal(pre.activation_code, 'ABCD2345', 'invitations in flight keep their code');
  assert.equal((await adb.ref(`students/PRE-${k}`).get()).exists(), false);
  const c = (await adb.ref(`counselors/${cou}`).get()).val();
  assert.equal(c.counselor_id, `C-${k}`);
  assert.equal((await adb.ref(`counselors/C-${k}`).get()).exists(), false);
  assert.equal((await adb.ref(`students/OLD-${k}T`).get()).exists(), true, 'conflicting record is left alone');
  assert.equal((await adb.ref(`students/${taken}/first_name`).get()).val(), 'Already new');
  assert.deepEqual((await aauth.getUser(stuA)).customClaims, { role: 'student' });
  assert.deepEqual((await aauth.getUser(stuB)).customClaims, { role: 'student', mfa_required: true });
  assert.deepEqual((await aauth.getUser(cou)).customClaims, { role: 'counselor' });
  assert.equal(existsSync(backup), true);
  assert.equal(JSON.parse(readFileSync(backup, 'utf8')).nodes[`students/OLD-${k}A`].temp2FACode, '123456', 'backup holds the original record');
  rmSync(backup);

  const again = run('--apply', '--backup', backup);
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.stdout, /students_moved|students_to_roster|counselors_moved/);
  assert.equal(existsSync(backup), false, 'nothing to move, so no backup is written');
  assert.equal((await adb.ref(`students/${stuA}/student_id`).get()).val(), `OLD-${k}A`);
});
