import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, get, set, update, query, orderByChild, equalTo } from 'firebase/database';

let env;
// counselors also need the server-issued 2FA stamp (see functions/src/twofa.js)
const as = (uid, role, extra = {}) =>
  env.authenticatedContext(uid, role ? { role, auth_time: 1700000000, ...(role === 'counselor' ? { twofa_until: Date.now() + 3600e3, twofa_auth_time: 1700000000 } : {}), ...extra } : {}).database();
const anon = () => env.unauthenticatedContext().database();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-safespace',
    database: { rules: readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8') },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    await set(ref(db, 'students/stu1'), { uid: 'stu1', student_id: '2021-0001', first_name: 'A' });
    await set(ref(db, 'students/stu2'), { uid: 'stu2', student_id: '2021-0002', first_name: 'B' });
    await set(ref(db, 'counselors/cou1'), { uid: 'cou1', login_access: true, login: 'Enable' });
    await set(ref(db, 'admins/adm1'), { role: 'admin' });
    await set(ref(db, 'consultations/c1'), { studentId: 'stu1', counselorId: 'cou1', status: 'OPEN' });
    await set(ref(db, 'consultation_messages/c1/m1'), { senderId: 'stu1', text: 'hi', timestamp: 1 });
    await set(ref(db, 'Session_report/stu1/case1/meta'), { note: 'private' });
    await set(ref(db, 'appointments_by_student/stu1/a1'), { student_uid: 'stu1', counselor_uid: 'cou1', status: 'pending' });
    await set(ref(db, 'appointments_by_counselor/cou1/a1'), { student_uid: 'stu1', counselor_uid: 'cou1', status: 'pending' });
    await set(ref(db, 'config/loginEnabled'), true);
  });
});

// ---- default deny / unauthenticated ----
test('unauthenticated users cannot read anything sensitive', async () => {
  await assertFails(get(ref(anon(), 'students')));
  await assertFails(get(ref(anon(), 'students/stu1')));
  await assertFails(get(ref(anon(), 'consultations/c1')));
  await assertFails(get(ref(anon(), 'Session_report')));
});
test('login config is publicly readable but only admin-writable', async () => {
  await assertSucceeds(get(ref(anon(), 'config/loginEnabled')));
  await assertFails(set(ref(as('cou1', 'counselor'), 'config/loginEnabled'), false));
  await assertSucceeds(set(ref(as('adm1', 'admin'), 'config/loginEnabled'), false));
});
test('a signed-in user without a role claim gets no access', async () => {
  await assertFails(get(ref(as('stu1'), 'students/stu1/first_name')));
  await assertFails(set(ref(as('stu1'), 'students/stu1'), { uid: 'stu1', student_id: '2021-0001' }));
});

test('counselor without a valid 2FA stamp is treated as unauthorised', async () => {
  const noTwofa = env.authenticatedContext('cou1', { role: 'counselor' }).database();
  const expired = as('cou1', 'counselor', { twofa_until: Date.now() - 1000 });
  // stamp from an earlier sign-in (different auth_time) must not count for a new sign-in
  const otherSignIn = as('cou1', 'counselor', { auth_time: 1700009999 });
  for (const db of [noTwofa, expired, otherSignIn]) {
    await assertFails(get(ref(db, 'students')));
    await assertFails(get(ref(db, 'Session_report/stu1')));
    await assertFails(get(ref(db, 'appointments_by_counselor/cou1')));
  }
});

// ---- students ----
test('student reads/writes only their own profile', async () => {
  const db = as('stu1', 'student');
  await assertSucceeds(get(ref(db, 'students/stu1')));
  await assertFails(get(ref(db, 'students/stu2')));
  await assertFails(get(ref(db, 'students')));
  await assertSucceeds(update(ref(db, 'students/stu1'), { first_name: 'A2' }));
  await assertFails(update(ref(db, 'students/stu2'), { first_name: 'hacked' }));
});
test('student cannot change their own student_id or uid', async () => {
  const db = as('stu1', 'student');
  await assertFails(update(ref(db, 'students/stu1'), { student_id: '9999' }));
  await assertFails(update(ref(db, 'students/stu1'), { uid: 'stu2' }));
});
test('counselors and admins can list students', async () => {
  await assertSucceeds(get(ref(as('cou1', 'counselor'), 'students')));
  await assertSucceeds(get(ref(as('adm1', 'admin'), 'students')));
});

// ---- counselors ----
test('counselor cannot grant themselves login access or edit others', async () => {
  const db = as('cou1', 'counselor');
  await assertSucceeds(update(ref(db, 'counselors/cou1'), { specialization: 'x' }));
  await assertFails(update(ref(db, 'counselors/cou1'), { login_access: false }));
  await assertFails(update(ref(as('cou2', 'counselor'), 'counselors/cou1'), { specialization: 'y' }));
});
test('student cannot edit a counselor profile but can update rating aggregates', async () => {
  const db = as('stu1', 'student');
  await assertFails(update(ref(db, 'counselors/cou1'), { first_name: 'x' }));
  await assertSucceeds(set(ref(db, 'counselors/cou1/rating_total'), 5));
});

