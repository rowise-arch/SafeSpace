// admin_profile_loader.js
// Centralized helper to load admin display name and avatar for admin pages.

import { auth, db, ref, get, getStorage, storageRef, getDownloadURL, onAuthStateChanged } from './main.js';

window.adminDisplayName = window.adminDisplayName || 'Admin';

export async function loadAdminProfileInto(pageOptions = {}) {
  // pageOptions: { greetingSelector, avatarSelector, timeSelector }
  const greetingSelector = pageOptions.greetingSelector || '#topGreetingName';
  const avatarSelector = pageOptions.avatarSelector || '.main-top-bar .user-avatar';
  const timeSelector = pageOptions.timeSelector || '#topGreetingTime';

  try {
    onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      try {
        const snap = await get(ref(db, `admins/${user.uid}`));
        if (snap && snap.exists()) {
          const data = snap.val() || {};
          // Prefer the schema you provided: fullname, username, position, role, profileImage, twoFactorEnabled
          const fullname = data.fullname || data.full_name || data.displayName || '';
          const username = data.username || data.user || '';
          const position = data.position || data.role || data.position || '';
          const role = data.role || '';
          const profileImage = data.profileImage || data.profile_image || data.photo_url || data.photoURL || data.photo || '';
          // twoFactorEnabled: keep blank if not set yet
          const twoFactorEnabled = (typeof data.twoFactorEnabled !== 'undefined' && data.twoFactorEnabled !== null) ? data.twoFactorEnabled : '';

          // Prefer username for the top greeting, then fullname, then other fallbacks
          const displayName = username || fullname || user.displayName || (user.email || '').split('@')[0] || 'Admin';
          window.adminDisplayName = displayName;

          // Expose a full profile object for pages that need other fields
          window.adminProfile = {
            uid: user.uid,
            fullname,
            username,
            email: data.email || user.email || '',
            position: position || data.position || '',
            role: role || '',
            status: data.status || data.enable || data.enabled || '',
            profileImage,
            phone: data.phone || '',
            createdAt: data.createdAt || data.created_at || data.created || '',
            lastLogin: data.lastLogin || data.last_login || '',
            twoFactorEnabled
          };

          // Dispatch custom event to notify other scripts that profile is loaded
          window.dispatchEvent(new CustomEvent('adminProfileLoaded', { detail: window.adminProfile }));

          // Update greeting and time immediately
          const topGreetingName = document.querySelector(greetingSelector);
          const topGreetingTime = document.querySelector(timeSelector);
          const now = new Date();
          const h = now.getHours();
          let greet = 'Good Morning';
          if (h >= 12 && h < 18) greet = 'Good Afternoon';
          else if (h >= 18) greet = 'Good Evening';
          if (topGreetingName) topGreetingName.textContent = `${greet}, ${window.adminDisplayName} 👋`;
          if (topGreetingTime) topGreetingTime.textContent = now.toLocaleString(undefined,{weekday:'long',month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});

          // Avatar handling
          const avatarDiv = document.querySelector(avatarSelector);
          if (avatarDiv) {
            let photoUrl = data.photo_url || data.photoURL || data.photo || data.profileImage || null;
            if (photoUrl) {
              // Assume photoUrl is already a full URL, no Storage call needed
              let img = avatarDiv.querySelector('img');
              if (!img) {
                img = document.createElement('img');
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.borderRadius = '50%';
                img.style.objectFit = 'cover';
                avatarDiv.textContent = ''; // Clear text
                avatarDiv.appendChild(img);
              }
              img.src = photoUrl;
              img.style.display = 'block';
            } else {
              const img = avatarDiv.querySelector('img');
              if (img) {
                img.src = '';
                img.style.display = 'none';
              }
              avatarDiv.style.backgroundImage = '';
              avatarDiv.textContent = (window.adminDisplayName || 'A').trim().charAt(0).toUpperCase();
            }
          }
        }
      } catch (err) {
        console.error('loadAdminProfileInto error', err);
      }
    });
  } catch (err) {
    console.error('loadAdminProfileInto outer error', err);
  }
}

// Small helper to start the time updater (uses window.adminDisplayName)
export function startGreetingClock(greetingSelector = '#topGreetingName', timeSelector = '#topGreetingTime') {
  function updateTopGreeting(){
    const now = new Date();
    const h = now.getHours();
    let greet = 'Good Morning'; if (h>=12&&h<18) greet='Good Afternoon'; else if (h>=18) greet='Good Evening';
    const name = window.adminDisplayName || 'Admin';
    const nameEl = document.querySelector(greetingSelector);
    const timeEl = document.querySelector(timeSelector);
    if (nameEl) nameEl.textContent = `${greet}, ${name} 👋`;
    if (timeEl) timeEl.textContent = now.toLocaleString(undefined,{weekday:'long',month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
  }
  updateTopGreeting();
  setInterval(updateTopGreeting, 30000);
  document.addEventListener('DOMContentLoaded', updateTopGreeting);
}
