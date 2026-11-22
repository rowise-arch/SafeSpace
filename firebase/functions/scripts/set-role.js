'use strict';
// Usage: node scripts/set-role.js <email> <student|counselor|admin>
// Sets the role custom claim (and admins/{uid} for admins). Uses Application Default Credentials in production,
// or the emulators when FIREBASE_AUTH_EMULATOR_HOST / FIREBASE_DATABASE_EMULATOR_HOST are set.
const admin = require('firebase-admin');
const [email, role] = process.argv.slice(2);
if (!email || !['student', 'counselor', 'admin'].includes(role)) {
  console.error('Usage: node scripts/set-role.js <email> <student|counselor|admin>');
  process.exit(1);
}
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT, databaseURL: process.env.DATABASE_URL });
(async () => {
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, { ...(user.customClaims || {}), role });
  if (role === 'admin') await admin.database().ref(`admins/${user.uid}`).set({ role: 'admin', enable: 'enable', email });
  console.log(`Set role=${role} for ${email} (${user.uid}). The user must sign in again to pick it up.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
