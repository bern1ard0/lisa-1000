// Shared billing helpers, loaded on every page: Stripe checkout/portal
// redirects, the pricing-page state, and the pre-renewal reminder banner.

// Full /api/me payload with the billing fields normalized, tolerant of the
// fields living at the root or nested under user. Resolves to null (never
// rejects) when the endpoint is missing or the visitor is signed out.
async function billingFetchMe() {
    let data = null;
    try {
        data = window.lisaMeFullPromise
            ? await window.lisaMeFullPromise
            : await fetch('/api/me').then((resp) => resp.json());
    } catch (error) {
        console.error('Could not load billing state:', error);
    }
    if (!data || typeof data !== 'object') return null;
    const user = data.user || null;
    // Billing fields may sit beside `user` or on it — take whichever exists.
    const src = (data.plan || data.usage || data.subscription || data.pending_renewal || data.credits)
        ? data
        : (user || {});
    return {
        user: user,
        plan: src.plan || 'free',
        subscription: src.subscription || null,
        usage: src.usage || null,
        credits: src.credits || null,
        pending_renewal: src.pending_renewal || null,
    };
}

// Accepts Stripe-style unix seconds, epoch millis, or an ISO string.
function billingTimestamp(value) {
    if (value == null) return NaN;
    if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
    const parsed = Date.parse(value);
    return isNaN(parsed) ? Number(value) : parsed;
}

function billingFormatDate(value) {
    const ts = billingTimestamp(value);
    if (isNaN(ts)) return null;
    return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function billingFormatAmount(cents, currency) {
    if (typeof cents !== 'number') return null;
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: (currency || 'usd').toUpperCase(),
        }).format(cents / 100);
    } catch (error) {
        return null;
    }
}

// POST to a billing endpoint and follow the {url} it returns. 401 means
// signed out — auth.js has no login helper, only its /auth/login link, so
// go there with a return path to the current page.
async function billingRedirect(endpoint, payload) {
    try {
        const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {}),
        });
        if (resp.status === 401) {
            window.location.href = '/auth/login?next=' +
                encodeURIComponent(window.location.pathname + window.location.search);
            return;
        }
        if (!resp.ok) throw new Error('Billing server returned ' + resp.status);
        const data = await resp.json();
        if (!data || !data.url) throw new Error('Billing server sent no redirect URL');
        window.location.href = data.url;
    } catch (error) {
        console.error('Billing request failed:', error);
        if (window.Swal) {
            Swal.fire({
                icon: 'error',
                title: 'Billing is unavailable',
                text: 'Please try again in a moment.',
                confirmButtonColor: '#8B5CF6',
                background: '#171130',
                color: '#EDEAF7',
            });
        } else {
            alert('Billing is unavailable right now — please try again in a moment.');
        }
    }
}

function billingCheckout(payload) {
    return billingRedirect('/api/billing/checkout', payload);
}

function billingPortal() {
    return billingRedirect('/api/billing/portal');
}

