import json
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.core.logging import logger
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.encryption import get_token_encryption_service, TokenEncryptionService
from app.models.publishing import ConnectedAccount, AccountStatus
from app.publishing.providers.base import (
    PublishingProvider,
    PublishingProviderResult,
    PublishingActionClass,
)


GRAPH_API_VERSION = "v22.0"
GRAPH_API_BASE = f"https://graph.facebook.com/{GRAPH_API_VERSION}"


class FacebookPublishingProvider(PublishingProvider):
    """
    Authoritative publishing provider for Facebook Pages via Meta Graph API v22.0.
    - Decrypts stored credentials only inside the server-side provider execution path.
    - Direct multipart/form-data binary upload (source=asset_bytes).
    - Preserves exact creative artifact bytes without transcoding or modification.
    - Captures provider request ID, usage headers, and Retry-After backoff.
    - Robust error taxonomy mapping errors to action classes (RETRY, RECONCILE, REAUTHENTICATE, DO_NOT_RETRY, BLOCK).
    - Ambiguous network timeouts trigger RECONCILE to prevent duplicate external posts.
    """

    def __init__(
        self,
        db: Optional[AsyncSession] = None,
        encryption_service: Optional[TokenEncryptionService] = None,
        http_client: Optional[httpx.AsyncClient] = None,
    ):
        self._db = db
        self._encryption_service = encryption_service or get_token_encryption_service()
        self._http_client = http_client

    async def _resolve_account(self, account_id: Optional[str]) -> Optional[ConnectedAccount]:
        """Resolves the ConnectedAccount from the database by ID or external_user_id."""
        if not account_id:
            return None

        async def _fetch(session: AsyncSession) -> Optional[ConnectedAccount]:
            acc = await session.get(ConnectedAccount, account_id)
            if not acc:
                stmt = select(ConnectedAccount).where(
                    and_(
                        ConnectedAccount.external_user_id == account_id,
                        ConnectedAccount.platform == "facebook",
                    )
                )
                acc = (await session.execute(stmt)).scalars().first()
            return acc

        if self._db:
            return await _fetch(self._db)
        async with AsyncSessionLocal() as session:
            return await _fetch(session)

    async def _update_account_status(self, account: ConnectedAccount, new_status: AccountStatus) -> None:
        """Updates ConnectedAccount status in database (e.g. upon token invalidation/expiration)."""
        account.status = new_status.value

        async def _save(session: AsyncSession):
            session.add(account)
            await session.commit()
            await session.refresh(account)

        if self._db:
            await _save(self._db)
        else:
            async with AsyncSessionLocal() as session:
                await _save(session)

    def _parse_headers(self, headers: httpx.Headers) -> Dict[str, Any]:
        """Extracts diagnostic provider request ID, rate limit usage, and Retry-After."""
        meta: Dict[str, Any] = {}
        req_id = headers.get("x-fb-request-id") or headers.get("fb-request-id")
        if req_id:
            meta["provider_request_id"] = req_id

        retry_after = headers.get("retry-after")
        if retry_after:
            try:
                meta["retry_after_seconds"] = int(retry_after)
            except ValueError:
                pass

        page_usage = headers.get("x-page-usage")
        if page_usage:
            try:
                meta["page_usage"] = json.loads(page_usage)
            except Exception:
                meta["page_usage"] = page_usage

        app_usage = headers.get("x-app-usage")
        if app_usage:
            try:
                meta["app_usage"] = json.loads(app_usage)
            except Exception:
                meta["app_usage"] = app_usage

        return meta

    def _classify_error(
        self,
        status_code: int,
        error_data: Dict[str, Any],
        headers_meta: Dict[str, Any],
    ) -> PublishingProviderResult:
        """Deterministically maps Facebook Graph API errors into structured error taxonomy."""
        code = error_data.get("code")
        subcode = error_data.get("error_subcode")
        msg = error_data.get("message", "Facebook API error")
        err_type = error_data.get("type", "")

        req_id = headers_meta.get("provider_request_id")
        retry_after = headers_meta.get("retry_after_seconds")

        # 1. Authentication / Token Invalidation (OAuthException, code 190, 102)
        if code in (190, 102, 463, 467) or err_type == "OAuthException":
            return PublishingProviderResult(
                success=False,
                status="PUBLISH_FAILED",
                error_code="FB_AUTH_ERROR",
                error_message=f"Facebook authentication failed: {msg}",
                action_class=PublishingActionClass.REAUTHENTICATE,
                provider_request_id=req_id,
                provider_error_code=code,
                provider_error_subcode=subcode,
                raw_response={"error": error_data, "headers": headers_meta},
            )

        # 2. Rate Limits (codes 4, 17, 32, 613, or HTTP 429)
        if code in (4, 17, 32, 613) or status_code == 429:
            effective_retry = retry_after or 60
            return PublishingProviderResult(
                success=False,
                status="PUBLISH_FAILED",
                error_code="FB_RATE_LIMITED",
                error_message=f"Facebook rate limit reached: {msg}",
                action_class=PublishingActionClass.RETRY,
                provider_request_id=req_id,
                retry_after_seconds=effective_retry,
                provider_error_code=code,
                provider_error_subcode=subcode,
                raw_response={"error": error_data, "headers": headers_meta},
            )

        # 3. Transient Server Errors (HTTP 5xx, or codes 1, 2)
        if status_code >= 500 or code in (1, 2):
            return PublishingProviderResult(
                success=False,
                status="PUBLISH_FAILED",
                error_code="FB_SERVER_ERROR",
                error_message=f"Facebook temporary server error: {msg}",
                action_class=PublishingActionClass.RETRY,
                provider_request_id=req_id,
                retry_after_seconds=retry_after or 15,
                provider_error_code=code,
                provider_error_subcode=subcode,
                raw_response={"error": error_data, "headers": headers_meta},
            )

        # 4. Permission / Policy Violations (codes 10, 200, 368)
        if code in (10, 200, 368):
            return PublishingProviderResult(
                success=False,
                status="PUBLISH_FAILED",
                error_code="FB_POLICY_OR_PERMS_ERROR",
                error_message=f"Facebook permission or policy rejection: {msg}",
                action_class=PublishingActionClass.BLOCK,
                provider_request_id=req_id,
                provider_error_code=code,
                provider_error_subcode=subcode,
                raw_response={"error": error_data, "headers": headers_meta},
            )

        # 5. Bad Request / Validation Errors (code 100, etc.)
        return PublishingProviderResult(
            success=False,
            status="PUBLISH_FAILED",
            error_code="FB_BAD_REQUEST",
            error_message=f"Facebook rejected request: {msg}",
            action_class=PublishingActionClass.DO_NOT_RETRY,
            provider_request_id=req_id,
            provider_error_code=code,
            provider_error_subcode=subcode,
            raw_response={"error": error_data, "headers": headers_meta},
        )

    async def publish(
        self,
        record_id: str,
        platform: str,
        asset_bytes: bytes,
        caption: Optional[str] = None,
        platform_metadata: Optional[Dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
        account_id: Optional[str] = None,
    ) -> PublishingProviderResult:
        """
        Executes binary photo upload to Facebook Page endpoint:
        POST https://graph.facebook.com/v22.0/{page-id}/photos
        """
        if not asset_bytes or len(asset_bytes) == 0:
            return PublishingProviderResult(
                success=False,
                status="PUBLISH_FAILED",
                error_code="EMPTY_MEDIA_BYTES",
                error_message="Cannot publish empty or zero-byte creative artifact.",
                action_class=PublishingActionClass.DO_NOT_RETRY,
            )

        # 1. Resolve ConnectedAccount
        account = await self._resolve_account(account_id)
        if not account:
            return PublishingProviderResult(
                success=False,
                status="PUBLISH_FAILED",
                error_code="ACCOUNT_NOT_FOUND",
                error_message=f"ConnectedAccount '{account_id}' not found.",
                action_class=PublishingActionClass.DO_NOT_RETRY,
            )

        # Check account status
        if account.status not in (AccountStatus.ACTIVE.value, AccountStatus.CONNECTED.value):
            return PublishingProviderResult(
                success=False,
                status="PUBLISH_FAILED",
                error_code="ACCOUNT_INACTIVE",
                error_message=f"Connected Facebook account '{account.account_name}' is in status '{account.status}'. Reauthentication required.",
                action_class=PublishingActionClass.REAUTHENTICATE,
            )

        # Check token expiration
        now = datetime.now(timezone.utc)
        if account.token_expires_at:
            token_exp = account.token_expires_at
            if token_exp.tzinfo is None:
                token_exp = token_exp.replace(tzinfo=timezone.utc)
            if token_exp <= now:
                await self._update_account_status(account, AccountStatus.EXPIRED)
                return PublishingProviderResult(
                    success=False,
                    status="PUBLISH_FAILED",
                    error_code="TOKEN_EXPIRED",
                    error_message="Connected Facebook access token has expired. Please reauthenticate.",
                    action_class=PublishingActionClass.REAUTHENTICATE,
                )


        # 2. Decrypt Access Token (only inside server-side provider execution path)
        if not account.encrypted_access_token:
            return PublishingProviderResult(
                success=False,
                status="PUBLISH_FAILED",
                error_code="MISSING_CREDENTIALS",
                error_message="No access token found for connected Facebook account.",
                action_class=PublishingActionClass.REAUTHENTICATE,
            )

        try:
            page_token = self._encryption_service.decrypt(account.encrypted_access_token)
        except Exception as dec_exc:
            logger.error(f"[FacebookPublishingProvider] Failed to decrypt access token for account '{account.id}': {dec_exc}")
            return PublishingProviderResult(
                success=False,
                status="PUBLISH_FAILED",
                error_code="DECRYPTION_FAILED",
                error_message="Failed to decrypt account credentials. Token may be corrupted or key mismatched.",
                action_class=PublishingActionClass.REAUTHENTICATE,
            )

        page_id = account.external_user_id
        upload_url = f"{GRAPH_API_BASE}/{page_id}/photos"

        # 3. Construct Multipart Request
        # Send access_token in form data body, NOT in query string, avoiding URL logging
        data_fields = {
            "access_token": page_token,
        }
        if caption:
            data_fields["caption"] = caption

        # Exact approved bytes streamed as multipart/form-data
        files = {
            "source": ("creative.png", asset_bytes, "image/png"),
        }

        # 4. Execute HTTP Request
        client = self._http_client or httpx.AsyncClient(timeout=45.0)
        try:
            resp = await client.post(upload_url, data=data_fields, files=files)
            headers_meta = self._parse_headers(resp.headers)

            if resp.status_code == 200:
                body = resp.json()
                photo_id = body.get("id")
                post_id = body.get("post_id") or photo_id
                post_url = f"https://www.facebook.com/{page_id}/photos/{photo_id}" if photo_id else None

                return PublishingProviderResult(
                    success=True,
                    status="PUBLISHED",
                    external_post_id=post_id,
                    post_url=post_url,
                    provider_request_id=headers_meta.get("provider_request_id"),
                    raw_response={"data": body, "headers": headers_meta},
                )
            else:
                try:
                    err_json = resp.json().get("error", {})
                except Exception:
                    err_json = {"message": resp.text, "code": resp.status_code}

                classified = self._classify_error(resp.status_code, err_json, headers_meta)
                if classified.action_class == PublishingActionClass.REAUTHENTICATE:
                    await self._update_account_status(account, AccountStatus.DISCONNECTED)
                return classified

        except (httpx.TimeoutException, httpx.NetworkError) as net_exc:
            logger.warning(
                f"[FacebookPublishingProvider] Ambiguous network condition publishing record '{record_id}': {net_exc}"
            )
            return PublishingProviderResult(
                success=False,
                status="PUBLISH_FAILED",
                error_code="NETWORK_TIMEOUT",
                error_message=f"Network timeout contacting Facebook Graph API: {str(net_exc)}",
                is_ambiguous=True,
                action_class=PublishingActionClass.RECONCILE,
            )
        except Exception as exc:
            logger.error(f"[FacebookPublishingProvider] Unexpected error: {exc}")
            return PublishingProviderResult(
                success=False,
                status="PUBLISH_FAILED",
                error_code="UNEXPECTED_ERROR",
                error_message=str(exc),
                action_class=PublishingActionClass.DO_NOT_RETRY,
            )
        finally:
            if not self._http_client:
                await client.aclose()

    async def reconcile(
        self,
        idempotency_key: str,
        account_id: Optional[str] = None,
        expected_caption: Optional[str] = None,
    ) -> Optional[PublishingProviderResult]:
        """
        Reconciles post state using read-after-timeout verification against Facebook Page photos.
        Queries recent page photos and matches deterministically using caption, timestamp window, and account.
        """
        account = await self._resolve_account(account_id)
        if not account or not account.encrypted_access_token:
            return None

        try:
            page_token = self._encryption_service.decrypt(account.encrypted_access_token)
        except Exception:
            return None

        page_id = account.external_user_id
        list_url = f"{GRAPH_API_BASE}/{page_id}/photos"
        params = {
            "fields": "id,name,created_time,link",
            "limit": "25",
            "access_token": page_token,
        }

        client = self._http_client or httpx.AsyncClient(timeout=30.0)
        try:
            resp = await client.get(list_url, params=params)
            if resp.status_code != 200:
                return None

            data = resp.json().get("data", [])
            headers_meta = self._parse_headers(resp.headers)

            # Match criteria: photo name (caption) equals expected caption, created within the last 2 hours
            now = datetime.now(timezone.utc)
            for photo in data:
                photo_id = photo.get("id")
                photo_name = photo.get("name")
                created_str = photo.get("created_time")

                # If caption is specified, match caption
                if expected_caption and photo_name != expected_caption:
                    continue

                # Verify creation time is recent if present
                if created_str:
                    try:
                        # Meta ISO format: 2026-10-04T04:15:00+0000
                        created_dt = datetime.fromisoformat(created_str.replace("+0000", "+00:00"))
                        if now - created_dt > timedelta(hours=2):
                            continue
                    except Exception:
                        pass

                # If we got here with a match (or caption matched)
                if photo_id:
                    post_url = photo.get("link") or f"https://www.facebook.com/{page_id}/photos/{photo_id}"
                    return PublishingProviderResult(
                        success=True,
                        status="PUBLISHED",
                        external_post_id=photo_id,
                        post_url=post_url,
                        provider_request_id=headers_meta.get("provider_request_id"),
                        raw_response={"reconciled_photo": photo, "headers": headers_meta},
                    )

            return None
        except Exception as exc:
            logger.warning(f"[FacebookPublishingProvider] Reconciliation query failed: {exc}")
            return None
        finally:
            if not self._http_client:
                await client.aclose()

    async def get_publish_status(
        self,
        external_post_id: str,
        account_id: Optional[str] = None,
    ) -> PublishingProviderResult:
        """Queries status of an existing Facebook post/photo."""
        account = await self._resolve_account(account_id)
        if not account or not account.encrypted_access_token:
            return PublishingProviderResult(
                success=False,
                status="NOT_FOUND",
                error_code="ACCOUNT_NOT_FOUND",
                error_message="ConnectedAccount credentials unavailable for status check.",
            )

        try:
            page_token = self._encryption_service.decrypt(account.encrypted_access_token)
        except Exception:
            return PublishingProviderResult(
                success=False,
                status="NOT_FOUND",
                error_code="DECRYPTION_FAILED",
                error_message="Failed to decrypt token.",
            )

        url = f"{GRAPH_API_BASE}/{external_post_id}"
        params = {"fields": "id,created_time,link", "access_token": page_token}

        client = self._http_client or httpx.AsyncClient(timeout=30.0)
        try:
            resp = await client.get(url, params=params)
            headers_meta = self._parse_headers(resp.headers)
            if resp.status_code == 200:
                body = resp.json()
                return PublishingProviderResult(
                    success=True,
                    status="PUBLISHED",
                    external_post_id=body.get("id"),
                    post_url=body.get("link"),
                    provider_request_id=headers_meta.get("provider_request_id"),
                    raw_response={"data": body, "headers": headers_meta},
                )
            else:
                return PublishingProviderResult(
                    success=False,
                    status="NOT_FOUND",
                    error_code="POST_NOT_FOUND",
                    error_message=f"Facebook returned status {resp.status_code}",
                )
        except Exception as exc:
            return PublishingProviderResult(
                success=False,
                status="ERROR",
                error_code="STATUS_CHECK_ERROR",
                error_message=str(exc),
            )
        finally:
            if not self._http_client:
                await client.aclose()

    async def delete_or_unpublish(
        self,
        external_post_id: str,
        account_id: Optional[str] = None,
    ) -> bool:
        """Deletes a published photo/post on Facebook Page."""
        account = await self._resolve_account(account_id)
        if not account or not account.encrypted_access_token:
            return False

        try:
            page_token = self._encryption_service.decrypt(account.encrypted_access_token)
        except Exception:
            return False

        url = f"{GRAPH_API_BASE}/{external_post_id}"
        params = {"access_token": page_token}

        client = self._http_client or httpx.AsyncClient(timeout=30.0)
        try:
            resp = await client.delete(url, params=params)
            return resp.status_code == 200
        except Exception:
            return False
        finally:
            if not self._http_client:
                await client.aclose()
