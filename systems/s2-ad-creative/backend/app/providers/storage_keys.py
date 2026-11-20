"""
Deterministic, collision-resistant object storage key validation and builders.
Enforces logical namespacing, prevents arbitrary path injection, and guarantees
safe lifecycle management across local filesystem and S3/R2 object stores.
Provides multi-tenant namespace isolation under tenants/{tenant_id}/...
"""

import re
import urllib.parse
from typing import Optional


SAFE_KEY_PATTERN = re.compile(r"^[a-zA-Z0-9_\-\./]+$")


def validate_storage_key(key: str) -> str:
    """
    Validates that a storage key conforms to strict object key safety rules:
    - Must be a non-empty string.
    - No backslashes ('\\' is prohibited; use standard '/' object delimiters).
    - No path traversal ('..' anywhere).
    - No Windows or POSIX root indicators (leading '/', drive letters like 'C:').
    - No percent-encoded traversal characters (%2e%2e, %2f, %5c).
    - No null bytes or control characters.
    - Only safe characters: [a-zA-Z0-9_\\-\\./].
    """
    if not key or not isinstance(key, str):
        raise ValueError("Storage key must be a non-empty string.")

    if "\x00" in key:
        raise ValueError("Storage key cannot contain null bytes.")

    if "\\" in key:
        raise ValueError(f"Backslash path separators are prohibited in object keys: {key}")

    # Check for percent-encoded traversal
    unquoted = urllib.parse.unquote(key)
    if unquoted != key:
        if ".." in unquoted or "/" in unquoted or "\\" in unquoted:
            if "%" in key:
                raise ValueError(f"Percent-encoded traversal detected in key: {key}")

    if key.startswith("/") or re.match(r"^[a-zA-Z]:", key):
        raise ValueError(f"Absolute storage paths are prohibited: {key}")

    if not SAFE_KEY_PATTERN.match(key):
        raise ValueError(f"Storage key contains invalid characters: {key}")

    parts = key.split("/")
    for i, part in enumerate(parts):
        if part in ("..", ".") or not part:
            if not part and i == len(parts) - 1:
                raise ValueError("Storage key cannot end with a trailing slash.")
            raise ValueError(f"Path traversal or empty segment detected in key: {key}")

    return key


def extract_tenant_from_storage_key(key: str) -> Optional[str]:
    """
    Extracts the tenant identifier from a tenant-namespaced storage key.
    Returns None if key is not tenant-namespaced (e.g. demo fixtures).
    """
    clean = key.strip("/").replace("\\", "/")
    parts = clean.split("/")
    if len(parts) >= 2 and parts[0] == "tenants":
        return parts[1]
    return None


def build_background_key(
    job_id: str,
    platform: str,
    attempt: int,
    content_hash: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> str:
    hash_suffix = f"_{content_hash[:16]}" if content_hash else ""
    prefix = f"tenants/{tenant_id}/" if tenant_id else ""
    raw_key = f"{prefix}backgrounds/{job_id}/{platform}_attempt_{attempt}{hash_suffix}.png"
    return validate_storage_key(raw_key)


def build_cutout_key(
    job_id: str,
    content_hash: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> str:
    hash_suffix = f"_{content_hash[:16]}" if content_hash else ""
    prefix = f"tenants/{tenant_id}/" if tenant_id else ""
    raw_key = f"{prefix}cutouts/{job_id}/product_cutout{hash_suffix}.png"
    return validate_storage_key(raw_key)


def build_composite_key(
    job_id: str,
    platform: str,
    attempt: int,
    content_hash: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> str:
    hash_suffix = f"_{content_hash[:16]}" if content_hash else ""
    prefix = f"tenants/{tenant_id}/" if tenant_id else ""
    raw_key = f"{prefix}composites/{job_id}/{platform}_attempt_{attempt}{hash_suffix}.png"
    return validate_storage_key(raw_key)


def build_final_ad_key(
    job_id: str,
    platform: str,
    attempt: int,
    content_hash: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> str:
    hash_suffix = f"_{content_hash[:16]}" if content_hash else ""
    prefix = f"tenants/{tenant_id}/" if tenant_id else ""
    raw_key = f"{prefix}final_ads/{job_id}/{platform}/final_ad_attempt_{attempt}{hash_suffix}.png"
    return validate_storage_key(raw_key)


def build_tenant_asset_key(
    tenant_id: str,
    asset_id: str,
    filename: str,
) -> str:
    raw_key = f"tenants/{tenant_id}/assets/{asset_id}/{filename}"
    return validate_storage_key(raw_key)
