import hashlib
import mimetypes
import os
from pathlib import Path
from typing import Optional, Dict, Any
from app.core.config import settings
from app.core.logging import logger
from app.providers.base import StorageProvider
from app.providers.storage_keys import validate_storage_key


class LocalStorageProvider(StorageProvider):
    """
    Local filesystem storage provider for frictionless offline development.
    Maintains strict path containment and protects against all traversal attacks.
    """

    def __init__(self, base_dir: Optional[str] = None):
        target = base_dir or settings.LOCAL_STORAGE_PATH
        path_candidate = Path(target)
        if not base_dir and not path_candidate.is_absolute():
            # Resolve to backend/storage if started from repository root or sibling directory
            backend_storage = Path(__file__).resolve().parent.parent.parent / "storage"
            if backend_storage.exists() and (backend_storage / "demo").exists():
                path_candidate = backend_storage
        self.base_dir = path_candidate
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _resolve_path(self, key: str) -> Path:
        """
        Resolves storage key ensuring strict containment within base_dir.
        Rejects POSIX, Windows, mixed separator, absolute, and encoded path traversal attempts.
        """
        if not key or not isinstance(key, str):
            raise ValueError("Storage key must be a non-empty string.")

        if "\x00" in key:
            raise ValueError("Storage key cannot contain null bytes.")

        raw_path = Path(key)
        if raw_path.is_absolute() or raw_path.drive:
            raise ValueError(f"Absolute storage paths are prohibited: {key}")

        base_resolved = self.base_dir.resolve()
        
        # Check raw key and unquoted key for traversal
        import urllib.parse
        unquoted_key = urllib.parse.unquote(key)
        
        target_path = (self.base_dir / unquoted_key).resolve()
        try:
            if not target_path.is_relative_to(base_resolved):
                raise ValueError(f"Path traversal detected: storage key '{key}' resolves outside base directory.")
        except AttributeError:
            if not str(target_path).startswith(str(base_resolved)):
                raise ValueError(f"Path traversal detected: storage key '{key}' resolves outside base directory.")

        return target_path


    async def save_bytes(self, data: bytes, key: str, content_type: str = "image/png") -> str:
        target_path = self._resolve_path(key)
        sha256_hash = hashlib.sha256(data).hexdigest()

        if target_path.exists():
            existing_data = target_path.read_bytes()
            existing_hash = hashlib.sha256(existing_data).hexdigest()
            if existing_hash != sha256_hash:
                raise ValueError(
                    f"Integrity conflict: key '{key}' already exists with different SHA-256 hash. "
                    "Silent overwriting of immutable assets is prohibited."
                )

        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(data)
        logger.info(f"Saved {len(data)} bytes to storage key: {key} (SHA-256: {sha256_hash[:8]}...)")
        return key

    async def get_bytes(self, key: str) -> bytes:
        target_path = self._resolve_path(key)
        if not target_path.exists():
            raise FileNotFoundError(f"Storage key not found: {key}")
        return target_path.read_bytes()

    async def get_public_url(self, key: str) -> str:
        self._resolve_path(key)
        clean_key = os.path.normpath(key).replace("\\", "/").lstrip("/")
        return f"{settings.STORAGE_PUBLIC_URL_PREFIX}/{clean_key}"

    async def exists(self, key: str) -> bool:
        return self._resolve_path(key).exists()

    async def delete(self, key: str) -> bool:
        target_path = self._resolve_path(key)
        if target_path.exists():
            target_path.unlink()
            return True
        return False

    async def get_metadata(self, key: str) -> Dict[str, Any]:
        target_path = self._resolve_path(key)
        if not target_path.exists():
            raise FileNotFoundError(f"Storage key not found: {key}")
        data = target_path.read_bytes()
        sha256_hash = hashlib.sha256(data).hexdigest()
        content_type, _ = mimetypes.guess_type(target_path.name)
        stat = target_path.stat()
        return {
            "key": key,
            "size_bytes": len(data),
            "content_type": content_type or "application/octet-stream",
            "sha256": sha256_hash,
            "last_modified": stat.st_mtime,
        }


_storage_instance: Optional[StorageProvider] = None


def get_storage_provider() -> StorageProvider:
    global _storage_instance
    if _storage_instance is None:
        effective_storage = (settings.STORAGE_TYPE or settings.STORAGE_PROVIDER).lower()
        if effective_storage in ("s3", "r2"):
            from app.providers.s3_storage_provider import S3CompatibleStorageProvider
            _storage_instance = S3CompatibleStorageProvider(
                bucket_name=settings.S3_BUCKET or "",
                aws_access_key_id=settings.S3_ACCESS_KEY_ID or "",
                aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY or "",
                region_name=settings.S3_REGION,
                endpoint_url=settings.S3_ENDPOINT_URL,
                public_base_url=settings.S3_PUBLIC_BASE_URL,
            )
        else:
            _storage_instance = LocalStorageProvider()
    return _storage_instance


def reset_storage_provider() -> None:
    """Reset the cached storage singleton instance (used in tests)."""
    global _storage_instance
    _storage_instance = None

