-- LISA 1000 schema v1 — see docs/SCHEMA.md for the full design rationale.
-- Apply with: npx wrangler d1 migrations apply lisa1000

CREATE TABLE users (
    id          TEXT PRIMARY KEY,
    handle      TEXT UNIQUE NOT NULL,
    email       TEXT UNIQUE,
    created_at  INTEGER NOT NULL
);

CREATE TABLE voices (
    voice_id           TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    provider           TEXT NOT NULL DEFAULT 'elevenlabs',
    owner_id           TEXT REFERENCES users(id),
    language           TEXT,
    is_cloned          INTEGER NOT NULL DEFAULT 0,
    preview_audio_url  TEXT,
    created_at         INTEGER NOT NULL
);

CREATE TABLE emotions (
    name   TEXT PRIMARY KEY,
    emoji  TEXT
);

CREATE TABLE characters (
    id            TEXT PRIMARY KEY,
    owner_id      TEXT NOT NULL REFERENCES users(id),
    name          TEXT NOT NULL,
    traits        TEXT,
    backstory     TEXT,
    visual_prompt TEXT,
    portrait_url  TEXT,
    voice_id      TEXT REFERENCES voices(voice_id),
    created_at    INTEGER NOT NULL
);

CREATE TABLE settings (
    id            TEXT PRIMARY KEY,
    owner_id      TEXT NOT NULL REFERENCES users(id),
    name          TEXT NOT NULL,
    description   TEXT,
    visual_prompt TEXT,
    image_url     TEXT,
    created_at    INTEGER NOT NULL
);

CREATE TABLE works (
    id              TEXT PRIMARY KEY,
    owner_id        TEXT NOT NULL REFERENCES users(id),
    kind            TEXT NOT NULL CHECK (kind IN ('story','play')),
    title           TEXT NOT NULL,
    genre           TEXT,
    language        TEXT NOT NULL DEFAULT 'en',
    length          TEXT CHECK (length IN ('very_short','short','medium','long')),
    setting_id      TEXT REFERENCES settings(id),
    source          TEXT NOT NULL CHECK (source IN ('lisa','user')),
    cover_image_url TEXT,
    created_at      INTEGER NOT NULL
);

CREATE INDEX idx_works_owner ON works(owner_id);
CREATE INDEX idx_works_kind  ON works(kind);
CREATE INDEX idx_works_genre ON works(genre);

CREATE TABLE work_emotions (
    work_id  TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    emotion  TEXT NOT NULL REFERENCES emotions(name),
    PRIMARY KEY (work_id, emotion)
);

CREATE TABLE work_characters (
    work_id      TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    character_id TEXT NOT NULL REFERENCES characters(id),
    role         TEXT,
    PRIMARY KEY (work_id, character_id)
);

CREATE TABLE scenes (
    id             TEXT PRIMARY KEY,
    work_id        TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    idx            INTEGER NOT NULL,
    display_text   TEXT NOT NULL,
    narration_text TEXT,
    image_prompt   TEXT,
    image_url      TEXT,
    music_mood     TEXT,
    UNIQUE (work_id, idx)
);

CREATE TABLE scene_lines (
    id           TEXT PRIMARY KEY,
    scene_id     TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    idx          INTEGER NOT NULL,
    character_id TEXT REFERENCES characters(id),
    text         TEXT NOT NULL,
    emotion      TEXT REFERENCES emotions(name),
    direction    TEXT,
    UNIQUE (scene_id, idx)
);

CREATE TABLE narrations (
    id              TEXT PRIMARY KEY,
    work_id         TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    voice_id        TEXT REFERENCES voices(voice_id),
    language        TEXT NOT NULL,
    audio_url       TEXT NOT NULL,
    timestamps_json TEXT,
    created_at      INTEGER NOT NULL,
    UNIQUE (work_id, voice_id, language)
);

CREATE TABLE animations (
    id         TEXT PRIMARY KEY,
    work_id    TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    owner_id   TEXT NOT NULL REFERENCES users(id),
    style      TEXT NOT NULL CHECK (style IN ('kenburns','video','cartoon')),
    status     TEXT NOT NULL CHECK (status IN ('draft','rendering','ready','failed')),
    video_url  TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE animation_clips (
    id           TEXT PRIMARY KEY,
    animation_id TEXT NOT NULL REFERENCES animations(id) ON DELETE CASCADE,
    scene_id     TEXT NOT NULL REFERENCES scenes(id),
    idx          INTEGER NOT NULL,
    clip_url     TEXT,
    start_ms     INTEGER,
    end_ms       INTEGER,
    status       TEXT NOT NULL DEFAULT 'pending',
    UNIQUE (animation_id, idx)
);

-- ---------- Vocabulary + system seeds ----------

INSERT INTO users (id, handle, email, created_at) VALUES
    ('lisa', 'lisa', NULL, 1752624000);

INSERT INTO emotions (name, emoji) VALUES
    ('happy',    '😊'),
    ('sad',      '😢'),
    ('inspired', '🌟'),
    ('cozy',     '🕯️'),
    ('scary',    '👻'),
    ('funny',    '😄'),
    ('calm',     '🌙'),
    ('excited',  '⚡');

INSERT INTO voices (voice_id, name, provider, owner_id, language, is_cloned, preview_audio_url, created_at) VALUES
    ('kv1Qe4fUcVPEC2ZisX5i', 'Lisa', 'elevenlabs', NULL, NULL, 1, NULL, 1752624000),
    ('IRHApOXLvnW57QJPQH2P', 'Adam', 'elevenlabs', NULL, NULL, 1, NULL, 1752624000);
