// Sign-in widget for the header nav. Every page has an empty <li id="auth-nav">
// slot; this fills it in from /api/me so signed-out visitors see "Sign in"
// and signed-in ones see their handle + "Sign out".
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
        const handle = document.createElement('span');
        handle.className = 'auth-handle';
        handle.textContent = user.handle;

        const signOut = document.createElement('button');
        signOut.type = 'button';
        signOut.className = 'auth-link';
        signOut.textContent = 'Sign out';
        signOut.addEventListener('click', async () => {
            await fetch('/auth/logout', { method: 'POST' });
            window.location.reload();
        });

        slot.append(handle, signOut);
    } else {
        const signIn = document.createElement('a');
        signIn.href = '/auth/login';
        signIn.className = 'auth-link';
        signIn.textContent = 'Sign in';
        slot.append(signIn);
    }
})();
