# LISA 1000 — Data Schema (v1)

The agreed data structure for LISA 1000. This is the contract every feature
builds against: the Library and its filters, Stories and Plays, voices and
the per-language voice bank, characters, settings, narration caching, and
the animation pipeline. **Settle data first, spend credits second.**

- **Storage:** Cloudflare **D1** (SQLite) for all tables; **R2** for binaries
  (audio renders, video clips, cover images, portraits).
- **IDs:** text ULIDs/UUIDs unless noted. External IDs (ElevenLabs voice ids)
  are stored as-is.
- **System user:** a reserved user `lisa` owns all built-in content.
  "Lisa's stories" is `owner_id = 'lisa'` — a filter, never a special code path.

---

## 1. Design principles

1. **One model, tagged by kind.** A *Story* (narrated prose) and a *Play*
   (cast + dialogue) are the same entity — a **work** — distinguished by
   `works.kind`. The difference is a validation rule, not a table fork.
   Library, animations, narrations, and the interchange JSON stay unified,
   and "promote this story into a play" is a transformation, not a migration.
2. **Author in one place, render in another.** The Create tab makes works.
   The Animate tab renders them. An animation is a *render of a work*, never
   part of it — one work can hold a cheap motion-comic render and a premium
   cartoon render side by side.
3. **Never synthesize the same thing twice.** Expensive outputs (TTS audio,
   video clips) are cached as rows pointing at R2 objects, keyed by what
   produced them (work × voice × language). Second listen is free.
4. **Controlled vocabularies.** Emotions, genres, lengths, and animation
   styles are enums/lookup tables so filters never fragment
   ("happy" vs "Happy" vs "joyful").

---

## 2. Entities

### users
The root of ownership. (Auth ships before or alongside this schema; until
then, everything can be built against the `lisa` system user.)

```sql
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  handle      TEXT UNIQUE NOT NULL,
  email       TEXT UNIQUE,
  created_at  INTEGER NOT NULL            -- unix epoch seconds
);
-- Reserved row: ('lisa', 'lisa', NULL, ...)
```

### voices
One table covers three concepts: the voice catalogue, ownership
(the old `Voice_Bank`), and the per-language bank.

```sql
CREATE TABLE voices (
  voice_id           TEXT PRIMARY KEY,    -- provider's id, e.g. ElevenLabs
  name               TEXT NOT NULL,       -- "Lisa", "Adam", "Papa's voice"
  provider           TEXT NOT NULL DEFAULT 'elevenlabs',
  owner_id           TEXT REFERENCES users(id),  -- NULL = built-in/system
  language           TEXT,                -- BCP-47 ('fr'); NULL = multilingual
  is_cloned          INTEGER NOT NULL DEFAULT 0,
  preview_audio_url  TEXT,                -- R2: "hear this voice" sample
  created_at         INTEGER NOT NULL
);
```

Seed rows: Lisa `kv1Qe4fUcVPEC2ZisX5i`, Adam `IRHApOXLvnW57QJPQH2P`
(owner NULL, language NULL — multilingual defaults).

**Voice resolution (the bank):** for a requested (voice name/key, story
language): pick `voices` where `language = :lang` and
`owner_id IN (:user, NULL)`, preferring the user's own; else fall back to the
multilingual default (`language IS NULL`). Multilingual models mean the
fallback always works; per-language clones are an upgrade, not a requirement.

### emotions
```sql
CREATE TABLE emotions (
  name   TEXT PRIMARY KEY,                -- 'happy','sad','inspired','cozy',
  emoji  TEXT                             -- 'scary','funny','calm','excited'
);
```

### characters
```sql
CREATE TABLE characters (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL,
  traits        TEXT,                     -- "brave, curious rhino"
  backstory     TEXT,
  visual_prompt TEXT,                     -- for consistent illustration
  portrait_url  TEXT,                     -- R2
  voice_id      TEXT REFERENCES voices(voice_id),  -- dialogue voice (plays)
  created_at    INTEGER NOT NULL
);
```

### settings
Where a story takes place. Reusable across works.

```sql
CREATE TABLE settings (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL,            -- "The frozen forest"
  description   TEXT,
  visual_prompt TEXT,
  image_url     TEXT,                     -- R2
  created_at    INTEGER NOT NULL
);
```

