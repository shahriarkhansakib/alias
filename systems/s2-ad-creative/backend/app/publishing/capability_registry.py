from typing import Dict, List, Optional, Any
from app.schemas.publishing import PlatformPublishingCapability


class PublishingCapabilityRegistry:
    """
    Centralized, backend-driven registry of social media publishing capabilities and constraints.
    Decoupled from creative generation platform specs.
    """

    _CAPABILITIES: Dict[str, PlatformPublishingCapability] = {
        "facebook": PlatformPublishingCapability(
            platform="facebook",
            display_name="Facebook Page / Feed",
            supported_media_types=["image/png", "image/jpeg"],
            supported_aspect_ratios=["1:1", "4:5", "16:9"],
            max_caption_length=2200,
            supports_hashtags=True,
            max_hashtags=30,
            supports_links=True,
            provider_type="mock",
            integration_status="MOCK",
        ),
        "instagram": PlatformPublishingCapability(
            platform="instagram",
            display_name="Instagram Feed",
            supported_media_types=["image/png", "image/jpeg"],
            supported_aspect_ratios=["1:1", "4:5"],
            max_caption_length=2200,
            supports_hashtags=True,
            max_hashtags=30,
            supports_links=False,  # Instagram feed posts don't support clickable body links
            provider_type="mock",
            integration_status="MOCK",
        ),
        "linkedin": PlatformPublishingCapability(
            platform="linkedin",
            display_name="LinkedIn Company Page",
            supported_media_types=["image/png", "image/jpeg"],
            supported_aspect_ratios=["1:1", "1.91:1", "16:9"],
            max_caption_length=3000,
            supports_hashtags=True,
            max_hashtags=10,
            supports_links=True,
            provider_type="mock",
            integration_status="MOCK",
        ),
    }

    @classmethod
    def get_capability(cls, platform: str) -> Optional[PlatformPublishingCapability]:
        from app.core.config import settings
        norm = platform.lower().strip()
        # Normalization for platform identifiers (e.g. facebook_feed -> facebook, instagram_square -> instagram)
        target_cap = None
        for base in ["facebook", "instagram", "linkedin"]:
            if base in norm:
                target_cap = cls._CAPABILITIES.get(base)
                break
        if not target_cap:
            target_cap = cls._CAPABILITIES.get(norm)

        if target_cap and target_cap.platform == "facebook" and getattr(settings, "ENABLE_FACEBOOK_PUBLISHING", False):
            return target_cap.model_copy(update={"provider_type": "facebook", "integration_status": "AVAILABLE"})

        return target_cap

    @classmethod
    def list_capabilities(cls) -> List[PlatformPublishingCapability]:
        from app.core.config import settings
        caps = []
        for p, cap in cls._CAPABILITIES.items():
            if p == "facebook" and getattr(settings, "ENABLE_FACEBOOK_PUBLISHING", False):
                caps.append(cap.model_copy(update={"provider_type": "facebook", "integration_status": "AVAILABLE"}))
            else:
                caps.append(cap)
        return caps

    @classmethod
    def validate_publish_payload(
        cls,
        platform: str,
        caption: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        aspect_ratio: Optional[str] = None,
    ) -> List[str]:
        """
        Validates a publish request against registered platform capabilities.
        Returns a list of error strings (empty if valid).
        """
        cap = cls.get_capability(platform)
        if not cap:
            return [f"Platform '{platform}' is not supported for publishing."]

        errors: List[str] = []

        if caption:
            if len(caption) > cap.max_caption_length:
                errors.append(
                    f"Caption exceeds maximum length of {cap.max_caption_length} characters for {cap.display_name} (got {len(caption)})."
                )

            # Check hashtags count if constrained
            if cap.max_hashtags is not None:
                hashtags = [word for word in caption.split() if word.startswith("#")]
                if len(hashtags) > cap.max_hashtags:
                    errors.append(
                        f"Caption contains {len(hashtags)} hashtags, exceeding {cap.display_name} limit of {cap.max_hashtags}."
                    )

        return errors
