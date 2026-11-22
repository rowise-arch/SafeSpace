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
| `createCounselor({...})` / `setCounselorAccess({uid,enabled})` / `deleteCounselor({uid})` | admin | `admin/js/main.js` creating users with a second Auth app |

## 2FA enforcement
`verifyLoginCode` adds a `twofa_until` custom claim (12 h). The rules require it for the counselor role on every
counselor-owned path, so skipping the 2FA screen no longer gets a counselor any data. Students and admins are not
enforced yet (admins have no 2FA UI; student 2FA is optional per account).

## Configuration
Copy `functions/.env.example` to `functions/.env` for SMTP. With no SMTP configured the emulator writes mail to
`/_dev_outbox` (read it in the emulator UI); production refuses to run without SMTP.
First admin: create the user in Auth, then `node functions/scripts/set-role.js you@school.edu admin`.
