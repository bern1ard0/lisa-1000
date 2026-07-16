ALTER TABLE works ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','unlisted','public'));

UPDATE works SET visibility = 'public' WHERE owner_id = 'lisa';

CREATE INDEX idx_works_visibility ON works(visibility);
