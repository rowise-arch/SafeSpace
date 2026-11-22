import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
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

// ---------------------------------------------------------------- admin functions
test('admin functions reject non-admins', async () => {
  const { email } = await makeUser('student');
  await signIn(email);
  for (const [fn, data] of [['createCounselor', { email_address: 'a@b.co', first_name: 'A', last_name: 'B' }],
    ['setCounselorAccess', { uid: 'x', enabled: false }], ['deleteCounselor', { uid: 'x' }], ['inviteStudents', {}]]) {
    assert.equal(await code(call(fn, data)), 'functions/permission-denied', fn);
  }
  await signOut(cauth);
});

test('admin: create, disable and delete a counselor', async () => {
  const { email } = await makeUser('admin');
  await signIn(email);
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

test('admin: inviteStudents emails codes server-side and never returns them', async () => {
  const { email } = await makeUser('admin');
  await signIn(email);
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
