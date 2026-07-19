# LISA 1000 — Model Orchestration (v1, researched July 2026)

How LISA 1000 picks a model/vendor for each generation step, and the fallback
chains that keep a feature working when a provider is down. **Pricing below
was researched via secondary sources — the research environment could not
reach primary vendor pricing pages. Every price here is pending
verification against the vendor's own pricing page before funding any
account.**

---

## 1. Selection principles

Ranked in order — each principle only breaks ties left by the one above it:

1. **Quality first.** For a children's product, a wrong or ugly output is
   worse than a slow one. The best available model wins unless it fails a
   hard requirement below.
2. **Quality/cost mix second.** Among models that clear the quality bar,
   prefer the one with the best output-per-dollar — this is what picks the
   fallback order, not just the primary.
3. **Speed third.** Matters for interactive flows (story generation while a
   kid waits); matters less for narration/animation, which can render in the
   background and get cached (`docs/SCHEMA.md` §2 `narrations`).

**Hard requirements that filtered the field:**

- **Word timestamps for TTS** — `narrations.timestamps_json` (SCHEMA.md §2)
  drives word highlighting; a TTS provider with no per-word/per-character
  alignment output is disqualified for narration, full stop.
- **Reference-image character consistency for scene art** — a character
  drawn in scene 3 has to look like the same character in scene 7. Models
  with no reference-image or character-consistency mechanism are usable for
  one-off covers but not for a multi-scene illustrated book.
- **API-key-simple auth callable from a Cloudflare Worker** — no SDKs that
  require a persistent process, no OAuth flows with browser redirects, no
  GPU rental. A `fetch()` call with a bearer/API key header.
- **Children's-content policy fit** — the provider's usage policy has to
  permit content aimed at kids, and its safety filtering shouldn't be so
  aggressive it blocks normal storybook prompts (talking animals, mild
  peril, magic).
- **Vendor longevity.** A model that's cheap and great today is worthless if
  the vendor pulls the API in a year. **Cautionary example: OpenAI announced
  the Sora API shuts down Sept 24, 2026** — barely a generation-model
  lifetime after launch. Any engine considered here is weighed against "what
  happens to our library if this API disappears" — which is also why
  fal.ai's multi-model aggregation (§5) is attractive: it decouples LISA
  1000 from any single upstream vendor's survival.

---

## 2. Orchestration table

One row per capability. Fallback 2 is the last resort before the feature
degrades or fails outright.