### works  ← the hub (Stories AND Plays)
```sql
CREATE TABLE works (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id),
  kind            TEXT NOT NULL CHECK (kind IN ('story','play')),
  title           TEXT NOT NULL,          -- ALWAYS present; Claude generates
                                          -- one when the user doesn't supply it
  genre           TEXT,                   -- 'adventure','mystery','fantasy',...
  language        TEXT NOT NULL DEFAULT 'en',
  length          TEXT CHECK (length IN ('very_short','short','medium','long')),
  setting_id      TEXT REFERENCES settings(id),
  source          TEXT NOT NULL CHECK (source IN ('lisa','user')),
  cover_image_url TEXT,                   -- R2
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_works_owner  ON works(owner_id);
CREATE INDEX idx_works_kind   ON works(kind);
CREATE INDEX idx_works_genre  ON works(genre);
```

```sql
CREATE TABLE work_emotions (
  work_id  TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  emotion  TEXT NOT NULL REFERENCES emotions(name),
  PRIMARY KEY (work_id, emotion)
);

CREATE TABLE work_characters (
  work_id      TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id),
  role         TEXT,                      -- 'protagonist','friend','villain'
  PRIMARY KEY (work_id, character_id)
);
```

**Kind rules (enforced in the app layer):**

| | `kind = 'story'` | `kind = 'play'` |
|---|---|---|
| Cast (`work_characters`) | optional | **required, ≥ 1**, every member's character has a `voice_id` |
| Scene body | `scenes.narration_text` required | `scene_lines` required per scene |
| Narration | one voice streams everything | per-line synthesis by character voice; renders to cache rather than live-streaming |

### scenes
The body of a work — the single source of truth that the reader, TTS,
illustration, subtitles, and every animation style all consume.

```sql
CREATE TABLE scenes (
  id             TEXT PRIMARY KEY,
  work_id        TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  idx            INTEGER NOT NULL,        -- order within the work
  display_text   TEXT NOT NULL,           -- clean text shown to the reader
  narration_text TEXT,                    -- same text + [emotional cues]
  image_prompt   TEXT,
  image_url      TEXT,                    -- R2
  music_mood     TEXT,                    -- 'calm','adventurous','cozy',...
  UNIQUE (work_id, idx)
);
```

### scene_lines
Dialogue depth inside a scene. Mandatory for plays; optional for stories.

```sql
CREATE TABLE scene_lines (
  id           TEXT PRIMARY KEY,
  scene_id     TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  idx          INTEGER NOT NULL,
  character_id TEXT REFERENCES characters(id),  -- NULL = narrator
  text         TEXT NOT NULL,
  emotion      TEXT REFERENCES emotions(name),  -- delivery hint for TTS
  direction    TEXT,                     -- stage direction: "(shivers)".
                                         -- Radio mode: narrator reads it.
                                         -- Cartoon mode: motion hint.
  UNIQUE (scene_id, idx)
);
```

### narrations  ← the credit-saver
Cached TTS renders. A (work, voice, language) triple is synthesized **once**.

```sql
CREATE TABLE narrations (
  id              TEXT PRIMARY KEY,
  work_id         TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  voice_id        TEXT REFERENCES voices(voice_id), -- NULL for multi-voice play mixes
  language        TEXT NOT NULL,
  audio_url       TEXT NOT NULL,          -- R2 (mp3)
  timestamps_json TEXT,                   -- ElevenLabs char/word timings:
                                          -- drives word highlighting, subtitles,
                                          -- and scene sync in animations
  created_at      INTEGER NOT NULL,
  UNIQUE (work_id, voice_id, language)
);
```

### animations
A render of a work — first-class, owned, and listed in the Animate tab.

```sql
CREATE TABLE animations (
  id         TEXT PRIMARY KEY,
  work_id    TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  owner_id   TEXT NOT NULL REFERENCES users(id),
  style      TEXT NOT NULL CHECK (style IN ('kenburns','video','cartoon')),
             -- kenburns: pan/zoom motion comic (either kind)
             -- video:    image-to-video clips per scene (either kind)
             -- cartoon:  lip-synced characters (plays only)
  status     TEXT NOT NULL CHECK (status IN ('draft','rendering','ready','failed')),
  video_url  TEXT,                        -- R2: final export (feeds social sharing)
  created_at INTEGER NOT NULL
);

CREATE TABLE animation_clips (
  id           TEXT PRIMARY KEY,
  animation_id TEXT NOT NULL REFERENCES animations(id) ON DELETE CASCADE,
  scene_id     TEXT NOT NULL REFERENCES scenes(id),
  idx          INTEGER NOT NULL,
  clip_url     TEXT,                      -- R2
  start_ms     INTEGER,                   -- position on the narration timeline
  end_ms       INTEGER,
  status       TEXT NOT NULL DEFAULT 'pending',
  UNIQUE (animation_id, idx)
);
```

