# SafeSpace data model and security rules

Reconstructed from the client code (`apps/*`). The live Firebase project (`rsu-safespace`) was not accessible, so
**the current rules and real data shapes are unverified**. Treat the "current" column as what the code expects.

Rules live in `firebase/database.rules.json` and are tested by `firebase/tests/rules.test.js`
(`cd firebase && npm install && npm test`; needs Java).

## 1. Roles

Roles come from a Firebase Auth **custom claim** `role` = `student` | `counselor` | `admin`.
The claim is set server-side (Admin SDK / Cloud Function) when an account is created. The browser can never set it.
Rules read it as `auth.token.role`. A signed-in user with no claim has no access.

## 2. Current model (as the code uses it) vs. target

| Path | Current key / shape | Problem | Target |
|---|---|---|---|
| `students/{key}` | key is a push-id/"studentKey", `uid` stored as a field; looked up with `orderByChild('uid')` | rules cannot express "own record"; sign-up reads this collection **before login** by `student_id` | key = Auth `uid`; pre-registered list moves to `roster/{id}` (admin-only); sign-up verification becomes a Cloud Function |
| `students/{key}/temp2FACode` | 2FA code written **and read** by the student's browser | code is readable and forgeable client-side | remove; Cloud Function issues/verifies codes (see §4) |
| `counselors/{counselor_id}` | key is a generated id, `uid` is a field | same lookup problem | key = Auth `uid`; keep `counselor_id` as a field |
| `admins/{uid}` | `{role, enable}` | admin check was client-only | keep keyed by uid; also set `role=admin` claim |
| `consultations/{id}` | `{studentId, counselorId, status, ..., messages: []}`; `studentId` is sometimes a uid, sometimes a DB key, sometimes `null` | pages download **the whole collection** and filter in JS; messages are an array edited by read-modify-write (races, no history) | flat records with `studentId`/`counselorId` = uid; messages move to `consultation_messages/{id}/{msgId}` (append-only) |
| `appointments_by_student/{uid}/{id}`, `appointments_by_counselor/{uid}/{id}` | already keyed by uid; the same object is written to both | duplication drifts | keep for now; later a Cloud Function writes the second copy |
| `availabilities/{counselorUid}` | `weeklyAvailability`, `weeklyRanges`, `dateExceptions`, `bookedSlots/{date}/{slot}` | students write `bookedSlots` directly (double booking possible) | booking via a Cloud Function/transaction |
| `Session_report/{studentUid}/{caseId}` | `{meta, sessions, approvals}` | confidential clinical notes | staff-only (unchanged shape) |
| `notifications/{uid}/{id}`, `student_notif/{...}` | `{unread, ...}`; clients create notifications for other users | any user can spam another | Cloud Function creates them |
| `ratings/{counselorUid}/{consultId}`, `counselors/*/rating_*` | aggregates written by the browser | forgeable | Cloud Function maintains aggregates |
| `config/loginEnabled`, `config/loginDisabledMessage` | read by the counselor login page before sign-in | none (public by design) | unchanged (public read, admin write) |
| `psych_tests`, `resources`, `files`, `assessments/{uid}`, `ors/{uid}`, `reports`, `reports_by_user/{uid}`, `concern_files`, `activity/{uid}`, `presence/{uid}`, `reminders/{uid}`, `student_fcm_tokens/{uid}`, `admin_audit_logs`, `conversionRequests`, `test_records`, `ratings_history` | see rules | — | see rules |

Shapes of the minor paths (`ors`, `reports`, `concern_files`, `files`, `conversionRequests`) were only partly visible;
confirm them against real data before locking them down further.

## 3. What the rules enforce

- Default deny. Nothing outside the listed paths is readable or writable.
- Students: own `students/{uid}` only; cannot change `student_id` or `uid`; own appointments, assessments, ORS.
- Counselors: own profile and availability; own appointment queue; may update status on appointments addressed to them;
  read all `students` (trade-off, see §5); write/read `Session_report`.
