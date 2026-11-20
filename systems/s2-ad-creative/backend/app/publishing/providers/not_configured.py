from typing import Dict, Any, Optional
from app.publishing.providers.base import PublishingProvider, PublishingProviderResult


class NotConfiguredPublishingProvider(PublishingProvider):
    """
    Explicit stub provider for real social platforms (Facebook Graph, Instagram Graph, LinkedIn v2)
    when official OAuth credentials / API tokens are unconfigured in the environment.
    Prevents silently falling back to mock or claiming real publication occurred.
    """

    def __init__(self, platform_name: str):
        self.platform_name = platform_name
        self.is_mock = False

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
        return PublishingProviderResult(
            success=False,
            status="NOT_CONFIGURED",
            error_code="PROVIDER_NOT_CONFIGURED",
            error_message=(
                f"Real social publishing provider for '{self.platform_name}' is not configured. "
                "Official OAuth app credentials and access tokens are required."
            ),
            is_mock=False,
        )

    async def get_publish_status(
        self,
        external_post_id: str,
        account_id: Optional[str] = None,
    ) -> PublishingProviderResult:
        return PublishingProviderResult(
            success=False,
            status="NOT_CONFIGURED",
            error_code="PROVIDER_NOT_CONFIGURED",
            error_message=f"Provider '{self.platform_name}' is not configured.",
            is_mock=False,
        )

    async def reconcile(
        self,
        idempotency_key: str,
        account_id: Optional[str] = None,
        expected_caption: Optional[str] = None,
    ) -> Optional[PublishingProviderResult]:
        return None


    async def delete_or_unpublish(
        self,
        external_post_id: str,
        account_id: Optional[str] = None,
    ) -> bool:
        return False
