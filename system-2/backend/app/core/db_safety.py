"""
Comprehensive PostgreSQL Infrastructure Validation & Safety Guardrails.

Provides:
1. Robust, structured URL normalization for async SQLAlchemy engines (asyncpg):
   - Protocol translation ('postgres://' and 'postgresql://' -> 'postgresql+asyncpg://')
   - Safe parameter translation ('sslmode=require' -> 'ssl=require', 'sslmode=verify-full' -> 'ssl=verify-full')
   - Preservation of URL-encoded passwords and complex query parameters
2. Safe URL masking for terminal, log, and report outputs (preventing credential leakage)
3. Multi-layer security guardrails strictly forbidding destructive migration/test operations
   against non-disposable or production databases.
"""

import os
import re
from typing import Dict, Any, Optional, Set
from urllib.parse import urlsplit, parse_qsl, urlencode, urlunsplit, unquote
from sqlalchemy.engine.url import make_url


# Protected database keywords (secondary defense layer)
PROTECTED_DATABASE_KEYWORDS: Set[str] = {
    "prod",
    "production",
    "live",
    "main",
    "master",
    "primary",
    "stage",
    "staging",
}

# Approved test host suffixes and exact hosts
DEFAULT_APPROVED_TEST_HOST_PATTERNS: Set[str] = {
    "localhost",
    "127.0.0.1",
    "::1",
    "neon.tech",
    "supabase.co",
    "supabase.in",
}


def normalize_async_db_url(url: str) -> str:
    """
    Normalizes database connection URLs for SQLAlchemy async engines (asyncpg / aiosqlite):
    1. Ensures 'postgresql+asyncpg://' driver prefix for PostgreSQL URLs.
    2. Ensures 'sqlite+aiosqlite://' driver prefix for SQLite URLs while preserving triple slashes.
    3. Translates libpq query parameters like '?sslmode=require' to asyncpg '?ssl=require'
       using structured URL parsing (preserving URL-encoded passwords and other query arguments).
    """
    if not url or not str(url).strip():
        return ""
    clean_url = url.strip()

    # Handle SQLite URLs safely without breaking triple slashes
    if clean_url.lower().startswith("sqlite"):
        if clean_url.lower().startswith("sqlite://") and not clean_url.lower().startswith("sqlite+aiosqlite://"):
            return "sqlite+aiosqlite://" + clean_url[len("sqlite://"):]
        return clean_url

    # Handle PostgreSQL driver prefix
    if clean_url.lower().startswith("postgres://"):
        prefix = "postgresql+asyncpg://"
        rest = clean_url[len("postgres://"):]
    elif clean_url.lower().startswith("postgresql://") and not clean_url.lower().startswith("postgresql+asyncpg://"):
        prefix = "postgresql+asyncpg://"
        rest = clean_url[len("postgresql://"):]
    elif clean_url.lower().startswith("postgresql+asyncpg://"):
        prefix = "postgresql+asyncpg://"
        rest = clean_url[len("postgresql+asyncpg://"):]
    else:
        return clean_url

    # Parse rest using dummy scheme to preserve netloc/path/query structure
    dummy = "http://" + rest
    parsed = urlsplit(dummy)
    query_params = parse_qsl(parsed.query, keep_blank_values=True)
    new_query_params = []
    for key, val in query_params:
        if key.lower() == "sslmode":
            new_query_params.append(("ssl", val))
        else:
            new_query_params.append((key, val))

    new_query = urlencode(new_query_params)
    query_str = f"?{new_query}" if new_query else ""
    frag_str = f"#{parsed.fragment}" if parsed.fragment else ""
    return f"{prefix}{parsed.netloc}{parsed.path}{query_str}{frag_str}"


def mask_db_url(url: str) -> str:
    """
    Renders a database URL with passwords and sensitive credentials safely masked with '***'.
    Safe for terminal, log, and report output.
    """
    if not url or not str(url).strip():
        return "<empty>"
    try:
        parsed = make_url(url)
        return parsed.render_as_string(hide_password=True)
    except Exception:
        # Fallback regex masking for non-standard or malformed URLs
        return re.sub(r"://([^:]+):([^@]+)@", r"://\1:***@", url)


