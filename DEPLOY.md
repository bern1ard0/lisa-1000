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
