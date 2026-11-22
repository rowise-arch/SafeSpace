(function(){
  // idempotent initializer for top-right profile dropdown and notification panel
  if (window.__profileDropdownInitialized) return; window.__profileDropdownInitialized = true;

  function init() {
  const notifBtn = document.getElementById('notifBtn');
  const notifPanel = document.getElementById('notifPanel');
  const profileBtn = document.getElementById('profileBtn');
    const profileDropdown = document.getElementById('profileDropdown');
    const accountEdit = document.getElementById('accountEdit');
    const accountSettings = document.getElementById('accountSettings');
    const accountLogout = document.getElementById('accountLogout');

    if (!profileBtn && !notifBtn) return; // nothing to do

    function closeAll() {
      if (notifPanel) {
        try { notifPanel.setAttribute('data-open','false'); notifPanel.style.display = 'none'; notifPanel.style.visibility = 'hidden'; notifPanel.style.opacity = '0'; } catch(_){}
        if (notifBtn) try { notifBtn.setAttribute('aria-expanded','false'); } catch(_){}
      }
      if (profileDropdown) { profileDropdown.setAttribute('aria-hidden','true'); if (profileBtn) profileBtn.setAttribute('aria-expanded','false'); }
    }

    function openNotif() {
      if (!notifPanel || !notifBtn) return;
      try {
        notifPanel.setAttribute('data-open','true');
        notifPanel.style.display = 'block'; notifPanel.style.visibility = 'visible'; notifPanel.style.opacity = '1'; notifPanel.style.zIndex = '9999';
        if (notifBtn) notifBtn.setAttribute('aria-expanded','true');
        // If the panel is positioned absolutely inside the bell wrapper, let CSS handle placement
        const computedPos = window.getComputedStyle(notifPanel).position;
        if (computedPos === 'absolute' || computedPos === 'relative') {
          notifPanel.style.left = 'auto';
          notifPanel.style.right = '0';
          notifPanel.style.top = '';
        } else {
          // position under bell (fallback for fixed panels)
          const rect = notifBtn.getBoundingClientRect();
          const panelRect = notifPanel.getBoundingClientRect();
          const panelWidth = panelRect.width || 260;
          const left = Math.max(8, Math.round(rect.left + (rect.width / 2) - (panelWidth / 2)));
          const top = Math.max(8, Math.round(rect.bottom + 8));
          const maxLeft = Math.max(8, window.innerWidth - panelWidth - 8);
          notifPanel.style.left = Math.min(left, maxLeft) + 'px';
          notifPanel.style.top = top + 'px';
          notifPanel.style.right = 'auto';
        }
      } catch (e) {
        try { notifPanel.setAttribute('data-open','true'); notifPanel.style.display = 'block'; } catch(_){}
      }
    }

    function toggleNotif(e) {
      e && e.stopPropagation();
      if (!notifPanel) return;
      const open = notifPanel.getAttribute('data-open') === 'true';
      closeAll();
      if (!open) openNotif();
    }

    function openProfile() {
      if (!profileDropdown || !profileBtn) return;
      profileDropdown.setAttribute('aria-hidden','false'); profileBtn.setAttribute('aria-expanded','true');
    }

    function toggleProfile(e) {
      e && e.stopPropagation();
      if (!profileDropdown || !profileBtn) return;
      const open = profileDropdown.getAttribute('aria-hidden') === 'false' || profileDropdown.style.display === 'block';
      closeAll();
      if (!open) openProfile();
    }

  // Wire notification bell to toggle the notifications panel
  notifBtn?.addEventListener('click', toggleNotif);
  // Keep profile toggle
  profileBtn?.addEventListener('click', toggleProfile);

    // close when clicking outside
    document.addEventListener('click', (e) => {
      try {
        if (!e.target.closest('#notifPanel') && !e.target.closest('#notifBtn') && !e.target.closest('#profileDropdown') && !e.target.closest('#profileBtn')) {
          closeAll();
        }
      } catch (_) { closeAll(); }
    }, true);

    // close on Escape
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

    // Navigate to profile page when 'Manage your profile' is clicked
    // Also add a capture-phase document listener to force navigation before any per-page handlers
    accountEdit?.addEventListener('click', () => { 
      closeAll();
      try { window.location.href = 'profile.html'; } catch(e){ console.debug('navigate to profile error', e); }
    });

    // Capture-phase handler: ensures any click on the element with id 'accountEdit'
    // will immediately navigate to admin_profile.html, even if a page attaches
    // other handlers later that would otherwise override or change behavior.
    document.addEventListener('click', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('#accountEdit') : null;
      if (!el) return;
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch(_) {}
      closeAll();
      try { window.location.href = 'profile.html'; } catch(err){ console.debug('capture navigate to profile error', err); }
    }, true);
    accountSettings?.addEventListener('click', () => { closeAll(); window.location.href = 'settings.html'; });
    accountLogout?.addEventListener('click', async () => {
      closeAll();
      try {
        if (typeof window.signOutAndRedirect === 'function') {
          await window.signOutAndRedirect();
          return;
        }
        // fallback: try signOut available on window
        if (window.auth && typeof window.signOut === 'function') {
          try { await window.signOut(window.auth); } catch(e){ console.debug('fallback signOut error', e); }
        }
      } catch(err) { console.error('logout error', err); }
      try { localStorage.removeItem('authToken'); } catch(e){}
      window.location.href = 'login.html';
    });

    // populate avatar/email/greeting if window.adminProfile available
    function populateProfileData() {
      try {
        const topAvatar = document.querySelector('.main-top-bar .user-avatar') || document.getElementById('profileBtn');
        const dropdownAvatar = document.querySelector('.avatar-large') || null;
        const emailEl = document.getElementById('profileEmail');
        const greetEl = document.getElementById('topGreetingName');
        const dropdownGreetingEl = document.getElementById('profileGreeting');
        const displayName = (window.adminProfile && (window.adminProfile.fullname || window.adminProfile.username)) || window.adminDisplayName || '';

        if (window.adminProfile) {
          const p = window.adminProfile;
          
          // Update top bar avatar
          if (topAvatar) {
            if (p.profileImage) {
              let img = topAvatar.querySelector('img');
              if (!img) { 
                img = document.createElement('img'); 
                img.style.width = '100%'; 
                img.style.height = '100%'; 
                img.style.borderRadius = '50%'; 
                img.style.objectFit = 'cover'; 
                topAvatar.textContent = ''; 
                topAvatar.appendChild(img); 
              }
              img.src = p.profileImage;
              img.alt = displayName || 'Avatar';
            } else if (displayName) {
              topAvatar.textContent = displayName.trim().charAt(0).toUpperCase();
            }
          }
          
          // Update dropdown avatar
          if (dropdownAvatar) {
            if (p.profileImage) {
              let img = dropdownAvatar.querySelector('img');
              if (!img) { 
                img = document.createElement('img'); 
                dropdownAvatar.appendChild(img); 
              }
              img.src = p.profileImage; 
              img.alt = displayName || 'Avatar';
            } else if (displayName) {
              dropdownAvatar.textContent = (displayName || 'A').trim().charAt(0).toUpperCase();
            }
          }
          
          // Update email in dropdown
          if (emailEl) {
            emailEl.textContent = p.email || 'No email available';
          }
          
          // Update greeting in top bar
          if (greetEl && displayName) {
            greetEl.textContent = greetEl.textContent.replace(/,.*/, '') + `, ${displayName}`;
          }
          
          // Update greeting in dropdown
          if (dropdownGreetingEl && displayName) {
            dropdownGreetingEl.textContent = `Hi, ${displayName}`;
          }
        }
      } catch(err) { 
        console.debug('populateProfileData error', err); 
      }
    }

    // Initial population attempt
    populateProfileData();

    // Listen for profile data load event
    window.addEventListener('adminProfileLoaded', () => {
      populateProfileData();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
