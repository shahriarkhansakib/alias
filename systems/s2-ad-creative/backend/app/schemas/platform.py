from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, ConfigDict
from app.templates.registry import SlotBounds


class TargetPlatform(str, Enum):
    INSTAGRAM = "instagram"
    FACEBOOK = "facebook"
    LINKEDIN = "linkedin"


class PlatformCreativeSpec(BaseModel):
    """
    Deterministic Platform Specification layer for Phase 4 Background Generation.
    Translates an approved CreativeStrategySpec and template canvas constraints
    into exact platform generation requirements.
    """
    model_config = ConfigDict(extra="forbid")

    platform: TargetPlatform = Field(..., description="Target ad platform")
    target_width: int = Field(..., gt=0, description="Target pixel width")
    target_height: int = Field(..., gt=0, description="Target pixel height")
    aspect_ratio: str = Field(..., description="Target aspect ratio string (e.g. '4:5', '1:1', '1.91:1')")

    background_style: str = Field(..., description="Aesthetic style description for the scenery")
    visual_direction: str = Field(..., description="Atmospheric environment instructions")
    
    product_safe_region: SlotBounds = Field(..., description="Normalized bounding box reserved for later product compositing")
    text_safe_region: SlotBounds = Field(..., description="Normalized bounding box reserved for later typography overlay")
    cta_safe_region: Optional[SlotBounds] = Field(None, description="Optional bounding box reserved for later CTA button")
    logo_safe_region: Optional[SlotBounds] = Field(None, description="Optional bounding box reserved for brand logo")

    composition_direction: str = Field(..., description="Layout focal balance and visual flow instructions")
    lighting_direction: str = Field(..., description="Lighting contrast, temperature, and specular highlight guidance")
    color_direction: str = Field(..., description="Palette, saturation, and ambient tone instructions")
    required_negative_space: str = Field(..., description="Explicit description of low-frequency zones needed for readability")
    background_constraints: List[str] = Field(default_factory=list, description="Strict prohibitions on scene content")
    generation_prompt_parameters: Dict[str, Any] = Field(default_factory=dict, description="Deterministic provider parameters")