| Capability | Primary | Fallback 1 | Fallback 2 | Rationale |
|---|---|---|---|---|
| **Story text** | OpenAI `gpt-5-mini` | Claude (`claude-sonnet-5`) | — | *(implemented)* Cheap, fast, good-enough prose; Claude as a second independent vendor so one outage never blocks story generation. |
| **Narration + dialogue TTS** | ElevenLabs v3 (~pricing TBD/1M chars) | MiniMax Speech 2.6 HD (word timestamps via `subtitle_enable`; $1.50 voice clones; ~$60–100/1M chars) | OpenAI TTS (no timestamps) | ElevenLabs v3 has the best emotion-tag delivery, best cloning, and word timestamps — but reliability is its known weakness (rate limits, transient 5xx). MiniMax is the first fallback with timestamps intact — degrading past it means losing word highlighting. OpenAI TTS is the last resort: keeps audio playing but the client must **degrade to no-highlight mode**. Watch list: Gemini 3.1 Flash TTS (#2 on the TTS arena) — timestamp support unverified, re-evaluate once confirmed. |
| **Cover art** | OpenAI GPT Image 2 (#1 Artificial Analysis image arena, Elo ~1337) | Google Nano Banana 2 / Gemini 3.1 Flash Image (~$0.045–0.15/img; single Gemini API key, no aggregator needed) | ByteDance Seedream 4.x via fal.ai (~$0.02–0.04/img) | Covers are single-image, no character-consistency requirement, so the top general-purpose image model wins outright; fallbacks are ranked by quality/cost. |
| **Scene illustrations** (character consistency across scenes) | Google Nano Banana 2 | ByteDance Seedream 4.x via fal.ai | OpenAI GPT Image 2 | Nano Banana 2 holds up to 5 consistent characters across 8–10 sequential edits — documented watercolor-storybook prompting exists — which is exactly LISA 1000's per-scene requirement. Seedream 4.x takes up to 6 reference images with per-image roles, a close second. GPT Image 2 only supports conversational (single-thread) editing, not true multi-reference consistency, so it's the fallback, not the primary, here — inverted from the cover-art row above. **Higgsfield Soul is REJECTED for this role**: it's a photoreal/real-person identity engine (Soul ID needs 20+ training photos of a real subject) — the wrong tool for invented, illustrated characters that were never photographed. This resolves SCHEMA.md §7's open question on the per-scene engine. |
| **Scene animation** (image-to-video) | Seedance via fal.ai (#2 Artificial Analysis i2v arena; Fast tier ~$0.022/sec) | Kling 3.0 via fal.ai (~$0.084–0.28/sec) | Wan 2.5/2.6 via fal.ai (~$0.05/sec) | Seedance's stylized-2D strength matches storybook/cartoon aesthetics, has native audio + lip-sync, and Fast tier is the cheapest per-second option that still clears the quality bar. Kling is close in quality but has peak-hour queue risk and costs 4–13x more; Wan is the cheap fallback. **Premium tier for later:** Gemini Omni Flash — #1 on the video arena, but pricing is opaque and it has a documented false-positive risk flagging minor faces, which is disqualifying for a children's product until resolved. **Sora is disqualified outright** — API shutdown announced for 2026-09-24 (see §1 vendor-longevity principle). |
| **Cartoon lip-sync** (v2, plays only) | Hedra Character-3 | Kling LipSync (flat ~$0.084–0.15/clip) | Seedance native lip-sync pass | Character-3 is purpose-built for expressive character lip-sync; Kling LipSync is a flat-rate fallback; Seedance's own lip-sync (already in the pipeline for scene animation) is the last-resort option that needs no extra vendor integration. |

### fal.ai as aggregator

fal.ai fronts Seedream, Kling, Wan, and Pika (among others) behind one
API key and one billing relationship — a single integration covers three of
the fallback rows above. Per-model markup over calling the vendor directly
is usually small, and sometimes fal.ai is *cheaper* than the vendor's own
API. Given the API-key-simple auth requirement (§1) and the vendor-longevity
principle, fal.ai is the default integration point for every non-OpenAI,
non-Google image/video model in this table — one relationship to maintain
instead of four.

---

## 3. Fallback mechanism

The chain contract (see `withFallback` in `myproject/worker/index.js`):

- **Ordered providers.** Each capability has an explicit priority list —
  Primary → Fallback 1 → Fallback 2 — matching the table above.
- **Skip if unconfigured.** A provider with no API key/secret set in `env`
  is skipped without attempting it — a missing key isn't a "failure" worth
  logging on every request, it's expected in dev/staging.
- **No added timeouts (for now).** `fetch()` already has its own timeout
  behavior on Workers; the chain doesn't layer a second one. This may change
  once real failure-mode data exists (see below).
- **Log the cause, try the next.** Every failed attempt is logged
  (`console.error`) with which provider failed and why, then the chain moves
  on — so a provider outage is visible in Worker logs without breaking the
  request.
- **Throw the last error.** If every configured provider fails (or none are
  configured), the chain throws — the caller's existing error handling
  (the `catch` in `fetch()`, `myproject/worker/index.js`) turns that into a
  502/500 the same way it always has.

**Future: circuit breaker.** The current chain retries every provider on
every request — fine at LISA 1000's traffic today. Once a provider's outage
pattern is understood (e.g. ElevenLabs 5xx bursts), a circuit breaker that
skips a provider for N minutes after M consecutive failures would cut
latency on failed requests (no point re-trying a provider mid-outage) and
reduce log noise. Not implemented yet — needs real failure data first.

---

## 4. Estimated cost per story (pre-verification, order-of-magnitude)

| Item | Rough cost |
|---|---|
| Story text (gpt-5-mini) | ~$0.01 |
| Cover art (1 image) | ~$0.04–0.17 |
| Scene illustrations (5 images) | ~$0.10–0.75 |
| Narration (one-time synthesis; cached forever after — `narrations` table, SCHEMA.md §2) | ~$0.20–0.40 |
| Scene animation (5 clips) | ~$0.55 (Seedance Fast) to ~$10+ (premium tier) |

Narration cost is paid once per (work, voice, language) — every replay after
that is a free cache hit (`GET /api/works/:id/narration`). Animation is the
dominant cost driver and the reason Seedance Fast is the default rather than
a premium tier.

---

*Re-verify every price and Elo/arena ranking in this document against the
vendor's own pricing/benchmark page before funding an account against it.*
