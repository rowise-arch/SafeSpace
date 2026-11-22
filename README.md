# SafeSpace

Web-based guidance counseling platform (RSU SafeSpace). Three static web apps on Firebase, plus a small dev server for counselor 2FA.

```
apps/
  student/     signin/signup, assessments, messages, history, resources, video
  counselor/   login (2FA), appointments, messages, students, notifications
  admin/       dashboard, user/counselor management, reports, content, psych tests
    index.html    entry point (redirects into pages/)
    pages/        all HTML pages (they link to each other by filename)
    js/ css/ assets/
    templates/    unused page templates / drafts (counselor, admin)
shared/assets/   files used by more than one app (logo)
server/          Express 2FA API (serves apps/counselor); see server/README.md
```

## Running
- **Student / admin:** serve the app folder as the site root, e.g. `npx serve apps/student`
  (the student service worker is registered at `/firebase-messaging-sw.js`, so it must be the root).
  Pages load the shared logo from `../../../shared/` — serve the repo root if the logo doesn't show,
  or copy `shared/assets/` into the app when deploying a single app folder.
- **Counselor:** `cd server && npm install && npm start`, then open http://localhost:3001.

Firebase config is still defined per app (`apps/student/js/firebase-config.js`,
`apps/counselor/js/auth-db.js`, `apps/admin/js/main.js`) because each uses a different SDK version.
