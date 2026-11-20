"""
Unit Tests for Database Safety Guardrails and URL Normalization.

Validates all 8 safety boundaries without connecting to any external network or database:
1. Rejection of destructive operations when ENVIRONMENT is 'production'.
2. Rejection when database name mismatches EXPECTED_POSTGRES_TEST_DB.
3. Rejection of protected database names (prod, live, stage, main, postgres root).
4. Rejection of unapproved hostnames not in whitelist.
5. Rejection when confirmation variable (CONFIRM_DISPOSABLE_DATABASE) is missing.
6. Rejection of SQLite URLs for PostgreSQL operations.
7. Secret masking across simple and complex URLs.
8. URL-encoded password and parameter integrity.
9. SSL URL normalization (sslmode=require -> ssl=require, sslmode=verify-full -> ssl=verify-full).
"""

import os
import pytest
from app.core.db_safety import (
    normalize_async_db_url,
    mask_db_url,
    assert_destructive_safety_or_raise,
    validate_disposable_postgres_url,
)


def test_ssl_url_normalization_standard_libpq():
    """Verify sslmode=require and sslmode=verify-full translate cleanly to asyncpg parameters."""
    u1 = "postgresql://user:pass@ep-cool-frog.neon.tech:5432/test_db?sslmode=require"
    norm1 = normalize_async_db_url(u1)
    assert norm1.startswith("postgresql+asyncpg://")
    assert "ssl=require" in norm1
    assert "sslmode" not in norm1

    u2 = "postgres://user:pass@db.supabase.co:5432/test_db?sslmode=verify-full&connect_timeout=10"
    norm2 = normalize_async_db_url(u2)
    assert norm2.startswith("postgresql+asyncpg://")
    assert "ssl=verify-full" in norm2
    assert "connect_timeout=10" in norm2
    assert "sslmode" not in norm2


def test_ssl_url_normalization_preserves_url_encoded_passwords():
    """Verify URL-encoded special characters in passwords are never corrupted by normalization."""
    raw = "postgresql://my_user:P%40ss%3Aw%2F%26ord%3D123@ep-test.neon.tech:5432/test_db?sslmode=require"
    norm = normalize_async_db_url(raw)
    assert "P%40ss%3Aw%2F%26ord%3D123" in norm
    assert "ssl=require" in norm


def test_secret_masking_hides_passwords():
    """Verify mask_db_url safely replaces credentials with ***."""
    url = "postgresql+asyncpg://admin_user:super_secret_password_999@ep-test.neon.tech:5432/my_test_db?ssl=require"
    masked = mask_db_url(url)
    assert "super_secret_password_999" not in masked
    assert "admin_user:***@" in masked
    assert "my_test_db" in masked


def test_destructive_safety_rejects_sqlite(monkeypatch):
    """Verify SQLite URLs are strictly rejected for destructive PostgreSQL operations."""
    monkeypatch.setenv("CONFIRM_DISPOSABLE_DATABASE", "true")
    monkeypatch.setenv("ENVIRONMENT", "development")

    with pytest.raises(ValueError, match="SQLite database URL rejected"):
        assert_destructive_safety_or_raise("sqlite+aiosqlite:///./test.db")


def test_destructive_safety_rejects_production_environment(monkeypatch):
    """Verify destructive operations are blocked when ENVIRONMENT is production."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("CONFIRM_DISPOSABLE_DATABASE", "true")

    with pytest.raises(ValueError, match="ENVIRONMENT is set to 'production'"):
        assert_destructive_safety_or_raise("postgresql://user:pass@localhost:5432/test_db")


def test_destructive_safety_rejects_missing_confirmation(monkeypatch):
    """Verify missing confirmation variable blocks destructive operations."""
    monkeypatch.delenv("CONFIRM_DISPOSABLE_DATABASE", raising=False)
    monkeypatch.delenv("ALLOW_DESTRUCTIVE_POSTGRES_TESTS", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "development")

    with pytest.raises(ValueError, match="Requires explicit confirmation via environment variable"):
        assert_destructive_safety_or_raise("postgresql://user:pass@localhost:5432/disposable_db")


def test_destructive_safety_rejects_protected_database_names(monkeypatch):
    """Verify protected names (prod, live, main, stage) and root 'postgres' are rejected."""
    monkeypatch.setenv("CONFIRM_DISPOSABLE_DATABASE", "true")
    monkeypatch.setenv("ENVIRONMENT", "development")

    protected_dbs = ["postgres", "production_app", "alias_prod", "live_data", "main_db", "staging_db"]
    for db in protected_dbs:
        with pytest.raises(ValueError, match="SAFETY VIOLATION"):
            assert_destructive_safety_or_raise(f"postgresql://user:pass@localhost:5432/{db}")


def test_destructive_safety_enforces_expected_database_name(monkeypatch):
    """Verify mismatch against EXPECTED_POSTGRES_TEST_DB is rejected."""
    monkeypatch.setenv("CONFIRM_DISPOSABLE_DATABASE", "true")
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("EXPECTED_POSTGRES_TEST_DB", "isolated_disposable_db")

    # Mismatched db name
    with pytest.raises(ValueError, match="does not match explicitly configured EXPECTED_POSTGRES_TEST_DB"):
        assert_destructive_safety_or_raise("postgresql://user:pass@localhost:5432/other_db")

    # Matching db name passes
    safety = assert_destructive_safety_or_raise("postgresql://user:pass@localhost:5432/isolated_disposable_db")
    assert safety["database"] == "isolated_disposable_db"


def test_destructive_safety_enforces_host_whitelist(monkeypatch):
    """Verify unapproved host is rejected unless in whitelist or EXPECTED_POSTGRES_TEST_HOST."""
    monkeypatch.setenv("CONFIRM_DISPOSABLE_DATABASE", "true")
    monkeypatch.setenv("ENVIRONMENT", "development")

    # Unapproved external host
    with pytest.raises(ValueError, match="Host 'unknown-corp-db.internal' is not in the approved test host whitelist"):
        assert_destructive_safety_or_raise("postgresql://user:pass@unknown-corp-db.internal:5432/disposable_test")

    # Approved Neon host passes
    s1 = assert_destructive_safety_or_raise("postgresql://user:pass@ep-cool.neon.tech:5432/disposable_test")
    assert s1["host"] == "ep-cool.neon.tech"

    # Approved Supabase host passes
    s2 = assert_destructive_safety_or_raise("postgresql://user:pass@db.xyz.supabase.co:5432/disposable_test")
    assert s2["host"] == "db.xyz.supabase.co"

    # Localhost passes
    s3 = assert_destructive_safety_or_raise("postgresql://user:pass@127.0.0.1:5432/disposable_test")
    assert s3["host"] == "127.0.0.1"


def test_destructive_safety_enforces_expected_host(monkeypatch):
    """Verify mismatch against EXPECTED_POSTGRES_TEST_HOST is rejected."""
    monkeypatch.setenv("CONFIRM_DISPOSABLE_DATABASE", "true")
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("EXPECTED_POSTGRES_TEST_HOST", "my-exact-sandbox.neon.tech")

    with pytest.raises(ValueError, match="does not match explicitly configured EXPECTED_POSTGRES_TEST_HOST"):
        assert_destructive_safety_or_raise("postgresql://user:pass@other-sandbox.neon.tech:5432/disposable_test")

