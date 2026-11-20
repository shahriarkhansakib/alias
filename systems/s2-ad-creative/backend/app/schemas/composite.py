from enum import Enum
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field, ConfigDict
from app.schemas.platform import TargetPlatform
from app.schemas.background import QAStatus, DiagnosticCheck


class PlacementAlignment(str, Enum):
    CENTER = "center"
    BOTTOM = "bottom"
    LEFT = "left"
    RIGHT = "right"
    TOP = "top"


class ProductPlacementConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scale: float = Field(default=0.90, ge=0.1, le=1.5, description="Scale factor relative to product-safe slot bounds")
    alignment: PlacementAlignment = Field(default=PlacementAlignment.CENTER, description="Alignment within product-safe region")
    padding_pct: float = Field(default=0.05, ge=0.0, le=0.5, description="Padding inside the product-safe slot")
    offset_x: int = Field(default=0, description="Manual horizontal pixel nudge")
    offset_y: int = Field(default=0, description="Manual vertical pixel nudge")


class ShadowConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = Field(default=True, description="Whether to render deterministic contact/drop shadow")
    opacity: float = Field(default=0.35, ge=0.0, le=1.0, description="Shadow opacity")
    blur_radius: float = Field(default=15.0, ge=0.0, le=100.0, description="Gaussian blur radius for soft shadow edge")
    offset_x: int = Field(default=0, description="Horizontal shadow offset in pixels")
    offset_y: int = Field(default=15, description="Vertical shadow offset in pixels")


class CutoutMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str
    model_name: str
    input_dimensions: List[int]
    output_dimensions: List[int]
    alpha_coverage: float
    bounding_box: List[int]
    opaque_pixels: int
    processing_time_ms: float
    status: str


class CutoutQAResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: QAStatus
    overall_score: float = Field(..., ge=0.0, le=1.0)
    is_readable: bool
    has_alpha: bool
    alpha_coverage: float
    bounding_box: List[int]
    opaque_pixel_count: int
    issues: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    details: str = ""


class PixelPlacementResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: int
    y: int
    width: int
    height: int
    normalized_slot: List[float]
    canvas_width: int
    canvas_height: int


class CompositeQAResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: QAStatus
    overall_score: float = Field(..., ge=0.0, le=1.0)
    dimension_check: DiagnosticCheck
    placement_check: DiagnosticCheck
    visibility_check: DiagnosticCheck
    boundary_check: DiagnosticCheck
    integrity_check: DiagnosticCheck
    issues: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    diagnostics: Dict[str, Any] = Field(default_factory=dict)


class ProductIntegrityMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_asset_id: str
    source_asset_hash: str
    cutout_hash: str
    background_id: str
    output_hash: str
    compositing_method: str = "deterministic_alpha_composite"


class CompositeGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    background_id: str = Field(..., description="ID of approved GeneratedBackgroundRecord")
    product_image_url: Optional[str] = Field(default=None, description="Optional override product image URL to composite onto background")
    placement: Optional[ProductPlacementConfig] = Field(default=None, description="Optional product placement configuration")
    shadow: Optional[ShadowConfig] = Field(default=None, description="Optional shadow configuration")
    force_regenerate: bool = Field(default=False, description="Bypass cache and force recompositing")


class CompositeRegenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_image_url: Optional[str] = Field(default=None, description="Optional override product image URL to composite onto background")
    placement: Optional[ProductPlacementConfig] = Field(default=None, description="Updated placement parameters")
    shadow: Optional[ShadowConfig] = Field(default=None, description="Updated shadow parameters")
    custom_feedback: Optional[str] = Field(default=None, max_length=300, description="Optional adjustment feedback")


class CompositeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    job_id: str
    strategy_id: str
    brief_id: Optional[str] = None
    background_id: str
    platform: TargetPlatform
    width: int
    height: int
    aspect_ratio: str
    image_url: str
    cutout_url: Optional[str] = None
    placement_spec: Dict[str, Any]
    shadow_spec: Dict[str, Any]
    integrity_metadata: Dict[str, Any]
    qa_status: QAStatus
    qa_result: CompositeQAResult
    attempt_number: int
    is_cached: bool = False
    created_at: str