- Admins: manage `counselors`, `roster`, content, reports; read audit logs; append-only `admin_audit_logs`.
- Consultations: only the two participants (and admins). **List queries must be scoped**
  (`orderByChild('studentId').equalTo(uid)` or `orderByChild('counselorId').equalTo(uid)`); an unscoped read of
  `/consultations` is rejected.
- Messages: append-only, `senderId` must equal the caller, only participants may read or post.
- Counselors cannot change their own `login`/`login_access` (admin-only).

## 4. App changes required before deploying these rules

Server side is done: the Cloud Functions in `firebase/functions` (see `firebase/README.md`) cover items 1, 2 and 5.
Switched over: counselor and admin sign-in (2FA), student verify/sign-up/sign-in/2FA settings, the consultations pages
and admin user/counselor management. Counselors and admins always need a server-issued `twofa_until` stamp bound to the
current sign-in; students need it only if they turned 2FA on. The data itself is moved by
`firebase/functions/scripts/migrate-data.js` (uid keys, `roster`, claims, leftover secrets removed; tested, dry run by
default; see the cutover checklist in `firebase/README.md`). Student deletion is server-side (`deleteStudent`).

These rules are stricter than what the current pages do. Deploying them to the live project **without** these
changes will break those flows.

1. **Student sign-up/verify** (`apps/student/pages/verify.html`, `signup.html`, `complete-profile.html`):
   no more unauthenticated `students` query. Replace with a callable `verifyStudent(studentId)` function that checks
   `roster`, creates the Auth user, sets the `role=student` claim and writes `students/{uid}`.
2. **Student/counselor 2FA** (`student/pages/signin.html`, `counselor/pages/login.html`): move code generation and
   verification to Cloud Functions. Delete `temp2FACode*` fields and the `sessionStorage` code check.
3. **Counselor and student lookups by `uid`** (`counselor/js/main.js`, `auth-db.js`, `account.html`,
   `student/pages/*`): replace `orderByChild('uid')` with direct reads of `counselors/{uid}` / `students/{uid}`
   after the re-key migration.
4. **Consultations** (`student/pages/messages.html`, `counselor/pages/message.html`, `video.html`): replace
   `ref('consultations').once('value')` with scoped queries; write messages to `consultation_messages`.
5. **Admin user creation** (`admin/js/main.js` `createCounselor`, `user-management.html`): a Cloud Function creates the
   Auth user, sets the claim, sends the temporary password/reset link; remove the browser-side EmailJS passcode.
6. **Appointment lookups by `appointmentId`** in `student/pages/messages.html`: query by `studentId` and filter.
7. **Student reads of `Session_report`**: rules deny it; use appointment/consultation status instead.

## 5. Known trade-offs and open questions

- Counselors can read **every** student profile (needed by the current student list). Tightening this to "students with
  a consultation or appointment with me" needs an index node such as `counselor_students/{counselorUid}/{studentUid}`.
- Counselors can read any student's `Session_report` and `assessments`; there is no per-case assignment yet.
- `notifications` can be created by any signed-in user for any other user until a Cloud Function replaces this.
- Rating aggregates are still writable by any student until moved server-side.
- Open questions for whoever owns the live project: are the current rules open? is there real student data?
  are any other paths in use (the audit only sees what the client code touches)?

## 6. Migration outline (when a Firebase project is available)

1. Export the existing database (console → Export JSON). Never run migrations on the only copy.
2. Cloud Function/script: for every `students/{key}` and `counselors/{id}` with a `uid`, copy to `.../{uid}`, set the
   `role` custom claim, and move unregistered students into `roster`.
3. Normalise `consultations.studentId`/`counselorId` to uids; move `messages` arrays to `consultation_messages`.
4. Deploy updated app pages and the rules together; keep the old rules until the new clients are live.
5. Delete legacy keys after a verification period.
