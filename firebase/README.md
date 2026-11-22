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
| `createCounselor({...})` / `setCounselorAccess({uid,enabled})` / `deleteCounselor({uid})` | admin | `admin/js/main.js` creating users with a second Auth app |

## 2FA enforcement
`verifyLoginCode` adds a `twofa_until` custom claim (12 h). The rules require it for the counselor role on every
counselor-owned path, so skipping the 2FA screen no longer gets a counselor any data. Students and admins are not
enforced yet (admins have no 2FA UI; student 2FA is optional per account).

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
The student pages need the roster in `/roster` (move pre-registered `students` records there) and the claims backfill.
`js/two-factor.js` holds the shared code dialog. The fake authenticator-app (TOTP) option on the profile page was
removed: it never took part in sign-in. Local testing: open any student page with `?emulator=1`;
`tests/e2e/student_flow.py` runs the whole journey in Chrome (16 checks).

The student `messages`, `history` and notification code now read consultations through `window.myConsultations()` /
scoped queries (`tests/e2e/student_consultations.py`, 6 checks).

Still on the old model (will hit permission errors under the new rules until converted): the counselor pages beyond
login (`message.html` reads the whole `consultations` collection); the admin pages.

## Configuration
Copy `functions/.env.example` to `functions/.env` for SMTP. With no SMTP configured the emulator writes mail to
`/_dev_outbox` (read it in the emulator UI); production refuses to run without SMTP.
First admin: create the user in Auth, then `node functions/scripts/set-role.js you@school.edu admin`.
