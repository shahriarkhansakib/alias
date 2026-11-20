from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field, ConfigDict
from app.schemas.platform import TargetPlatform
from app.schemas.background import QAStatus, DiagnosticCheck


class TypographyStyle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    font_family: str = Field(default="Inter", description="Registered font family name")
    headline_size: int = Field(default=52, ge=18, le=120, description="Headline font size in px")
    headline_weight: str = Field(default="bold", description="Font weight: 'regular' or 'bold'")
    subheadline_size: int = Field(default=26, ge=12, le=72, description="Subheadline font size in px")
    subheadline_weight: str = Field(default="regular", description="Font weight: 'regular' or 'bold'")
    headline_color: str = Field(default="#FFFFFF", description="Hex color code for headline")
    subheadline_color: str = Field(default="#CBD5E1", description="Hex color code for subheadline")
    line_height_multiplier: float = Field(default=1.25, ge=1.0, le=2.0, description="Line height spacing factor")
    alignment: str = Field(default="left", description="Text alignment: 'left', 'center', or 'right'")


class CTAStyle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = Field(default=True, description="Whether to render CTA button container")
    bg_color: str = Field(default="#3B82F6", description="CTA button background hex color")
    text_color: str = Field(default="#FFFFFF", description="CTA text hex color")
    border_radius: int = Field(default=10, ge=0, le=50, description="Corner radius in px")
    font_size: int = Field(default=24, ge=12, le=48, description="CTA font size in px")
    padding_x: int = Field(default=32, ge=8, le=80, description="Horizontal padding in px")
    padding_y: int = Field(default=14, ge=4, le=40, description="Vertical padding in px")


class PriceBadgeStyle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = Field(default=True, description="Render price badge if explicitly provided in brief/strategy")
    bg_color: str = Field(default="#EF4444", description="Badge background hex color")
    text_color: str = Field(default="#FFFFFF", description="Badge text hex color")
    border_radius: int = Field(default=8, ge=0, le=40, description="Badge corner radius")
    font_size: int = Field(default=26, ge=14, le=50, description="Badge font size")


class ReadabilityEnhancementConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    auto_scrim: bool = Field(default=True, description="Apply deterministic backplate/gradient scrim if background has high brightness")
    scrim_opacity: float = Field(default=0.45, ge=0.0, le=1.0, description="Maximum scrim opacity")


class FinalAdProvenance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_asset_id: str
    source_asset_hash: str
    cutout_hash: str
    background_id: str
    composite_id: str
    composite_output_hash: str
    copy_hash: str
    font_hashes: Dict[str, str]
    output_hash: str
    renderer_version: str = "deterministic_ad_renderer_v1"


class FinalAdQAResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: QAStatus
    overall_score: float = Field(..., ge=0.0, le=1.0)
    dimension_check: DiagnosticCheck
    opacity_check: DiagnosticCheck
    text_safe_zone_check: DiagnosticCheck
    exact_copy_check: DiagnosticCheck
    cta_check: DiagnosticCheck
    product_occlusion_check: DiagnosticCheck
    contrast_check: DiagnosticCheck
    checks: List[DiagnosticCheck] = Field(default_factory=list)
    issues: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    diagnostics: Dict[str, Any] = Field(default_factory=dict)


class FinalAdGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    composite_id: str = Field(..., description="ID of approved CompositedCreativeRecord")
    typography: Optional[TypographyStyle] = Field(default=None, description="Optional typography customizations")
    cta: Optional[CTAStyle] = Field(default=None, description="Optional CTA button styling")
    price_badge: Optional[PriceBadgeStyle] = Field(default=None, description="Optional price badge styling")
    readability: Optional[ReadabilityEnhancementConfig] = Field(default=None, description="Readability settings")
    force_regenerate: bool = Field(default=False, description="Bypass cache and force re-render")


class FinalAdRegenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    typography: Optional[TypographyStyle] = Field(default=None, description="Updated typography parameters")
    cta: Optional[CTAStyle] = Field(default=None, description="Updated CTA styling")
    price_badge: Optional[PriceBadgeStyle] = Field(default=None, description="Updated price badge styling")
    readability: Optional[ReadabilityEnhancementConfig] = Field(default=None, description="Updated readability settings")
    custom_feedback: Optional[str] = Field(default=None, max_length=300, description="Optional adjustment notes")


class FinalAdResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    job_id: str
    strategy_id: str
    brief_id: Optional[str] = None
    composite_id: str
    background_id: str
    platform: TargetPlatform
    width: int
    height: int
    aspect_ratio: str
    image_url: str
    copy_spec: Dict[str, Any]
    typography_spec: Dict[str, Any]
    cta_spec: Dict[str, Any]
    logo_spec: Optional[Dict[str, Any]] = None
    price_badge_spec: Optional[Dict[str, Any]] = None
    readability_spec: Dict[str, Any]
    provenance_chain: Dict[str, Any]
    qa_status: QAStatus
    qa_result: FinalAdQAResult
    attempt_number: int
    is_cached: bool = False
    created_at: str

    # Vision QA — advisory, runs only after final render when ENABLE_VISION_QA=True
    # None means vision QA has not run (disabled or not yet executed).
    vision_qa_status: Optional[str] = None
    vision_qa_result: Optional[Dict[str, Any]] = None

    # Dependency invalidation — True when an upstream input has changed
    # and this final ad must be re-rendered before it can be approved.
    is_stale: bool = False
