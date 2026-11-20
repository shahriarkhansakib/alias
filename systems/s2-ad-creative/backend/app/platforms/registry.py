from typing import Dict, List, Optional, Union
from pydantic import BaseModel, ConfigDict, Field
from app.schemas.platform import TargetPlatform, PlatformCreativeSpec
from app.schemas.strategy import CreativeStrategySpec
from app.templates.registry import get_template_slots, SlotBounds


class PlatformDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform: TargetPlatform
    name: str
    target_width: int = Field(..., gt=0)
    target_height: int = Field(..., gt=0)
    aspect_ratio: str
    creative_characteristics: List[str]
    default_style_notes: str


SUPPORTED_PLATFORMS: Dict[TargetPlatform, PlatformDefinition] = {
    TargetPlatform.INSTAGRAM: PlatformDefinition(
        platform=TargetPlatform.INSTAGRAM,
        name="Instagram Feed / Carousel",
        target_width=1080,
        target_height=1350,
        aspect_ratio="4:5",
        creative_characteristics=[
            "strong visual hierarchy",
            "product-focused composition",
            "sufficient negative space for headline",
            "mobile-first readability",
            "avoid unnecessary fine details",
        ],
        default_style_notes="Vertical portrait composition optimized for mobile feed viewing. Clean negative space top/left for typography.",
    ),
    TargetPlatform.FACEBOOK: PlatformDefinition(
        platform=TargetPlatform.FACEBOOK,
        name="Facebook Feed",
        target_width=1080,
        target_height=1080,
        aspect_ratio="1:1",
        creative_characteristics=[
            "balanced composition",
            "strong product-safe region",
            "clear text-safe region",
            "suitable for feed placement",
        ],
        default_style_notes="Square canvas with symmetrical or balanced side-by-side distribution. Product focus balanced with unobstructed text area.",
    ),
    TargetPlatform.LINKEDIN: PlatformDefinition(
        platform=TargetPlatform.LINKEDIN,
        name="LinkedIn Sponsored Content",
        target_width=1200,
        target_height=628,
        aspect_ratio="1.91:1",
        creative_characteristics=[
            "professional visual language",
            "controlled composition",
            "generous text-safe region",
            "avoid overly decorative or noisy backgrounds",
        ],
        default_style_notes="Wide landscape format. Sleek, polished corporate technology aesthetic with generous negative space on the left.",
    ),
}


def get_platform_definition(platform: Union[str, TargetPlatform]) -> PlatformDefinition:
    if isinstance(platform, str):
        try:
            platform_enum = TargetPlatform(platform.lower().strip())
        except ValueError:
            valid = [p.value for p in TargetPlatform]
            raise ValueError(f"Unsupported platform '{platform}'. Supported platforms are: {valid}")
    else:
        platform_enum = platform

    definition = SUPPORTED_PLATFORMS.get(platform_enum)
    if not definition:
        raise ValueError(f"Platform definition for '{platform_enum}' not found in registry")
    return definition


def list_supported_platforms() -> List[PlatformDefinition]:
    return list(SUPPORTED_PLATFORMS.values())


def build_platform_creative_spec(
    platform: Union[str, TargetPlatform],
    strategy: CreativeStrategySpec,
) -> PlatformCreativeSpec:
    """
    Deterministic translation of CreativeStrategySpec + Template Layout Constraints
    into an authoritative PlatformCreativeSpec.
    Ensures the LLM does NOT decide arbitrary canvas dimensions at runtime.
    """
    plat_def = get_platform_definition(platform)

    # Fetch template slot constraints for this platform's exact aspect ratio
    slots = get_template_slots(strategy.template_id, plat_def.aspect_ratio)
    if not slots:
        # Fallback to 1:1 if template does not have specialized ratio
        slots = get_template_slots(strategy.template_id, "1:1")
        if not slots:
            raise ValueError(f"Template '{strategy.template_id}' has no slot definitions")

    # Safe region coordinate summaries for prompt context
    text_bounds = slots.text_safe_slot
    prod_bounds = slots.product_slot

    neg_space_desc = (
        f"Region [x: {text_bounds.x:.2f}-{text_bounds.x + text_bounds.width:.2f}, "
        f"y: {text_bounds.y:.2f}-{text_bounds.y + text_bounds.height:.2f}] is designated text-safe space. "
        f"Must maintain low edge complexity, clean gradient/shadow, and uncluttered texture for overlay copy."
    )

    composition_desc = (
        f"Format {plat_def.aspect_ratio} ({plat_def.target_width}x{plat_def.target_height}). "
        f"Product area centered at [x: {prod_bounds.x + prod_bounds.width/2:.2f}, y: {prod_bounds.y + prod_bounds.height/2:.2f}]. "
        f"Visual flow: {', '.join(plat_def.creative_characteristics)}."
    )

    lighting_desc = f"{strategy.visual_direction.lighting}. High contrast separation between environment and future product stage."
    color_desc = f"Ambient mood: {strategy.visual_direction.mood}. Sophisticated color palette tailored for {plat_def.name}."

    # Strict prohibitions
    background_constraints = [
        "NO text, typography, letters, digits, or glyphs",
        "NO products, smartphones, watches, earbuds, or commercial objects",
        "NO logos, watermarks, signatures, or brand emblems",
        "NO human faces, bodies, or portraits",
        "NO fake product packaging, price tags, or CTA buttons",
        "Low texture density in designated text-safe region",
        "Unobstructed empty stage in designated product-safe region",
    ]

    return PlatformCreativeSpec(
        platform=plat_def.platform,
        target_width=plat_def.target_width,
        target_height=plat_def.target_height,
        aspect_ratio=plat_def.aspect_ratio,
        background_style=f"{strategy.visual_direction.mood} studio scenery",
        visual_direction=strategy.visual_direction.background_direction,
        product_safe_region=slots.product_slot,
        text_safe_region=slots.text_safe_slot,
        cta_safe_region=slots.cta_safe_slot,
        logo_safe_region=slots.logo_safe_slot,
        composition_direction=composition_desc,
        lighting_direction=lighting_desc,
        color_direction=color_desc,
        required_negative_space=neg_space_desc,
        background_constraints=background_constraints,
        generation_prompt_parameters={
            "width": plat_def.target_width,
            "height": plat_def.target_height,
            "aspect_ratio": plat_def.aspect_ratio,
            "platform_name": plat_def.name,
        },
    )