def assert_destructive_safety_or_raise(
    url: str,
    operation_name: str = "destructive database operation",
) -> Dict[str, Any]:
    """
    CRITICAL SECURITY BARRIER: Enforces ALL required safety checks immediately before
    executing any destructive operation (e.g. migration downgrade, drop table, truncate).

    Must pass all 7 checkpoints:
    1. Database URL must be non-empty and target PostgreSQL. SQLite is strictly rejected.
    2. ENVIRONMENT must NOT be 'production'.
    3. Explicit disposable-database confirmation must be present:
       CONFIRM_DISPOSABLE_DATABASE=true or ALLOW_DESTRUCTIVE_POSTGRES_TESTS=true.
    4. Database name must match EXPECTED_POSTGRES_TEST_DB if configured.
    5. Database name must NOT contain any protected keyword (prod, live, stage, etc.).
    6. Database name must NOT be default admin database 'postgres' or empty.
    7. Host must match EXPECTED_POSTGRES_TEST_HOST if configured, or be in approved host patterns.
    """
    if not url or not str(url).strip():
        raise ValueError(f"SAFETY VIOLATION: Database URL is required for {operation_name}.")

    normalized = normalize_async_db_url(url)

    # 1. SQLite Rejection
    if normalized.lower().startswith("sqlite"):
        raise ValueError(
            f"SAFETY VIOLATION: SQLite database URL rejected for {operation_name}. "
            "Stage 1 requires an explicitly configured, disposable PostgreSQL database."
        )
    if not normalized.lower().startswith("postgresql"):
        raise ValueError(f"SAFETY VIOLATION: Expected PostgreSQL URL, received: {normalized.split('://')[0]}://...")

    try:
        parsed = make_url(normalized)
    except Exception as e:
        raise ValueError(f"SAFETY VIOLATION: Failed to parse PostgreSQL URL: {e}")

    # 2. Environment Guard
    current_env = os.getenv("ENVIRONMENT", "").lower().strip()
    if current_env == "production":
        raise ValueError(
            f"SAFETY VIOLATION: ENVIRONMENT is set to 'production'. "
            f"{operation_name.capitalize()} is strictly prohibited in production."
        )

    # 3. Explicit Disposable Confirmation Barrier
    confirm_flag = (
        os.getenv("CONFIRM_DISPOSABLE_DATABASE", "").lower().strip() in ("true", "1", "yes")
        or os.getenv("ALLOW_DESTRUCTIVE_POSTGRES_TESTS", "").lower().strip() in ("true", "1", "yes")
    )
    if not confirm_flag:
        raise ValueError(
            f"SAFETY VIOLATION: {operation_name.capitalize()} blocked. "
            "Requires explicit confirmation via environment variable: "
            "CONFIRM_DISPOSABLE_DATABASE=true or ALLOW_DESTRUCTIVE_POSTGRES_TESTS=true."
        )

    # 4 & 5 & 6. Database Name Invariants
    db_name = (parsed.database or "").strip()
    if not db_name:
        raise ValueError(f"SAFETY VIOLATION: Target PostgreSQL URL lacks a database name.")
    if db_name.lower() == "postgres":
        raise ValueError(
            f"SAFETY VIOLATION: Target database name is the default root admin database ('postgres'). "
            "Destructive testing requires a dedicated, isolated disposable database (e.g. 'alias_test_disposable')."
        )

    expected_db = os.getenv("EXPECTED_POSTGRES_TEST_DB", "").strip()
    if expected_db and db_name != expected_db:
        raise ValueError(
            f"SAFETY VIOLATION: Target database name '{db_name}' does not match "
            f"explicitly configured EXPECTED_POSTGRES_TEST_DB='{expected_db}'."
        )

    db_name_lower = db_name.lower()
    for kw in PROTECTED_DATABASE_KEYWORDS:
        if kw in db_name_lower:
            raise ValueError(
                f"SAFETY VIOLATION: Target database name '{db_name}' contains protected keyword '{kw}'. "
                "Destructive operations are strictly prohibited."
            )

    # 7. Host Invariants
    host_name = (parsed.host or "").strip().lower()
    if not host_name:
        raise ValueError(f"SAFETY VIOLATION: Target PostgreSQL URL lacks a host.")

    expected_host = os.getenv("EXPECTED_POSTGRES_TEST_HOST", "").strip().lower()
    if expected_host:
        if host_name != expected_host:
            raise ValueError(
                f"SAFETY VIOLATION: Target host '{host_name}' does not match "
                f"explicitly configured EXPECTED_POSTGRES_TEST_HOST='{expected_host}'."
            )
    else:
        # Check against approved provider hosts or custom whitelist
        custom_whitelist_str = os.getenv("ALLOWED_POSTGRES_TEST_HOSTS", "").strip()
        custom_whitelist = {h.strip().lower() for h in custom_whitelist_str.split(",") if h.strip()}

        allowed_host = False
        if host_name in DEFAULT_APPROVED_TEST_HOST_PATTERNS or host_name in custom_whitelist:
            allowed_host = True
        else:
            for pattern in DEFAULT_APPROVED_TEST_HOST_PATTERNS:
                if host_name.endswith(f".{pattern}"):
                    allowed_host = True
                    break
            if not allowed_host:
                for custom_pattern in custom_whitelist:
                    if host_name.endswith(f".{custom_pattern}") or host_name == custom_pattern:
                        allowed_host = True
                        break

        if not allowed_host:
            raise ValueError(
                f"SAFETY VIOLATION: Host '{host_name}' is not in the approved test host whitelist "
                f"({', '.join(sorted(DEFAULT_APPROVED_TEST_HOST_PATTERNS))}). "
                "Set EXPECTED_POSTGRES_TEST_HOST or ALLOWED_POSTGRES_TEST_HOSTS to authorize this host."
            )

    for kw in ["prod", "production", "live"]:
        if kw in host_name and not host_name.endswith(".neon.tech") and not host_name.endswith(".supabase.co"):
            raise ValueError(f"SAFETY VIOLATION: Host '{host_name}' contains protected keyword '{kw}'.")

    return {
        "normalized_url": normalized,
        "masked_url": mask_db_url(normalized),
        "database": db_name,
        "host": host_name,
        "port": parsed.port or 5432,
        "ssl_configured": "ssl=" in normalized,
        "is_disposable_confirmed": True,
    }