// Pricing page only (no-op elsewhere): wire the plan buttons, show the
// post-checkout success note, and reflect the visitor's current plan.
async function renderPricingState() {
    const upgradeButton = document.getElementById('upgradeButton');
    if (!upgradeButton) return;

    // ?upgraded=1 success note — works even when /api/me is unreachable.
    if (new URLSearchParams(window.location.search).get('upgraded') === '1') {
        const note = document.getElementById('upgradeSuccess');
        if (note) note.classList.remove('hidden');
    }

    upgradeButton.addEventListener('click', function () {
        if (upgradeButton.dataset.mode === 'manage') billingPortal();
        else billingCheckout({ plan: 'premium_monthly' });
    });

    const buyCreditsButton = document.getElementById('buyCreditsButton');
    if (buyCreditsButton) {
        buyCreditsButton.addEventListener('click', function () {
            billingCheckout({ pack: 'credits' });
        });
    }

    const me = await billingFetchMe();
    if (!me) return;

    if (me.plan === 'premium') {
        upgradeButton.dataset.mode = 'manage';
        upgradeButton.textContent = 'Manage subscription';
        const status = document.getElementById('premiumStatus');
        if (status) {
            const sub = me.subscription;
            const when = sub ? billingFormatDate(sub.current_period_end) : null;
            if (when) {
                status.textContent = sub.cancel_at_period_end
                    ? 'Your plan is set to cancel — Premium stays active until ' + when + '.'
                    : "You're on Premium — renews on " + when + '.';
            } else {
                status.textContent = "You're on Premium.";
            }
            status.classList.remove('hidden');
        }
    } else if (me.user && me.usage && me.usage.limit) {
        const usageNote = document.getElementById('freeUsageNote');
        if (usageNote) {
            usageNote.textContent =
                "You've used " + me.usage.used + ' of your ' + me.usage.limit + ' free stories this month.';
            usageNote.classList.remove('hidden');
        }
    }

    const creditsNote = document.getElementById('creditsBalanceNote');
    if (creditsNote && me.credits && me.credits.balance > 0) {
        creditsNote.textContent = 'You have ' + me.credits.balance + ' credits left.';
        creditsNote.classList.remove('hidden');
    }
}

// Slim dismissible reminder under the nav, shown on any page while a
// renewal is pending. Dismissal is per renewal date, per browser session.
async function renderRenewalBanner() {
    const me = await billingFetchMe();
    if (!me || !me.pending_renewal) return;
    const renewal = me.pending_renewal;

    const ts = billingTimestamp(renewal.renewal_at);
    if (isNaN(ts) || ts <= Date.now()) return;

    const dismissKey = 'lisa1000:renewalNoticeDismissed:' + renewal.renewal_at;
    try {
        if (sessionStorage.getItem(dismissKey)) return;
    } catch (error) { /* storage blocked — just show the banner */ }

    const when = billingFormatDate(renewal.renewal_at);
    const amount = billingFormatAmount(renewal.amount_cents, renewal.currency);

    const banner = document.createElement('div');
    banner.className = 'renewal-banner';
    banner.setAttribute('role', 'status');

    const text = document.createElement('span');
    text.className = 'renewal-banner-text';

    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'renewal-banner-link';
    manage.textContent = 'Manage subscription →';
    manage.addEventListener('click', function () { billingPortal(); });

    if (renewal.low_usage) {
        // Barely-used Premium: nudge toward pay-as-you-go instead.
        const used = renewal.used_this_period != null ? renewal.used_this_period : 0;
        text.append(
            "You've created only " + used + ' stor' + (used === 1 ? 'y' : 'ies') +
            ' this billing period. Not using Premium much? You can cancel and switch to a ' +
            'one-time credit pack — pay only for what you use. '
        );
        text.appendChild(manage);
        text.append(' · ');
        const packs = document.createElement('a');
        packs.className = 'renewal-banner-link';
        packs.href = '/pricing.html';
        packs.textContent = 'See credit packs';
        text.appendChild(packs);
    } else {
        text.append(
            'Your Premium plan renews on ' + when + (amount ? ' (' + amount + ')' : '') +
            '. Want to keep it? Do nothing. Want to cancel? '
        );
        text.appendChild(manage);
    }

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'renewal-banner-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss renewal reminder');
    dismiss.textContent = '✕';
    dismiss.addEventListener('click', function () {
        try { sessionStorage.setItem(dismissKey, '1'); } catch (error) { /* ignore */ }
        banner.remove();
    });

    banner.append(text, dismiss);
    const navContainer = document.querySelector('.nav-container');
    if (navContainer) navContainer.insertAdjacentElement('afterend', banner);
    else document.body.prepend(banner);
}

document.addEventListener('DOMContentLoaded', function () {
    // Highlight the current nav tab — pricing.html loads neither script.js
    // nor loadStories.js, so billing.js mirrors their href-keyed highlighter.
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-container nav ul li a').forEach(function (link) {
        if ((link.getAttribute('href') || '').split('/').pop() === currentPage) {
            link.classList.add('current-page');
        }
    });
    renderPricingState();
    renderRenewalBanner();
});
