from typing import Optional
from app.publishing.providers.base import PublishingProvider
from app.publishing.providers.mock import MockPublishingProvider
from app.publishing.providers.not_configured import NotConfiguredPublishingProvider


def get_publishing_provider(
    provider_type: str = "mock",
    platform: Optional[str] = None,
    db=None,
) -> PublishingProvider:
    """
    Factory resolving social publishing providers.
    - 'mock': deterministic mock provider for testing and development.
    - 'facebook' or 'facebook_graph': resolves FacebookPublishingProvider if enabled,
      otherwise NotConfiguredPublishingProvider.
    - other platform identifiers return NotConfiguredPublishingProvider.
    """
    from app.core.config import settings
    prov_lower = provider_type.lower().strip()
    plat_lower = (platform or "").lower().strip()

    if prov_lower == "mock":
        return MockPublishingProvider()
    elif prov_lower in ("facebook", "facebook_graph") or (plat_lower == "facebook" and getattr(settings, "ENABLE_FACEBOOK_PUBLISHING", False)):
        if getattr(settings, "ENABLE_FACEBOOK_PUBLISHING", False) or prov_lower in ("facebook", "facebook_graph"):
            from app.publishing.providers.facebook import FacebookPublishingProvider
            return FacebookPublishingProvider(db=db)
        return NotConfiguredPublishingProvider(platform_name=platform or prov_lower)
    elif prov_lower in ("instagram", "linkedin", "instagram_graph", "linkedin_v2"):
        return NotConfiguredPublishingProvider(platform_name=platform or prov_lower)
    else:
        return NotConfiguredPublishingProvider(platform_name=platform or prov_lower)

