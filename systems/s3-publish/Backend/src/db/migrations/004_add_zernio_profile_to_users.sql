-- Migration 004: Add zernio_profile_id to users for multi-tenant profile mapping
-- WARNING: Do not run directly; run via migration runner in controlled deployment.
-- NOTE: Unexecuted for Phase 2 code-only implementation.

ALTER TABLE users ADD COLUMN IF NOT EXISTS zernio_profile_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_users_zernio_profile_id ON users(zernio_profile_id);
