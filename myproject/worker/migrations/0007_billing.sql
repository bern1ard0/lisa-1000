-- Billing: Stripe subscriptions (premium = unlimited generations) plus the
-- free-tier usage meter. Additive only — no existing tables change.

-- One Stripe customer per user, created lazily on first checkout/portal call.
CREATE TABLE billing_customers (
    user_id            TEXT PRIMARY KEY REFERENCES users(id),
    stripe_customer_id TEXT UNIQUE NOT NULL,
    created_at         INTEGER NOT NULL
);

-- Mirror of the Stripe subscription state, kept fresh by webhook events.
CREATE TABLE subscriptions (
    stripe_subscription_id TEXT PRIMARY KEY,
    user_id                TEXT NOT NULL REFERENCES users(id),
    status                 TEXT NOT NULL,          -- Stripe status: active, trialing, past_due, canceled, ...
    price_id               TEXT,
    current_period_end     INTEGER,                -- unix epoch seconds
    cancel_at_period_end   INTEGER NOT NULL DEFAULT 0,
    updated_at             INTEGER NOT NULL
);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);

-- Upcoming-renewal reminders (from Stripe's invoice.upcoming webhook).
-- Feeds the in-app "your plan renews on ..." banner; `emailed` records
-- whether a Resend reminder email also went out. used_this_period/low_usage
-- capture how much the subscriber actually generated this billing period so
-- the reminder can suggest downgrading to credit packs when usage is low.
CREATE TABLE renewal_notices (
    id                     TEXT PRIMARY KEY,
    user_id                TEXT NOT NULL REFERENCES users(id),
    stripe_subscription_id TEXT NOT NULL,
    renewal_at             INTEGER NOT NULL,       -- unix epoch seconds
    amount_cents           INTEGER,
    currency               TEXT,
    notified_at            INTEGER NOT NULL,
    emailed                INTEGER NOT NULL DEFAULT 0,
    used_this_period       INTEGER,                -- story generations this billing period
    low_usage              INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_renewal_notices_user ON renewal_notices(user_id, renewal_at);

-- Credit packs (one-time Stripe payments). Balance = SUM(delta); a purchase
-- inserts +N, each metered generation past the free allowance inserts -1.
CREATE TABLE credit_ledger (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    delta      INTEGER NOT NULL,
    reason     TEXT NOT NULL CHECK (reason IN ('purchase','spend','grant')),
    stripe_ref TEXT,                               -- checkout session / payment intent id
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_credit_ledger_user ON credit_ledger(user_id);

-- Free-tier meter: story generations per user per calendar month.
-- (user_events can't be reused — its CHECK constraint only allows
-- 'open'/'search'/'like' kinds.)
CREATE TABLE usage_counters (
    user_id TEXT NOT NULL REFERENCES users(id),
    month   TEXT NOT NULL,                         -- 'YYYY-MM' (UTC)
    stories INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, month)
);
