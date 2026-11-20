"""
S3-Compatible Object Storage Provider for AWS S3 and Cloudflare R2.
Supports private buckets, deterministic metadata, SHA-256 content verification,
and resilient error translation without leaking provider credentials.
"""

import asyncio
import hashlib
from typing import Optional, Dict, Any
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import settings
from app.core.logging import logger
from app.providers.base import StorageProvider
from app.providers.storage_keys import validate_storage_key


class S3CompatibleStorageProvider(StorageProvider):
    """
    Production-ready S3-compatible storage provider.
    Works natively with AWS S3, Cloudflare R2, and MinIO.
    """

    def __init__(
        self,
        bucket_name: str,
        aws_access_key_id: str,
        aws_secret_access_key: str,
        region_name: str = "us-east-1",
        endpoint_url: Optional[str] = None,
        public_base_url: Optional[str] = None,
    ):
        if not bucket_name:
            raise ValueError("S3 bucket_name is required.")
        if not aws_access_key_id or not aws_secret_access_key:
            raise ValueError("AWS credentials (access key ID and secret access key) are required.")

        self.bucket_name = bucket_name
        self.region_name = region_name or "us-east-1"
        self.endpoint_url = endpoint_url
        self.public_base_url = public_base_url.rstrip("/") if public_base_url else None

        # Configure boto3 client with standard s3v4 signature (mandatory for R2 and modern S3)
        boto_config = Config(
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "standard"},
            connect_timeout=10,
            read_timeout=30,
        )

        self._s3_client = boto3.client(
            "s3",
            endpoint_url=self.endpoint_url,
            region_name=self.region_name,
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
            config=boto_config,
        )

    def _sync_head(self, clean_key: str) -> Optional[Dict[str, Any]]:
        try:
            return self._s3_client.head_object(Bucket=self.bucket_name, Key=clean_key)
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code")
            if error_code in ("404", "NoSuchKey", "NotFound"):
                return None
            raise

    def _sync_put(self, clean_key: str, data: bytes, content_type: str, sha256_hash: str) -> None:
        self._s3_client.put_object(
            Bucket=self.bucket_name,
            Key=clean_key,
            Body=data,
            ContentType=content_type,
            Metadata={"sha256": sha256_hash},
        )

    def _sync_get(self, clean_key: str) -> bytes:
        try:
            response = self._s3_client.get_object(Bucket=self.bucket_name, Key=clean_key)
            return response["Body"].read()
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code")
            if error_code in ("404", "NoSuchKey", "NotFound"):
                raise FileNotFoundError(f"Storage key not found in S3 bucket '{self.bucket_name}': {clean_key}")
            raise

    def _sync_delete(self, clean_key: str) -> bool:
        try:
            self._s3_client.delete_object(Bucket=self.bucket_name, Key=clean_key)
            return True
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code")
            if error_code in ("404", "NoSuchKey", "NotFound"):
                return True
            raise

    async def save_bytes(self, data: bytes, key: str, content_type: str = "image/png") -> str:
        clean_key = validate_storage_key(key)
        sha256_hash = hashlib.sha256(data).hexdigest()

        # Check existing object to prevent accidental silent corrupting overwrites
        existing_meta = await asyncio.to_thread(self._sync_head, clean_key)
        if existing_meta:
            existing_hash = existing_meta.get("Metadata", {}).get("sha256")
            if existing_hash and existing_hash != sha256_hash:
                raise ValueError(
                    f"Integrity conflict: key '{clean_key}' already exists with different SHA-256 hash. "
                    "Silent overwriting of immutable assets is prohibited."
                )

        await asyncio.to_thread(self._sync_put, clean_key, data, content_type, sha256_hash)
        logger.info(f"Uploaded {len(data)} bytes to S3 [{self.bucket_name}]: {clean_key} (SHA-256: {sha256_hash[:8]}...)")
        return clean_key

    async def get_bytes(self, key: str) -> bytes:
        clean_key = validate_storage_key(key)
        return await asyncio.to_thread(self._sync_get, clean_key)

    async def exists(self, key: str) -> bool:
        clean_key = validate_storage_key(key)
        meta = await asyncio.to_thread(self._sync_head, clean_key)
        return meta is not None

    async def delete(self, key: str) -> bool:
        clean_key = validate_storage_key(key)
        return await asyncio.to_thread(self._sync_delete, clean_key)

    async def get_metadata(self, key: str) -> Dict[str, Any]:
        clean_key = validate_storage_key(key)
        meta = await asyncio.to_thread(self._sync_head, clean_key)
        if meta is None:
            raise FileNotFoundError(f"Storage key not found in S3 bucket '{self.bucket_name}': {clean_key}")

        return {
            "key": clean_key,
            "bucket": self.bucket_name,
            "size_bytes": meta.get("ContentLength", 0),
            "content_type": meta.get("ContentType", "application/octet-stream"),
            "sha256": meta.get("Metadata", {}).get("sha256"),
            "etag": meta.get("ETag", "").strip('"'),
            "last_modified": meta.get("LastModified"),
        }

    async def get_public_url(self, key: str) -> str:
        clean_key = validate_storage_key(key)
        if self.public_base_url:
            return f"{self.public_base_url}/{clean_key}"
        # For private buckets without a public CDN/base URL, route securely through the backend proxy
        return f"{settings.STORAGE_PUBLIC_URL_PREFIX}/{clean_key}"
