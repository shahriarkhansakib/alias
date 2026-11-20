import uuid
from typing import Dict, Any, Optional
from app.publishing.providers.base import PublishingProvider, PublishingProviderResult


class MockPublishingProvider(PublishingProvider):
    """
    Deterministic mock publishing provider for local testing and simulation.
    Explicitly labeled with is_mock=True. Never masquerades as a live social network.
    Maintains simulated external post registry to test idempotent reconciliation.
    """

    def __init__(
        self,
        simulate_failure: bool = False,
        simulate_timeout: bool = False,
        simulate_unavailable: bool = False,
        simulate_ambiguous_post_creation: bool = False,
    ):
        self.is_mock = True
        self.simulate_failure = simulate_failure
        self.simulate_timeout = simulate_timeout
        self.simulate_unavailable = simulate_unavailable
        self.simulate_ambiguous_post_creation = simulate_ambiguous_post_creation
        # In-memory registry of posts by idempotency_key for reconciliation tests
        self._published_registry: Dict[str, Dict[str, Any]] = {}

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
        if self.simulate_unavailable:
            raise RuntimeError(f"Mock publishing provider for '{platform}' is currently unavailable (circuit broken).")

        if self.simulate_timeout:
            # If simulating ambiguous timeout where external platform actually created the post
            # before connection dropped:
            if self.simulate_ambiguous_post_creation and idempotency_key:
                ext_id = f"ext-{platform}-{uuid.uuid4().hex[:12]}"
                post_url = f"https://mock.{platform}.com/posts/{ext_id}"
                self._published_registry[idempotency_key] = {
                    "external_post_id": ext_id,
                    "post_url": post_url,
                    "platform": platform,
                    "caption": caption,
                }
            return PublishingProviderResult(
                success=False,
                status="FAILED",
                error_code="TIMEOUT",
                error_message=f"Timeout communicating with mock {platform} API",
                is_mock=True,
                is_ambiguous=True,
            )

        if self.simulate_failure:
            return PublishingProviderResult(
                success=False,
                status="FAILED",
                error_code="PLATFORM_REJECTED",
                error_message=f"Mock {platform} API rejected publish request: invalid creative or policy violation",
                is_mock=True,
                is_ambiguous=False,
            )

        # Provider-side idempotency check
        if idempotency_key and idempotency_key in self._published_registry:
            existing = self._published_registry[idempotency_key]
            return PublishingProviderResult(
                success=True,
                status="PUBLISHED",
                external_post_id=existing["external_post_id"],
                post_url=existing["post_url"],
                raw_response={"mock_status": "reused_existing_post", "idempotent": True},
                is_mock=True,
            )

        # Standard successful publish
        ext_id = f"ext-{platform}-{uuid.uuid4().hex[:12]}"
        post_url = f"https://mock.{platform}.com/posts/{ext_id}"

        res_payload = {
            "external_post_id": ext_id,
            "post_url": post_url,
            "platform": platform,
            "caption": caption,
        }

        if idempotency_key:
            self._published_registry[idempotency_key] = res_payload

        return PublishingProviderResult(
            success=True,
            status="PUBLISHED",
            external_post_id=ext_id,
            post_url=post_url,
            raw_response={"id": ext_id, "permalink": post_url, "created_time": "2026-10-03T18:00:00Z"},
            is_mock=True,
            is_ambiguous=False,
        )

    async def get_publish_status(
        self,
        external_post_id: str,
        account_id: Optional[str] = None,
    ) -> PublishingProviderResult:
        return PublishingProviderResult(
            success=True,
            status="PUBLISHED",
            external_post_id=external_post_id,
            raw_response={"id": external_post_id, "status": "active"},
            is_mock=True,
        )

    async def reconcile(
        self,
        idempotency_key: str,
        account_id: Optional[str] = None,
        expected_caption: Optional[str] = None,
    ) -> Optional[PublishingProviderResult]:
        if idempotency_key in self._published_registry:
            existing = self._published_registry[idempotency_key]
            return PublishingProviderResult(
                success=True,
                status="PUBLISHED",
                external_post_id=existing["external_post_id"],
                post_url=existing["post_url"],
                raw_response={"reconciled": True, "source": "provider_registry"},
                is_mock=True,
            )
        return None

    async def delete_or_unpublish(
        self,
        external_post_id: str,
        account_id: Optional[str] = None,
    ) -> bool:
        return True
