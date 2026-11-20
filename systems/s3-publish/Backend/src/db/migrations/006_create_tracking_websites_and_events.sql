-- Migration 006: Create tracking_websites and tracking_website_events for Phase 2 website activity tracking
-- WARNING: Do not run directly; run via migration runner in controlled deployment.
-- NOTE: Unexecuted for Phase 2 code-only implementation. Provisional migration number for later friend-project merge.

CREATE TABLE IF NOT EXISTS tracking_websites (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    site_id VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    origin VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tracking_websites_user_id ON tracking_websites(user_id);
CREATE INDEX IF NOT EXISTS idx_tracking_websites_site_id ON tracking_websites(site_id);

CREATE TABLE IF NOT EXISTS tracking_website_events (
    id VARCHAR(255) PRIMARY KEY,
    website_id VARCHAR(255) NOT NULL REFERENCES tracking_websites(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_name VARCHAR(50) NOT NULL,
    event_id VARCHAR(64) NOT NULL,
    product_id VARCHAR(255) REFERENCES products(id) ON DELETE SET NULL,
    is_bot BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_website_event_id UNIQUE (website_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_website_events_user_site ON tracking_website_events(user_id, website_id);
CREATE INDEX IF NOT EXISTS idx_website_events_user_product ON tracking_website_events(user_id, product_id);
CREATE INDEX IF NOT EXISTS idx_website_events_is_bot ON tracking_website_events(is_bot);
