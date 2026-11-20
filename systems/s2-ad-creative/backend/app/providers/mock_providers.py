import io
from typing import Any, Dict, List, Optional, Union
from PIL import Image, ImageDraw
from app.providers.base import LLMStrategyProvider, ImageGenProvider, VisionQAProvider
from app.schemas.brief import FinalAdBriefPayload
from app.schemas.strategy import (
    CreativeStrategySpec,
    ConceptSpec,
    VisualDirectionSpec,
    CopySpec,
    CopyPolicyType,
    PlacementDirection,
)


class MockLLMStrategyProvider(LLMStrategyProvider):
    """
    Deterministic Mock LLM Strategy Provider for local development and zero-cost testing.
    Generates fully compliant CreativeStrategySpec objects based on brief data.
    """

    def __init__(
        self,
        override_spec: Optional[Dict[str, Any]] = None,
        override_specs: Optional[List[Dict[str, Any]]] = None,
    ):
        self.override_spec = override_spec
        self.override_specs = override_specs or []
        self.history: List[Dict[str, Any]] = []

    async def generate_creative_strategy(
        self,
        brief_data: Union[FinalAdBriefPayload, Dict[str, Any]],
        attempt: int = 1,
        feedback: Optional[str] = None,
    ) -> CreativeStrategySpec:
        self.history.append({"attempt": attempt, "feedback": feedback})

        # Multi-attempt override support: pick corresponding override spec for this attempt
        if self.override_specs and len(self.override_specs) >= attempt:
            return CreativeStrategySpec.model_validate(self.override_specs[attempt - 1])

        if self.override_spec:
            return CreativeStrategySpec.model_validate(self.override_spec)

        if isinstance(brief_data, dict):
            try:
                brief = FinalAdBriefPayload.model_validate(brief_data)
                product_name = brief.product.name
                price_val = brief.product.offer.price
                currency = brief.product.offer.currency or "USD"
                discount_val = brief.product.offer.discount_percent
                claims = brief.approved_claims
                user_copy = brief.ad_copy
            except Exception:
                # Fallback for partial test dictionaries
                product_dict = brief_data.get("product", {})
                offer_dict = product_dict.get("offer", {})
                product_name = product_dict.get("name", "Product")
                price_val = float(offer_dict.get("price", product_dict.get("price", 4999.0)))
                currency = offer_dict.get("currency", "USD")
                discount_val = offer_dict.get("discount_percent")
                claims = brief_data.get("approved_claims", [])
                user_copy = None
        else:
            brief = brief_data
            product_name = brief.product.name
            price_val = brief.product.offer.price
            currency = brief.product.offer.currency or "USD"
            discount_val = brief.product.offer.discount_percent
            claims = brief.approved_claims
            user_copy = brief.ad_copy

        currency_sym = "৳" if currency == "BDT" else "$"
        offer_str = f"{currency_sym}{price_val:,.0f}"
        if discount_val:
            offer_str += f" ({discount_val:.0f}% OFF)"

        battery_claim = next((c for c in claims if "battery" in c.lower()), "7-day battery life")
        headline = (
            user_copy.headline
            if (user_copy and user_copy.headline)
            else f"Elevate Every Day with {product_name}."
        )
        subheadline = (
            user_copy.subheadline
            if (user_copy and user_copy.subheadline)
            else f"{battery_claim} with real-time biometric fitness monitoring."
        )
        cta = user_copy.cta if (user_copy and user_copy.cta) else "Shop Now"

        return CreativeStrategySpec(
            concept=ConceptSpec(
                name=f"Performance Lifestyle for {product_name}",
                creative_angle="High-contrast athletic elegance highlighting daily resilience and battery longevity.",
                reasoning_notes="Focuses on real fitness utility grounded strictly in approved claims without superlative claims.",
            ),
            visual_direction=VisualDirectionSpec(
                mood="sleek, energetic, premium dark mode",
                lighting="dramatic cyan and electric blue edge lighting with soft directional fill",
                background_direction=(
                    "Contemporary minimalist athletic studio atmosphere, deep midnight navy environment, "
                    "soft bokeh light orbs on the right, ample dark negative space on the left."
                ),
                negative_prompt="text, typography, watermark, logo, product, smartwatch, human face, cluttered, blurry",
                product_placement=PlacementDirection.RIGHT,
                text_placement=PlacementDirection.LEFT,
            ),
            copy_spec=CopySpec(
                headline=headline,
                subheadline=subheadline,
                cta=cta,
                offer_mention=offer_str,
                headline_policy=CopyPolicyType.USER_PROVIDED if (user_copy and user_copy.headline) else CopyPolicyType.AI_GENERATED_CREATIVE,
                subheadline_policy=CopyPolicyType.FACTUAL,
                cta_policy=CopyPolicyType.USER_PROVIDED if (user_copy and user_copy.cta) else CopyPolicyType.AI_GENERATED_CREATIVE,
            ),
            template_id="product_sale_dark",
        )


class MockImageGenProvider(ImageGenProvider):
    async def generate_background(
        self,
        visual_prompt: str,
        width: int,
        height: int,
        negative_prompt: Optional[str] = None,
    ) -> bytes:
        img = Image.new("RGB", (width, height), color=(18, 24, 38))
        draw = ImageDraw.Draw(img)
        cx, cy = int(width * 0.7), int(height * 0.5)
        radius = int(min(width, height) * 0.45)
        draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=(28, 44, 76))
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        return buffer.getvalue()


class MockVisionQAProvider(VisionQAProvider):
    async def evaluate_creative(self, image_bytes: bytes, spec: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "advisory_passed": True,
            "visual_dominance_score": 0.88,
            "lighting_harmony_score": 0.85,
            "readability_score": 0.92,
            "notes": ["Product zone has strong focal contrast.", "Negative space in text zone is unobstructed."],
            "advisory_warnings": [],
        }
