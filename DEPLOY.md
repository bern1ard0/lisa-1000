# Deploying Lisa 1000 to Cloudflare (lisa1000.com)

The app now runs two ways from the same code:

| Mode | Command | What runs |
|---|---|---|
| Classic local (Express) | `npm start` in `myproject/` | `server.js` on http://localhost:3000, keys from `.env` |
| Cloudflare (local + production) | `npm run dev` / `npm run deploy` in `myproject/` | `worker/index.js` + static `public/` on Cloudflare's edge |

Both serve the same frontend and the same five API routes. The Worker is what
goes to lisa1000.com.

## One-time setup

1. **Log in** (opens a browser to authorize your Cloudflare account):
   ```bash
   cd myproject
   npx wrangler login
   ```

2. **Put your API keys where they belong.** This is the important part:

   | Environment | Where keys live | How |
   |---|---|---|
   | Local dev | `myproject/.dev.vars` (gitignored — never committed) | copy `.dev.vars.example` → `.dev.vars`, fill in values |
   | Production | Cloudflare encrypted secrets | `npx wrangler secret put <NAME>` (paste value when prompted) |

   Set all production secrets:
   ```bash
   npx wrangler r2 bucket create lisa1000-media # once; or dashboard: R2 -> Create bucket
   npx wrangler d1 create lisa1000             # once; paste database_id into wrangler.jsonc
   npx wrangler d1 migrations apply lisa1000 --remote   # schema + seed stories (docs/SCHEMA.md)
   npx wrangler secret put ANTHROPIC_API_KEY   # Claude: stories, definitions, translation
   npx wrangler secret put ELEVENLABS_API_KEY  # ElevenLabs streaming narration (Lisa & Adam voices)
   npx wrangler secret put OPENAI_API_KEY      # story images, TTS fallback, and Claude fallback
   npx wrangler secret put HF_CREDENTIALS      # Higgsfield "KEY_ID:KEY_SECRET" for illustrations
   npx wrangler secret put GOOGLE_CLIENT_ID     # Google OAuth sign-in (see below)
   npx wrangler secret put GOOGLE_CLIENT_SECRET # Google OAuth sign-in (see below)
   npx wrangler secret put STRIPE_SECRET_KEY            # Stripe API key (sk_live_... / sk_test_...)
   npx wrangler secret put STRIPE_WEBHOOK_SECRET        # Stripe webhook signing secret (whsec_...)
   npx wrangler secret put STRIPE_PRICE_PREMIUM_MONTHLY # price id of the monthly premium plan (price_...)
   npx wrangler secret put STRIPE_PRICE_CREDITS_PACK    # price id of the one-time credit pack (price_...)
   npx wrangler secret put RESEND_API_KEY               # OPTIONAL: renewal-reminder emails via Resend
   npx wrangler secret put CREDITS_PER_PACK             # OPTIONAL: credits per pack (default 20)
   ```

   Rules of thumb:
   - **Never** put keys in `wrangler.jsonc`, HTML/JS in `public/`, or any committed file.
     Anything in `public/` is sent to every visitor's browser.
   - Secrets are write-only: you can overwrite them, but not read them back — keep
     your own copy in a password manager.
   - The `HF_CREDENTIALS` value is a Higgsfield **API key pair** from
     platform.higgsfield.ai (developer keys) — not your higgsfield.ai website login.

   **Creating the Google OAuth client** (for `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`):
   1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services →
      Credentials → Create Credentials → OAuth client ID.
   2. Application type: **Web application**.
   3. Authorized redirect URIs — add both:
      - `https://<your-domain>/auth/callback` (production, e.g. `https://lisa1000.com/auth/callback`)
      - `http://localhost:8787/auth/callback` (local dev via `npm run dev`)
   4. Save, then copy the Client ID and Client Secret into `npx wrangler secret put`
      above (production) and `.dev.vars` (local — see below).
   5. The `sessions` table (`0005_sessions.sql`) ships with the `d1 migrations
      apply` step above — no separate step needed.

   **Stripe billing setup** (subscription + free tier + credit packs):
   1. Apply the billing migration (adds `billing_customers`, `subscriptions`,
      `renewal_notices`, `usage_counters`, `credit_ledger` — see
      `docs/SCHEMA.md`):
      ```bash
      npx wrangler d1 migrations apply lisa1000 --remote   # (--local for dev)
      ```
   2. In the Stripe dashboard create two prices and put their ids in the
      secrets above:
      - a **monthly recurring** price for Premium → `STRIPE_PRICE_PREMIUM_MONTHLY`
      - a **one-time** price for the credit pack → `STRIPE_PRICE_CREDITS_PACK`
   3. Dashboard → Developers → Webhooks → Add endpoint:
      - Endpoint URL: **`https://lisa1000.com/api/billing/webhook`**
      - Events: `checkout.session.completed`,
        `customer.subscription.updated`, `customer.subscription.deleted`,
        `invoice.upcoming`
      - Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

   **How the story-generation gate works** (`POST /generate-story`):
   1. **Anonymous visitors** can read/browse the library free but must sign
      in to generate — the endpoint returns `401 {"error":"login_required"}`.
      (There is no anonymous session to meter against; requiring login was
      the clean fit for the existing cookie-session auth.)
   2. **Premium** (active/trialing Stripe subscription): unlimited.
   3. **Free tier**: 5 story generations per calendar month (UTC).
   4. **Credit packs**: past the free allowance, each generation spends 1
      purchased credit (a pack grants 20, or `CREDITS_PER_PACK`).
   5. Out of everything → `402 {"error":"free_limit_reached","used":N,
      "limit":5,"credits":0,"upgrade":"/pricing.html"}` — the frontend
      shows the upgrade prompt on this exact shape.

   **Renewal reminders:** Stripe fires `invoice.upcoming` a few days before
   each renewal charge. The worker records it in `renewal_notices` (surfaced
   as `pending_renewal` on `GET /api/me`, so the frontend shows a "renews
   soon" banner with a cancel path) and, when `RESEND_API_KEY` is set, also
   emails the subscriber via Resend with the renewal date, amount, and a
   manage/cancel link. Subscribers who created 2 or fewer stories that
   billing period get the low-usage variant, which suggests cancelling or
   switching to a one-time credit pack. Without `RESEND_API_KEY` the email
   is skipped silently — the in-app banner still works. The email sends
   from `billing@lisa1000.com`, so verify the lisa1000.com domain in Resend
   first.

3. **First deploy:**
   ```bash
   npm run deploy
   ```
   Wrangler prints a `*.workers.dev` URL — the app is live there immediately.
   Test it before wiring the domain.

4. **Attach lisa1000.com.** Since the domain is already on Cloudflare:
   - Dashboard → Workers & Pages → `lisa1000` → Settings → **Domains & Routes**
     → Add → Custom domain → `lisa1000.com` (and `www.lisa1000.com` if you want).
   - Cloudflare creates the DNS records and TLS certificate automatically.
     No nameserver changes needed because you bought the domain there.

## Day-to-day workflow

```bash
cd myproject
npm run dev        # local dev at http://localhost:8787, uses .dev.vars keys
npm run deploy     # ship current code to production
npx wrangler tail  # live production logs (see errors as they happen)
```

Deploys are atomic and take a few seconds. There is no build step — the Worker
bundles `worker/index.js` and uploads `public/` as static assets.

## Costs & limits

- **Free plan**: 100,000 Worker requests/day — far more than enough to launch.
  Static assets (HTML/CSS/JS/images) are free and unlimited.
- **$5/mo Workers Paid** is only needed later for: longer CPU limits, Cron
  triggers, Queues, and bigger D1 quotas (Phase 2: accounts + database).
- Your real variable cost stays the AI APIs (Anthropic / OpenAI / Higgsfield),
  exactly as before.

## What's deliberately NOT here yet

- **Rate limiting / quotas** — before sharing the URL widely, add a per-IP cap on
  the generation endpoints so a scripted visitor can't drain your API budget.
  (Cloudflare dashboard → Security → WAF → Rate limiting rules is the zero-code
  way: e.g. 10 requests per 10 minutes to `/generate-story`.)
- **Accounts, D1 database, R2 media storage** — Phase 2 of the roadmap.

## Troubleshooting

- `npm run dev` says a secret is undefined → your `.dev.vars` is missing or has
  the wrong variable name.
- Production 500s on generation routes → `npx wrangler tail` and trigger the
  request; the underlying API error (bad key, out of credits) appears there.
- Changed a secret? Re-run `wrangler secret put` — no redeploy needed.
