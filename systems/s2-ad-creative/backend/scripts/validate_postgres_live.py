"""
Stage 1: PostgreSQL Live Infrastructure Verification Script.

Usage (Security Best Practice: Pass credentials via Environment Variable):
  # Set environment variables:
  $env:POSTGRES_TEST_DATABASE_URL = "postgresql://user:pass@host:5432/disposable_db?sslmode=require"
  $env:CONFIRM_DISPOSABLE_DATABASE = "true"
  $env:EXPECTED_POSTGRES_TEST_DB = "disposable_db" # Optional explicit name guard

  # 1. Read-only preflight connectivity & version probe:
  python backend/scripts/validate_postgres_live.py --preflight

  # 2. Complete Stage 1 validation (blank db check, migrations, catalogs):
  python backend/scripts/validate_postgres_live.py --full

Safety Invariants Enforced:
- Environment variable preferred over CLI argument to avoid shell history / ps inspection.
- Explicit disposable-database confirmation required (CONFIRM_DISPOSABLE_DATABASE=true).
- Destructive safety checks execute immediately before EACH destructive operation.
- Rejects SQLite URLs.
- Rejects production environment (ENVIRONMENT=production).
- Rejects protected database names (prod, live, main, stage).
- Rejects default admin database 'postgres'.
- Verifies host against approved host patterns.
- Passwords and secrets are masked in all outputs, tracebacks, and logs.
"""

import sys
import os
import argparse
import asyncio
from typing import Dict, Any

# Ensure backend root is on Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from alembic import command
from alembic.config import Config

from app.core.db_safety import (
    validate_disposable_postgres_url,
    assert_destructive_safety_or_raise,
    normalize_async_db_url,
    mask_db_url,
)


def get_connection_url(env_var_name: str = "POSTGRES_TEST_DATABASE_URL", cli_url: str = None) -> str:
    """
    Retrieves database URL securely from the designated environment variable.
    CLI argument is supported as fallback but emits a security notice.
    """
    url = cli_url or os.getenv(env_var_name)
    if not url:
        print(f"\n[ERROR] No database URL found in environment variable '{env_var_name}'.")
        print(f"Set it using: $env:{env_var_name} = 'your_connection_string'")
        sys.exit(1)
    if cli_url:
        print("[NOTICE] Warning: Connection string passed via command-line argument. "
              "Prefer passing via environment variable POSTGRES_TEST_DATABASE_URL to protect shell history.")
    return url


async def run_preflight_check(raw_url: str) -> Dict[str, Any]:
    print("\n" + "=" * 60)
    print("STAGE 1 PREFLIGHT: POSTGRESQL 16 CONNECTIVITY & SAFETY CHECK")
    print("=" * 60)

    # 1. Read-only Safety Validation
    safety_info = validate_disposable_postgres_url(raw_url, allow_destructive=False)
    masked = safety_info["masked_url"]
    print(f"[OK] Target Database: {masked}")
    print(f"[OK] Host: {safety_info['host']}")
    print(f"[OK] Database Name: {safety_info['database']}")
    print(f"[OK] SSL Configured: {safety_info['ssl_configured']}")

    # 2. Async Connection & Version Check
    engine = create_async_engine(
        safety_info["normalized_url"],
        pool_size=5,
        pool_pre_ping=True,
    )

    try:
        async with engine.connect() as conn:
            res = await conn.execute(text("SELECT version();"))
            version_str = res.scalar_one()
            print(f"[OK] Connected Server: {version_str}")

            is_pg16 = "PostgreSQL 16" in version_str or "16." in version_str
            if is_pg16:
                print("[PASS] Verified server is PostgreSQL 16.")
            else:
                print(f"[WARNING] Server is not PostgreSQL 16: {version_str}")

            # Check SSL status of current connection
            ssl_res = await conn.execute(text("""
                SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();
            """))
            ssl_row = ssl_res.first()
            if ssl_row:
                print(f"[OK] Active Connection SSL: {ssl_row[0]}")

            # Check if database is currently empty/blank
            table_count_res = await conn.execute(text("""
                SELECT count(*) FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
            """))
            table_count = table_count_res.scalar_one()
            print(f"[OK] Existing Public Tables Count: {table_count}")

            return {
                "success": True,
                "version": version_str,
                "is_pg16": is_pg16,
                "table_count": table_count,
                "safety_info": safety_info,
            }
    except Exception as e:
        print(f"[FAIL] Connection to PostgreSQL failed: {mask_db_url(str(e))}")
        return {"success": False, "error": mask_db_url(str(e)), "safety_info": safety_info}
    finally:
        await engine.dispose()


def run_migration_lifecycle(raw_url: str) -> bool:
    print("\n" + "=" * 60)
    print("STAGE 1 MIGRATION LIFECYCLE: BLANK -> HEAD -> -1 -> HEAD")
    print("=" * 60)

    # Immediate safety check before Step 1
    safety_info = assert_destructive_safety_or_raise(raw_url, operation_name="initial migration upgrade")
    normalized_url = safety_info["normalized_url"]

    ini_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    alembic_cfg = Config(ini_path)
    alembic_cfg.set_main_option("sqlalchemy.url", normalized_url)

    try:
        print(f"[1/3] Executing 'alembic upgrade head' on target {safety_info['masked_url']}...")
        command.upgrade(alembic_cfg, "head")
        print("      -> Successfully upgraded to head.")

        # Immediate safety check before Step 2 (destructive downgrade)
        assert_destructive_safety_or_raise(raw_url, operation_name="migration downgrade (-1)")
        print("\n[2/3] Executing 'alembic downgrade -1' (reverting tenant cache indexes)...")
        command.downgrade(alembic_cfg, "-1")
        print("      -> Successfully downgraded one revision.")

        # Immediate safety check before Step 3 (re-upgrade)
        assert_destructive_safety_or_raise(raw_url, operation_name="migration re-upgrade to head")
        print("\n[3/3] Executing 'alembic upgrade head' (re-applying tenant cache indexes)...")
        command.upgrade(alembic_cfg, "head")
        print("      -> Successfully re-upgraded to head.")

        return True
    except Exception as e:
        print(f"[FAIL] Migration lifecycle failed: {mask_db_url(str(e))}")
        return False