Animations **reference** the work's scenes via clips — they never copy them.
Ten renders of one work share the same scene data.

---

## 3. Relationship map

```
users ─┬─ voices ◄──── characters ─┐
       ├─ characters               ├─ work_characters ─┐
       ├─ settings ◄───────────────┼───────────────────┤
       ├─ works ───────────────────┘     work_emotions ┤
       └─ animations ─ animation_clips ─┐              │
                                        ▼              ▼
                          scenes ◄───────────────── works ──► narrations
                             └─ scene_lines            (work × voice × language)
```

---

## 4. The interchange JSON (scene script)

The canonical structure Claude outputs on generation and every consumer
reads. Replaces the `story|narration|imagePrompt` string split. Persisting it
= inserting the rows above.

```json
{
  "kind": "play",
  "title": "Roxy's Icy Adventure",
  "genre": "adventure",
  "language": "en",
  "length": "short",
  "emotions": ["happy", "cozy"],
  "setting": { "name": "Frozen forest", "visual_prompt": "snow-laden pines, soft dusk light" },
  "characters": [
    { "name": "Roxy", "traits": "brave, curious rhino", "visual_prompt": "small grey rhino, red scarf" },
    { "name": "Milo", "traits": "timid mouse", "visual_prompt": "white mouse, blue mittens" }
  ],
  "scenes": [
    {
      "display_text": "Roxy stood at the foot of the icy hill.",
      "narration_text": "[gentle] Roxy stood at the foot of the icy hill.",
      "image_prompt": "rhino gazing up an icy hill at dusk, storybook watercolor",
      "music_mood": "adventurous",
      "lines": [
        { "speaker": "Roxy", "text": "I can do it!", "emotion": "determined", "direction": "(stamps her feet)" },
        { "speaker": null,   "text": "And up she went.", "emotion": "calm" }
      ]
    }
  ]
}
```

For `kind: "story"`, `characters` may be empty and `lines` may be omitted —
`narration_text` carries the whole scene.

---

## 5. Feature → query map

| Feature | Query |
|---|---|
| Library: filter by genre | `works.genre = :g` |
| Library: filter by user | `works.owner_id = :u` |
| Library: Lisa's | `works.owner_id = 'lisa'` |
| Library: Story / Play chip | `works.kind = :k` |
| Library: by character | join `work_characters` on `character_id` |
| Library: sad / happy | join `work_emotions` on `emotion` |
| "Hear this voice" previews | `voices.preview_audio_url` |
| Language voice bank | voice resolution rule (§2 voices) |
| Replay without credits | `narrations` cache hit |
| Word highlight / subtitles / scene sync | `narrations.timestamps_json` |
| Promote story → play | Claude transform of the interchange JSON; same tables |
| Social sharing / OG pages | `works` public page + `animations.video_url` asset |

---

## 6. Migration & sequencing notes

1. **Existing content:** the 10 stories in `public/data/stories.json` become
   `works` rows (`kind='story'`, `owner_id='lisa'`, one scene per story or per
   paragraph); their covers in `public/images/covers/` move to R2 (or stay
   static and `cover_image_url` points at the existing path initially).
2. **Auth is the root.** `users` underpins ownership; build against the
   `lisa` system user until sign-up ships.
3. **Suggested build order:** D1 setup + this schema → migrate seed stories →
   works API (replaces stories.json fetch) → Library filters → Characters tab
   → Plays (create + radio-drama render) → Animate tab (kenburns → video →
   cartoon) → sharing/export.

## 7. Open questions (decide before building)

- Public/private visibility on `works` (needed for a shared Library and OG
  share pages): a `visibility` column — default private, `lisa` rows public?
- Play audio mixing: stitch per-line clips server-side into one `narrations`
  file, or play sequential clips client-side? (Server-side stitch is simpler
  for replay + export; start there.)
- Do generated illustrations belong per-scene from day one (they do for
  animation), and is gpt-image-2 or Higgsfield Soul the default per-scene
  engine given character reference support?
