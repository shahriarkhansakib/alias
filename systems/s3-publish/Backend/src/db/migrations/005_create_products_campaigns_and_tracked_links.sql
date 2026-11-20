-- Migration 005: Create products, campaigns, tracked links, and click events for Phase 1 click tracking
-- WARNING: Do not run directly; run via migration runner in controlled deployment.
-- NOTE: Unexecuted for Phase 1 code-only implementation.

CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    destination_url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);

CREATE TABLE IF NOT EXISTS campaigns (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id VARCHAR(255) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_product_id ON campaigns(product_id);

CREATE TABLE IF NOT EXISTS tracked_links (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id VARCHAR(255) NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    product_id VARCHAR(255) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    slug VARCHAR(64) UNIQUE NOT NULL,
    destination_url TEXT NOT NULL,
    label VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tracked_links_user_id ON tracked_links(user_id);
CREATE INDEX IF NOT EXISTS idx_tracked_links_campaign_id ON tracked_links(campaign_id);
CREATE INDEX IF NOT EXISTS idx_tracked_links_slug ON tracked_links(slug);

CREATE TABLE IF NOT EXISTS tracked_link_clicks (
    id VARCHAR(255) PRIMARY KEY,
    link_id VARCHAR(255) NOT NULL REFERENCES tracked_links(id) ON DELETE CASCADE,
    campaign_id VARCHAR(255) NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    product_id VARCHAR(255) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_bot BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tracked_clicks_user_link ON tracked_link_clicks(user_id, link_id);
CREATE INDEX IF NOT EXISTS idx_tracked_clicks_user_campaign ON tracked_link_clicks(user_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_tracked_clicks_is_bot ON tracked_link_clicks(is_bot);
