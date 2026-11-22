# Firebase backend

```
firebase/
  database.rules.json   role-based Realtime Database rules
  functions/            Cloud Functions (Node 22, region asia-southeast1)
    src/twofa.js        sendLoginCode, verifyLoginCode
    src/students.js     checkStudentActivation, activateStudent, inviteStudents (admin)
    src/counselors.js   createCounselor, setCounselorAccess, deleteCounselor (admin)
    scripts/set-role.js bootstrap the first admin / assign a role claim
  tests/                rules + function tests (run against the local emulators)
```

## Run the tests
Needs Node 20+ and Java 11+. From `firebase/`:

```
npm install && (cd functions && npm install)
npm test
```

If a run is killed, an emulator can keep port 9000 (Windows). Stop the stray `java` process for the
`firebase-database-emulator` jar and run again.

## Callable functions (client usage)
```js
import { getFunctions, httpsCallable } from 'firebase/functions';
const fns = getFunctions(app, 'asia-southeast1');            // region must match
await httpsCallable(fns, 'sendLoginCode')({});               // signed in with password first
await httpsCallable(fns, 'verifyLoginCode')({ code: '123456' });
await auth.currentUser.getIdToken(true);                      // pick up the twofa_until claim
```

| Function | Who | Replaces |
|---|---|---|
| `checkStudentActivation({studentId,email,lastName,code})` | anyone (rate limited) | `verify.html` reading `students` before login |
| `activateStudent({...same, username, gender, password})` | anyone (rate limited) | `signup.html` creating the Auth user + writing the record |
| `sendLoginCode()` / `verifyLoginCode({code})` | signed-in user with a role | browser-side 2FA (`sessionStorage`, `temp2FACode`, EmailJS) |
| `inviteStudents({ids?, resend?})` | admin | browser-generated activation codes + EmailJS |
| `setTwoFactor({enabled})` | student (needs a code for this sign-in) | settings/profile writing `email2FA` and `temp2FACode` into the student record |
| `setStudentAccess({uid,enabled})` | admin | the client-side `login: Enable/Disable` flag check |
| `deleteStudent({uid})` | admin | deleting only the database record and leaving the login account behind |
| `createCounselor({...})` / `setCounselorAccess({uid,enabled})` / `deleteCounselor({uid})` | admin | `admin/js/main.js` creating users with a second Auth app |

## 2FA enforcement
`verifyLoginCode` adds a `twofa_until` custom claim (12 h). The rules require it for the counselor role on every
counselor-owned path, so skipping the 2FA screen no longer gets a counselor any data. Students and admins are not
enforced yet (admins have no 2FA UI; student 2FA is optional per account).

## Cutover checklist (production, once there is access)
Do these in order; steps 3 and 4 are the data migration and are safe to repeat.
1. Take a full export of the Realtime Database (Console > Realtime Database > Export JSON) and keep it.
2. Deploy `firebase/functions` and `firebase/database.rules.json`, and configure SMTP for the functions.
3. `node functions/scripts/migrate-data.js` (dry run: prints every move it would make), review, then
   `node functions/scripts/migrate-data.js --apply --backup before-migration.json`. It re-keys activated students and
   counselors to their uid (psych tests follow), moves pre-registered students to `roster`, deletes leftover 2FA codes,
   TOTP secrets and activation codes of activated students, and sets the `role` / `mfa_required` claims. Records whose
   target already exists are reported and skipped. Re-running after `--apply` does nothing.
4. Give every admin the claim: `node functions/scripts/set-role.js <email> admin` (the migration also does this for
   anyone listed under `admins/`).
5. Deploy the web apps from this branch (Vercel). Test with one student, one counselor and one admin account first.

Rollback: restore the export from step 1 (the app code from `main` needs the old rules too), or the backup file for
just the moved records.

## Switching the counselor login over
The counselor login (`apps/counselor/pages/login.html`) now signs in with the Firebase SDK, then calls
`sendLoginCode`/`verifyLoginCode`. It needs, in this order:
1. Functions + rules deployed to the project.
2. `node functions/scripts/backfill-claims.js --apply` so existing counselors/admins/students get their `role` claim
   (dry run without `--apply`). Accounts without the claim are told they cannot sign in here.