// ---- consultations & messages ----
test('only participants (and admin) can read a consultation', async () => {
  await assertSucceeds(get(ref(as('stu1', 'student'), 'consultations/c1')));
  await assertSucceeds(get(ref(as('cou1', 'counselor'), 'consultations/c1')));
  await assertSucceeds(get(ref(as('adm1', 'admin'), 'consultations/c1')));
  await assertFails(get(ref(as('stu2', 'student'), 'consultations/c1')));
});
test('consultation list queries must be scoped to the caller', async () => {
  const db = as('stu1', 'student');
  await assertSucceeds(get(query(ref(db, 'consultations'), orderByChild('studentId'), equalTo('stu1'))));
  await assertFails(get(ref(db, 'consultations')));
  await assertFails(get(query(ref(db, 'consultations'), orderByChild('studentId'), equalTo('stu2'))));
});
test('messages are append-only and sender-authenticated', async () => {
  const stu = as('stu1', 'student');
  await assertSucceeds(set(ref(stu, 'consultation_messages/c1/m2'), { senderId: 'stu1', text: 'yo', timestamp: 2 }));
  await assertFails(set(ref(stu, 'consultation_messages/c1/m3'), { senderId: 'cou1', text: 'spoof', timestamp: 3 }));
  await assertFails(set(ref(stu, 'consultation_messages/c1/m1'), { senderId: 'stu1', text: 'edited', timestamp: 1 }));
  await assertFails(set(ref(as('stu2', 'student'), 'consultation_messages/c1/m9'), { senderId: 'stu2', text: 'intruder', timestamp: 9 }));
  await assertFails(get(ref(as('stu2', 'student'), 'consultation_messages/c1')));
  await assertSucceeds(get(ref(as('cou1', 'counselor'), 'consultation_messages/c1')));
});

// ---- session reports ----
test('session reports are staff-only', async () => {
  await assertFails(get(ref(as('stu1', 'student'), 'Session_report/stu1')));
  await assertSucceeds(get(ref(as('cou1', 'counselor'), 'Session_report/stu1')));
  await assertSucceeds(get(ref(as('adm1', 'admin'), 'Session_report/stu1')));
  await assertFails(set(ref(as('adm1', 'admin'), 'Session_report/stu1/case2'), { x: 1 }));
  await assertSucceeds(set(ref(as('cou1', 'counselor'), 'Session_report/stu1/case2'), { x: 1 }));
});

// ---- appointments ----
test('students create appointments only as themselves', async () => {
  const db = as('stu1', 'student');
  await assertSucceeds(set(ref(db, 'appointments_by_student/stu1/a2'), { student_uid: 'stu1', counselor_uid: 'cou1' }));
  await assertSucceeds(set(ref(db, 'appointments_by_counselor/cou1/a2'), { student_uid: 'stu1', counselor_uid: 'cou1' }));
  await assertFails(set(ref(db, 'appointments_by_counselor/cou1/a3'), { student_uid: 'stu2', counselor_uid: 'cou1' }));
  await assertFails(set(ref(db, 'appointments_by_student/stu2/a9'), { student_uid: 'stu2' }));
});
test('counselor sees own queue; cannot read another counselor queue', async () => {
  await assertSucceeds(get(ref(as('cou1', 'counselor'), 'appointments_by_counselor/cou1')));
  await assertFails(get(ref(as('cou2', 'counselor'), 'appointments_by_counselor/cou1')));
  await assertFails(get(ref(as('stu2', 'student'), 'appointments_by_counselor/cou1/a1')));
});
test('counselor can update status on their own appointment copy in the student tree', async () => {
  await assertSucceeds(update(ref(as('cou1', 'counselor'), 'appointments_by_student/stu1/a1'), { status: 'accepted' }));
  await assertFails(update(ref(as('cou2', 'counselor'), 'appointments_by_student/stu1/a1'), { status: 'accepted' }));
});
test('students cannot overwrite another student\'s booked slot', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(ctx.database(), 'availabilities/cou1/bookedSlots/2026-01-01/09:00'), { student_uid: 'stu1' });
  });
  await assertFails(set(ref(as('stu2', 'student'), 'availabilities/cou1/bookedSlots/2026-01-01/09:00'), { student_uid: 'stu2' }));
  await assertSucceeds(set(ref(as('stu2', 'student'), 'availabilities/cou1/bookedSlots/2026-01-01/10:00'), { student_uid: 'stu2' }));
});

// ---- admin / audit ----
test('only admins can write admin records; audit logs are append-only', async () => {
  await assertFails(set(ref(as('stu1', 'student'), 'admins/stu1'), { role: 'admin' }));
  const adm = as('adm1', 'admin');
  await assertSucceeds(set(ref(adm, 'admin_audit_logs/profile_updates/adm1/l1'), { action: 'x' }));
  await assertFails(set(ref(adm, 'admin_audit_logs/profile_updates/adm1/l1'), { action: 'edited' }));
  await assertFails(get(ref(as('cou1', 'counselor'), 'admin_audit_logs')));
});

// ---- notifications ----
test('notifications are readable only by their owner', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await set(ref(ctx.database(), 'notifications/cou1/n1'), { unread: true }); });
  await assertSucceeds(get(ref(as('cou1', 'counselor'), 'notifications/cou1')));
  await assertFails(get(ref(as('stu1', 'student'), 'notifications/cou1')));
  await assertSucceeds(set(ref(as('stu1', 'student'), 'notifications/cou1/n2'), { unread: true })); // create for another user
  await assertFails(set(ref(as('stu1', 'student'), 'notifications/cou1/n1'), { unread: false })); // but not overwrite
});
