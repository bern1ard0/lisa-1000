ALTER TABLE works ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;

-- One reaction per user per work; flipping like<->dislike replaces the row.
CREATE TABLE work_reactions (
    work_id    TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id),
    reaction   TEXT NOT NULL CHECK (reaction IN ('like','dislike')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (work_id, user_id)
);

-- Lightweight signal log driving "recommended for you" (opens, searches, likes).
CREATE TABLE user_events (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    kind       TEXT NOT NULL CHECK (kind IN ('open','search','like')),
    work_id    TEXT REFERENCES works(id) ON DELETE CASCADE,
    query      TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_user_events_user ON user_events(user_id, created_at);
