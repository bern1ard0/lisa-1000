// Build the avatar + handle button and its dropdown for a signed-in user.
function buildAccountMenu(user) {
    const wrap = document.createElement('div');
    wrap.className = 'account-menu';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'account-toggle';
    toggle.setAttribute('aria-haspopup', 'true');
    toggle.setAttribute('aria-expanded', 'false');

    const avatar = document.createElement('span');
    avatar.className = 'account-avatar';
    avatar.textContent = (user.handle || '?').charAt(0).toUpperCase();

    const handle = document.createElement('span');
    handle.className = 'auth-handle';
    handle.textContent = user.handle;

    toggle.append(avatar, handle);

    const panel = document.createElement('div');
    panel.className = 'account-panel';
    panel.hidden = true;

    const header = document.createElement('div');
    header.className = 'account-panel-header';
    const headerHandle = document.createElement('div');
    headerHandle.className = 'account-panel-handle';
    headerHandle.textContent = user.handle;
    const headerEmail = document.createElement('div');
    headerEmail.className = 'account-panel-email';
    headerEmail.textContent = user.email || '';
    header.append(headerHandle, headerEmail);

    const soonItem = (label) => {
        const item = document.createElement('div');
        item.className = 'account-item account-item-disabled';
        const text = document.createElement('span');
        text.textContent = label;
        const tag = document.createElement('span');
        tag.className = 'account-soon-tag';
        tag.textContent = 'soon';
        item.append(text, tag);
        return item;
    };

    const signOut = document.createElement('button');
    signOut.type = 'button';
    signOut.className = 'account-item account-item-action';
    signOut.textContent = 'Log out';
    signOut.addEventListener('click', async () => {
        await fetch('/auth/logout', { method: 'POST' });
        window.location.reload();
    });

    const deleteAccount = document.createElement('button');
    deleteAccount.type = 'button';
    deleteAccount.className = 'account-item account-item-danger';
    deleteAccount.textContent = 'Delete account';
    deleteAccount.addEventListener('click', async () => {
        if (!confirm("This permanently deletes your account and every story you've saved. This cannot be undone. Continue?")) return;
        if (!confirm('Last check — really delete your account and all your stories?')) return;
        await fetch('/api/me', { method: 'DELETE' });
        window.location.reload();
    });

    panel.append(
        header,
        document.createElement('hr'),
        soonItem('Profile'),
        soonItem('Settings'),
        document.createElement('hr'),
        signOut,
        deleteAccount
    );
    panel.querySelectorAll('hr').forEach((hr) => (hr.className = 'account-divider'));

    function closePanel() {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
    }
    function openPanel() {
        panel.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
    }

    toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        if (panel.hidden) openPanel(); else closePanel();
    });
    document.addEventListener('click', (event) => {
        if (!panel.hidden && !wrap.contains(event.target)) closePanel();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !panel.hidden) closePanel();
    });

    wrap.append(toggle, panel);
    return wrap;
}

// Sign-in widget for the header nav. Every page has an empty <li id="auth-nav">
// slot; this fills it in from /api/me so signed-out visitors see "Log in"
// and signed-in ones get an avatar + handle button that opens an account menu.
(async function () {
    const slot = document.getElementById('auth-nav');
    if (!slot) return;

    let user = null;
    try {
        const resp = await fetch('/api/me');
        ({ user } = await resp.json());
    } catch (error) {
        console.error('Could not load sign-in state:', error);
        return;
    }

    slot.textContent = '';

    if (user) {
        slot.appendChild(buildAccountMenu(user));
    } else {
        // "Log in", not "Sign up": with OAuth the first sign-in creates the
        // account, so one button covers both. The Google mark + pill shape keep
        // it visually distinct from the round translate toggle beside it.
        const signIn = document.createElement('a');
        signIn.href = '/auth/login';
        signIn.className = 'auth-google-btn';
        signIn.innerHTML =
            '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">' +
            '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
            '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
            '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
            '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
            '</svg><span>Log in</span>';
        slot.append(signIn);
    }
})();
