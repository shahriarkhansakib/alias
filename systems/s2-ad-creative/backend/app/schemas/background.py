from enum import Enum
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field, ConfigDict
from app.schemas.platform import TargetPlatform


class QAStatus(str, Enum):
    PASS = "PASS"
    WARNING = "WARNING"
    FAIL = "FAIL"


class DiagnosticCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    passed: bool
    score: float = Field(..., ge=0.0, le=1.0)
    severity: QAStatus
    details: str
    metrics: Dict[str, Any] = Field(default_factory=dict)


class BackgroundQAResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: QAStatus
    overall_score: float = Field(..., ge=0.0, le=1.0)
    dimension_check: DiagnosticCheck
    text_artifact_check: DiagnosticCheck
    watermark_check: DiagnosticCheck
    extra_object_check: DiagnosticCheck
    negative_space_check: DiagnosticCheck
    product_safe_zone_check: DiagnosticCheck
    brightness_check: DiagnosticCheck
    issues: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    retry_guidance: Optional[str] = None


class BackgroundGenerationPrompt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    positive_prompt: str
    negative_prompt: str
    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)
    aspect_ratio: str
    platform: TargetPlatform
    template_id: str
    prompt_version: str = "v1"
    metadata: Dict[str, Any] = Field(default_factory=dict)


class BackgroundGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    strategy_id: str = Field(..., description="ID of approved CreativeStrategyRecord")
    platform: TargetPlatform = Field(default=TargetPlatform.INSTAGRAM, description="Target ad platform")
    force_regenerate: bool = Field(default=False, description="Bypass cache and force a new generation")
    generation_params: Optional[Dict[str, Any]] = Field(default=None, description="Optional deterministic generation parameters (seed, steps, guidance_scale, sampler, etc.)")


class BackgroundRegenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    custom_feedback: Optional[str] = Field(None, max_length=300, description="Optional developer debug feedback")
    generation_params: Optional[Dict[str, Any]] = Field(default=None, description="Optional deterministic generation parameters")


class BackgroundResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    job_id: str
    strategy_id: str
    platform: TargetPlatform
    width: int
    height: int
    aspect_ratio: str
    image_url: str
    qa_status: QAStatus
    qa_result: BackgroundQAResult
    attempt_number: int
    prompt: BackgroundGenerationPrompt
    provider: str
    model_name: str
    generation_params: Optional[Dict[str, Any]] = None
    is_cached: bool = False
    created_at: str
