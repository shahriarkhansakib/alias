-- Migration 001: Create Post Identity Mapping and Analytics Tables

CREATE TABLE IF NOT EXISTS social_accounts (
    id VARCHAR(255) PRIMARY KEY,
    platform VARCHAR(50) NOT NULL,
    account_id VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
    id VARCHAR(255) PRIMARY KEY,
    idempotency_key VARCHAR(255) UNIQUE,
    caption TEXT,
    media_url TEXT,
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMPTZ,
    scheduled_for TIMESTAMPTZ,
    timezone VARCHAR(100),
    publish_now BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS post_platforms (
    id VARCHAR(255) PRIMARY KEY,
    post_id VARCHAR(255) NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    account_id VARCHAR(255),
    zernio_post_id VARCHAR(255),
    platform_post_id VARCHAR(255),
    platform_post_url TEXT,
    status VARCHAR(50) NOT NULL,
    published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id VARCHAR(255) PRIMARY KEY,
    post_platform_id VARCHAR(255) NOT NULL REFERENCES post_platforms(id) ON DELETE CASCADE,
    impressions BIGINT DEFAULT 0,
    reach BIGINT DEFAULT 0,
    likes BIGINT DEFAULT 0,
    comments BIGINT DEFAULT 0,
    shares BIGINT DEFAULT 0,
    saves BIGINT DEFAULT 0,
    clicks BIGINT DEFAULT 0,
    views BIGINT DEFAULT 0,
    engagement_rate DECIMAL(10, 4) DEFAULT 0,
    fetched_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS analytics_timeline (
    id VARCHAR(255) PRIMARY KEY,
    post_platform_id VARCHAR(255) NOT NULL REFERENCES post_platforms(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    impressions BIGINT DEFAULT 0,
    reach BIGINT DEFAULT 0,
    likes BIGINT DEFAULT 0,
    comments BIGINT DEFAULT 0,
    shares BIGINT DEFAULT 0,
    saves BIGINT DEFAULT 0,
    clicks BIGINT DEFAULT 0,
    views BIGINT DEFAULT 0,
    engagement_rate DECIMAL(10, 4) DEFAULT 0
);

-- Add updated_at to existing posts tables that were created before this column existed.
-- The IF NOT EXISTS guard on the column requires Postgres 9.6+; safe to run repeatedly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE posts ADD COLUMN updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
  END IF;
END $$;

-- Indexes for performance & identity resolution
CREATE INDEX IF NOT EXISTS idx_post_platforms_post_id ON post_platforms(post_id);
CREATE INDEX IF NOT EXISTS idx_post_platforms_zernio_post_id ON post_platforms(zernio_post_id);
CREATE INDEX IF NOT EXISTS idx_posts_idempotency_key ON posts(idempotency_key);
