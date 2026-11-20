from enum import Enum
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field, model_validator, ConfigDict


class TemplatePlacement(str, Enum):
    LEFT = "left"
    RIGHT = "right"
    CENTER = "center"


class SlotBounds(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(..., ge=0.0, le=1.0, description="Normalized horizontal origin [0.0, 1.0]")
    y: float = Field(..., ge=0.0, le=1.0, description="Normalized vertical origin [0.0, 1.0]")
    width: float = Field(..., gt=0.0, le=1.0, description="Normalized slot width (> 0.0)")
    height: float = Field(..., gt=0.0, le=1.0, description="Normalized slot height (> 0.0)")

    @model_validator(mode="after")
    def validate_bounds(self) -> "SlotBounds":
        # Coordinates must not exceed canvas boundaries (1.0)
        if self.x + self.width > 1.00001:
            raise ValueError(
                f"Slot extends outside canvas horizontally: x ({self.x}) + width ({self.width}) = {self.x + self.width:.4f} > 1.0"
            )
        if self.y + self.height > 1.00001:
            raise ValueError(
                f"Slot extends outside canvas vertically: y ({self.y}) + height ({self.height}) = {self.y + self.height:.4f} > 1.0"
            )
        return self

    def to_coordinates(self) -> List[float]:
        return [round(self.x, 4), round(self.y, 4), round(self.width, 4), round(self.height, 4)]


class AspectRatioSlots(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_slot: SlotBounds = Field(..., description="Normalized bounding box for product cutout")
    text_safe_slot: SlotBounds = Field(..., description="Normalized text safe area")
    cta_safe_slot: SlotBounds = Field(..., description="Normalized CTA safe area")
    logo_safe_slot: Optional[SlotBounds] = Field(None, description="Optional logo safe area")


class CanvasSlotConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slots: Dict[str, AspectRatioSlots] = Field(
        ...,
        description="Slot mapping keyed by aspect ratio e.g. '1:1', '9:16', '16:9'",
    )

    @model_validator(mode="after")
    def validate_required_ratios(self) -> "CanvasSlotConfig":
        required = {"1:1", "9:16", "16:9"}
        missing = required - set(self.slots.keys())
        if missing:
            raise ValueError(f"CanvasSlotConfig must define slots for required aspect ratios: {sorted(missing)}")
        return self


class TemplateMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template_id: str
    name: str
    description: str
    default_product_placement: TemplatePlacement
    default_text_placement: TemplatePlacement
    supports_dark_mode: bool = True
    recommended_for_objectives: List[str] = Field(default_factory=list)
    canvas_slots: CanvasSlotConfig = Field(..., description="Exact placement constraints per aspect ratio")


# Authoritative Template Registry with Deterministic Canvas Slots
SUPPORTED_TEMPLATES: Dict[str, TemplateMetadata] = {
    "product_sale_dark": TemplateMetadata(
        template_id="product_sale_dark",
        name="Product Sale Dark",
        description="High-contrast dark luxury background with product right, prominent left copy, and price badge.",
        default_product_placement=TemplatePlacement.RIGHT,
        default_text_placement=TemplatePlacement.LEFT,
        supports_dark_mode=True,
        recommended_for_objectives=["product_sales", "traffic"],
        canvas_slots=CanvasSlotConfig(
            slots={
                "1:1": AspectRatioSlots(
                    product_slot=SlotBounds(x=0.52, y=0.12, width=0.42, height=0.76),
                    text_safe_slot=SlotBounds(x=0.08, y=0.15, width=0.42, height=0.50),
                    cta_safe_slot=SlotBounds(x=0.08, y=0.70, width=0.35, height=0.12),
                    logo_safe_slot=SlotBounds(x=0.08, y=0.06, width=0.20, height=0.06),
                ),
                "9:16": AspectRatioSlots(
                    product_slot=SlotBounds(x=0.12, y=0.44, width=0.76, height=0.38),
                    text_safe_slot=SlotBounds(x=0.08, y=0.16, width=0.84, height=0.26),
                    cta_safe_slot=SlotBounds(x=0.15, y=0.85, width=0.70, height=0.08),
                    logo_safe_slot=SlotBounds(x=0.08, y=0.08, width=0.25, height=0.05),
                ),
                "16:9": AspectRatioSlots(
                    product_slot=SlotBounds(x=0.52, y=0.10, width=0.42, height=0.80),
                    text_safe_slot=SlotBounds(x=0.06, y=0.22, width=0.42, height=0.50),
                    cta_safe_slot=SlotBounds(x=0.06, y=0.75, width=0.28, height=0.12),
                    logo_safe_slot=SlotBounds(x=0.06, y=0.08, width=0.15, height=0.08),
                ),
                "4:5": AspectRatioSlots(
                    product_slot=SlotBounds(x=0.48, y=0.18, width=0.46, height=0.68),
                    text_safe_slot=SlotBounds(x=0.08, y=0.18, width=0.38, height=0.48),
                    cta_safe_slot=SlotBounds(x=0.08, y=0.72, width=0.35, height=0.10),
                    logo_safe_slot=SlotBounds(x=0.08, y=0.06, width=0.22, height=0.06),
                ),
                "1.91:1": AspectRatioSlots(
                    product_slot=SlotBounds(x=0.55, y=0.10, width=0.40, height=0.80),
                    text_safe_slot=SlotBounds(x=0.06, y=0.18, width=0.45, height=0.54),
                    cta_safe_slot=SlotBounds(x=0.06, y=0.76, width=0.26, height=0.14),
                    logo_safe_slot=SlotBounds(x=0.06, y=0.06, width=0.16, height=0.08),
                ),
            }
        ),
    ),
    "product_launch": TemplateMetadata(
        template_id="product_launch",
        name="Product Launch Showcase",
        description="Dramatic atmospheric scene with centered or balanced product placement for bold brand announcements.",
        default_product_placement=TemplatePlacement.CENTER,
        default_text_placement=TemplatePlacement.LEFT,
        supports_dark_mode=True,
        recommended_for_objectives=["brand_awareness", "engagement"],
        canvas_slots=CanvasSlotConfig(
            slots={
                "1:1": AspectRatioSlots(
                    product_slot=SlotBounds(x=0.18, y=0.38, width=0.64, height=0.46),
                    text_safe_slot=SlotBounds(x=0.10, y=0.14, width=0.80, height=0.22),
                    cta_safe_slot=SlotBounds(x=0.32, y=0.86, width=0.36, height=0.09),
                    logo_safe_slot=SlotBounds(x=0.40, y=0.05, width=0.20, height=0.06),
                ),
                "9:16": AspectRatioSlots(
                    product_slot=SlotBounds(x=0.12, y=0.42, width=0.76, height=0.42),
                    text_safe_slot=SlotBounds(x=0.08, y=0.15, width=0.84, height=0.24),
                    cta_safe_slot=SlotBounds(x=0.20, y=0.86, width=0.60, height=0.08),
                    logo_safe_slot=SlotBounds(x=0.38, y=0.08, width=0.24, height=0.05),
                ),
                "16:9": AspectRatioSlots(
                    product_slot=SlotBounds(x=0.50, y=0.12, width=0.44, height=0.76),
                    text_safe_slot=SlotBounds(x=0.06, y=0.22, width=0.42, height=0.50),
                    cta_safe_slot=SlotBounds(x=0.06, y=0.76, width=0.26, height=0.12),
                    logo_safe_slot=SlotBounds(x=0.06, y=0.08, width=0.15, height=0.08),
                ),
                "4:5": AspectRatioSlots(
                    product_slot=SlotBounds(x=0.16, y=0.36, width=0.68, height=0.44),
                    text_safe_slot=SlotBounds(x=0.08, y=0.12, width=0.84, height=0.22),
                    cta_safe_slot=SlotBounds(x=0.28, y=0.84, width=0.44, height=0.09),
                    logo_safe_slot=SlotBounds(x=0.38, y=0.05, width=0.24, height=0.05),
                ),
                "1.91:1": AspectRatioSlots(
                    product_slot=SlotBounds(x=0.52, y=0.12, width=0.42, height=0.76),
                    text_safe_slot=SlotBounds(x=0.06, y=0.18, width=0.44, height=0.54),
                    cta_safe_slot=SlotBounds(x=0.06, y=0.76, width=0.26, height=0.14),
                    logo_safe_slot=SlotBounds(x=0.06, y=0.06, width=0.16, height=0.08),
                ),
            }
        ),
    ),
    "minimal_feature": TemplateMetadata(
        template_id="minimal_feature",
        name="Minimalist Feature Focus",
        description="Clean, distraction-free negative space tailored for highlighting key specifications and claims.",
        default_product_placement=TemplatePlacement.RIGHT,
        default_text_placement=TemplatePlacement.LEFT,
        supports_dark_mode=True,
        recommended_for_objectives=["product_sales", "lead_generation"],
        canvas_slots=CanvasSlotConfig(
            slots={
                "1:1": AspectRatioSlots(
                    product_slot=SlotBounds(x=0.54, y=0.14, width=0.40, height=0.72),
                    text_safe_slot=SlotBounds(x=0.08, y=0.16, width=0.42, height=0.54),
                    cta_safe_slot=SlotBounds(x=0.08, y=0.74, width=0.30, height=0.12),
                    logo_safe_slot=SlotBounds(x=0.08, y=0.06, width=0.18, height=0.06),
                ),
                "9:16": AspectRatioSlots(
                    product_slot=SlotBounds(x=0.15, y=0.48, width=0.70, height=0.36),
                    text_safe_slot=SlotBounds(x=0.08, y=0.16, width=0.84, height=0.28),
                    cta_safe_slot=SlotBounds(x=0.15, y=0.86, width=0.70, height=0.08),
                    logo_safe_slot=SlotBounds(x=0.08, y=0.08, width=0.22, height=0.05),
                ),
                "16:9": AspectRatioSlots(
                    product_slot=SlotBounds(x=0.54, y=0.12, width=0.40, height=0.76),
                    text_safe_slot=SlotBounds(x=0.06, y=0.20, width=0.44, height=0.52),
                    cta_safe_slot=SlotBounds(x=0.06, y=0.76, width=0.26, height=0.12),
                    logo_safe_slot=SlotBounds(x=0.06, y=0.08, width=0.15, height=0.08),
                ),
                "4:5": AspectRatioSlots(
                    product_slot=SlotBounds(x=0.50, y=0.18, width=0.44, height=0.66),
                    text_safe_slot=SlotBounds(x=0.08, y=0.18, width=0.38, height=0.50),
                    cta_safe_slot=SlotBounds(x=0.08, y=0.74, width=0.32, height=0.10),
                    logo_safe_slot=SlotBounds(x=0.08, y=0.06, width=0.20, height=0.06),
                ),
                "1.91:1": AspectRatioSlots(
                    product_slot=SlotBounds(x=0.55, y=0.12, width=0.38, height=0.76),
                    text_safe_slot=SlotBounds(x=0.06, y=0.18, width=0.45, height=0.54),
                    cta_safe_slot=SlotBounds(x=0.06, y=0.76, width=0.26, height=0.14),
                    logo_safe_slot=SlotBounds(x=0.06, y=0.06, width=0.15, height=0.08),
                ),
            }
        ),
    ),
}


def is_template_registered(template_id: str) -> bool:
    return template_id in SUPPORTED_TEMPLATES


def get_template(template_id: str) -> Optional[TemplateMetadata]:
    return SUPPORTED_TEMPLATES.get(template_id)


def list_registered_templates() -> List[TemplateMetadata]:
    return list(SUPPORTED_TEMPLATES.values())


def get_template_slots(template_id: str, aspect_ratio: str) -> Optional[AspectRatioSlots]:
    """
    Returns placement constraints for a given template and aspect ratio.
    """
    tmpl = get_template(template_id)
    if not tmpl:
        return None
    return tmpl.canvas_slots.slots.get(aspect_ratio)