3. SMTP configured for the functions.

The 2FA stamp is bound to the sign-in it was issued for (`twofa_auth_time` must equal the token's `auth_time`), so a
password sign-in on another device needs its own code. Signing in again elsewhere ends the earlier device's session.

Local browser testing: serve `apps/counselor` and open `/pages/login.html?emulator=1` (`?emulator=0` to switch back).
`tests/e2e/counselor_login.py` drives this with Playwright.

## Switching the student pages over
Done on this branch: `verify`, `signup`, `signin`, `settings` (2FA toggle) and `profile` (2FA setup) now call the
functions; `complete-profile` reads `students/{uid}`; `index` gets the shared session guard. Student 2FA is optional:
turning it on stores an `mfa_required` claim, and the rules then require a code for every new sign-in of that student.
The student pages need the roster in `/roster` and the claims; `scripts/migrate-data.js` does both (see the cutover checklist).
`js/two-factor.js` holds the shared code dialog. The fake authenticator-app (TOTP) option on the profile page was
removed: it never took part in sign-in. Local testing: open any student page with `?emulator=1`;
`tests/e2e/student_flow.py` runs the whole journey in Chrome (16 checks).

The student `messages`, `history` and notification code now read consultations through `window.myConsultations()` /
scoped queries (`tests/e2e/student_consultations.py`, 6 checks).

Counselor pages: `message.html` listens to consultations with a `counselorId`/`studentId` scoped query, and
`students.html` counts a student's sessions from the counselor's own `appointments_by_counselor` list instead of listing
the student's node (`tests/e2e/counselor_data.py`, 5 checks). `appointment.html` still tries a date/time fallback lookup in
`appointments_by_student/{uid}`; the rules refuse it and the code already skips the student-side write in that case.

Admin pages: sign-in checks the `role: admin` claim and then requires an emailed code (admins need the 2FA stamp for
every sign-in, in the rules and in every admin function). `user-management` lists activated students and imported
`roster` entries, imports CSV rows into `roster` (codes are never taken from the file), sends invitations through
`inviteStudents` and toggles student login through `setStudentAccess`. `counselor-management` creates, disables and
deletes counselors through `createCounselor` / `setCounselorAccess` / `deleteCounselor`; the browser no longer creates
accounts or sees passwords, and EmailJS is gone from the admin app (`tests/e2e/admin_flow.py`, 15 checks).
Admin functions find records keyed by the old ids through their stored `uid` (`.indexOn uid`), so they work before and
after the key migration. **Before switching over, give every admin account the claim:**
`node functions/scripts/set-role.js <email> admin` (the old `admins/{uid}` record alone no longer grants access).

The other admin pages are audited too: the dashboard totals now come from `appointments_by_counselor` (the old global
`appointments` node has no rule), and admins may read the `appointments_by_*` and `Session_report` collections and correct
session records from the reports page. `psych_tests` used to be readable by every signed-in user; now staff read all and a
student only their own (key = uid, or an old key whose student record carries their uid). `content-management`,
`report-management`, `profile` and `settings` already matched the rules. The students/counselors rules no longer reject
writes to records keyed by old ids (admin edits of `students/2024-0001` used to fail the `uid === key` check).

Deleting an activated student now goes through `deleteStudent` (login, profile, psych tests and roster link are removed;
appointments, session reports and consultations stay as clinical records). The counselor activity helper refuses to write
to anyone else's log.

Still open: **students and counselors editing their own profile while their record is still keyed by an old
id** (the rules let owners write only `students/{uid}` / `counselors/{uid}`), which the data migration fixes.

## Configuration
Copy `functions/.env.example` to `functions/.env` for SMTP. With no SMTP configured the emulator writes mail to
`/_dev_outbox` (read it in the emulator UI); production refuses to run without SMTP.
First admin: create the user in Auth, then `node functions/scripts/set-role.js you@school.edu admin`.