def validate_disposable_postgres_url(
    url: str,
    allow_destructive: bool = False,
    operation_name: str = "database operation",
) -> Dict[str, Any]:
    """
    Validates a PostgreSQL URL for testing.
    If allow_destructive is True, delegates to assert_destructive_safety_or_raise().
    If allow_destructive is False, performs read-only preflight validation.
    """
    if allow_destructive:
        return assert_destructive_safety_or_raise(url, operation_name=operation_name)

    if not url or not str(url).strip():
        raise ValueError("Database URL is required and cannot be empty.")

    normalized = normalize_async_db_url(url)
    if not normalized.lower().startswith("postgresql"):
        raise ValueError(f"Expected PostgreSQL URL, received: {normalized.split('://')[0]}://...")

    try:
        parsed = make_url(normalized)
    except Exception as e:
        raise ValueError(f"Failed to parse PostgreSQL URL: {e}")

    db_name = (parsed.database or "").strip().lower()
    host_name = (parsed.host or "").strip().lower()

    # Read-only preflight checks: warn on protected keywords
    for kw in PROTECTED_DATABASE_KEYWORDS:
        if kw in db_name:
            raise ValueError(f"SAFETY WARNING: Database name '{db_name}' contains protected keyword '{kw}'.")

    return {
        "normalized_url": normalized,
        "masked_url": mask_db_url(normalized),
        "database": parsed.database,
        "host": parsed.host,
        "port": parsed.port or 5432,
        "ssl_configured": "ssl=" in normalized,
        "is_disposable_confirmed": False,
    }