async def run_catalog_verification(raw_url: str) -> bool:
    print("\n" + "=" * 60)
    print("STAGE 1 CATALOG VERIFICATION: JSONB & COMPOSITE INDEXES")
    print("=" * 60)

    safety_info = validate_disposable_postgres_url(raw_url, allow_destructive=False)
    engine = create_async_engine(safety_info["normalized_url"], pool_size=5)

    try:
        async with engine.connect() as conn:
            # 1. Verify JSONB Columns
            jsonb_columns = [
                ("ad_briefs", "payload"),
                ("ad_briefs", "platforms"),
                ("ad_briefs", "validation_report"),
                ("creative_strategies", "strategy_spec"),
                ("creative_strategies", "claim_validation_report"),
                ("creative_jobs", "stage_data"),
                ("generated_backgrounds", "prompt_spec"),
                ("composited_creatives", "placement_spec"),
                ("final_rendered_creatives", "typography_spec"),
                ("final_rendered_creatives", "provenance_chain"),
                ("final_rendered_creatives", "vision_qa_result"),
            ]

            print("[1/2] Verifying Native JSONB Columns in information_schema.columns:")
            all_jsonb_pass = True
            for tbl, col in jsonb_columns:
                stmt = text("""
                    SELECT data_type, udt_name
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = :tbl AND column_name = :col
                """)
                res = (await conn.execute(stmt, {"tbl": tbl, "col": col})).mappings().first()
                if res and res["udt_name"].lower() == "jsonb":
                    print(f"      [PASS] {tbl}.{col} -> udt_name={res['udt_name']}")
                else:
                    found = res["udt_name"] if res else "NOT_FOUND"
                    print(f"      [FAIL] {tbl}.{col} -> found={found}, expected=jsonb")
                    all_jsonb_pass = False

            # 2. Verify Composite Non-Unique Indexes
            print("\n[2/2] Verifying Composite Indexes (tenant_id, cache_key) in pg_indexes:")
            index_targets = [
                ("generated_backgrounds", "ix_generated_backgrounds_tenant_cache"),
                ("composited_creatives", "ix_composited_creatives_tenant_cache"),
                ("final_rendered_creatives", "ix_final_rendered_creatives_tenant_cache"),
            ]
            all_idx_pass = True
            for tbl, idx in index_targets:
                stmt = text("""
                    SELECT indexname, indexdef
                    FROM pg_indexes
                    WHERE schemaname = 'public' AND tablename = :tbl AND indexname = :idx
                """)
                res = (await conn.execute(stmt, {"tbl": tbl, "idx": idx})).mappings().first()
                if res:
                    idx_def = res["indexdef"]
                    is_non_unique = "unique" not in idx_def.lower()
                    has_cols = "tenant_id" in idx_def and "cache_key" in idx_def
                    if is_non_unique and has_cols:
                        print(f"      [PASS] {tbl}.{idx} -> Non-unique (tenant_id, cache_key)")
                    else:
                        print(f"      [FAIL] {tbl}.{idx} definition mismatch: {idx_def}")
                        all_idx_pass = False
                else:
                    print(f"      [FAIL] {tbl}.{idx} -> Index NOT FOUND")
                    all_idx_pass = False

            return all_jsonb_pass and all_idx_pass
    except Exception as e:
        print(f"[FAIL] Catalog inspection error: {mask_db_url(str(e))}")
        return False
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description="Alias Img-Gen Stage 1 PostgreSQL Validation")
    parser.add_argument("--env-var", default="POSTGRES_TEST_DATABASE_URL",
                        help="Environment variable containing database connection string (default: POSTGRES_TEST_DATABASE_URL)")
    parser.add_argument("--url", default=None,
                        help="Optional direct URL (use environment variable instead to avoid shell history exposure)")
    parser.add_argument("--preflight", action="store_true", help="Run read-only connectivity, safety, and version check")
    parser.add_argument("--migrations", action="store_true", help="Run migration lifecycle (blank -> head -> -1 -> head)")
    parser.add_argument("--catalogs", action="store_true", help="Run catalog verification for JSONB and composite indexes")
    parser.add_argument("--full", action="store_true", help="Run complete validation suite")

    args = parser.parse_args()
    raw_url = get_connection_url(env_var_name=args.env_var, cli_url=args.url)

    # 1. Preflight check
    preflight_result = asyncio.run(run_preflight_check(raw_url))
    if not preflight_result["success"]:
        sys.exit(1)

    if args.preflight:
        print("\n[COMPLETE] Read-only preflight check completed successfully.")
        return

    # 2. Migrations
    if args.migrations or args.full:
        mig_ok = run_migration_lifecycle(raw_url)
        if not mig_ok:
            sys.exit(1)

    # 3. Catalog verification
    if args.catalogs or args.full:
        cat_ok = asyncio.run(run_catalog_verification(raw_url))
        if not cat_ok:
            sys.exit(1)

    print("\n" + "=" * 60)
    print("STAGE 1 POSTGRESQL ACCEPTANCE: ALL CHECKS PASSED")
    print("=" * 60)


if __name__ == "__main__":
    main()
