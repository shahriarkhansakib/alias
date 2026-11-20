"""
Vision Verification Schema.

Structured result type for the post-final-render vision QA check.
Uses the same QAStatus conventions as the rest of the pipeline.
Vision QA is ADVISORY only -- it supplements deterministic checks, never replaces them.
"""
from enum import Enum
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field, ConfigDict
from app.schemas.background import QAStatus


class VisionQAStatus(str, Enum):
    """
    Explicit, auditable gate status for the final ad visual verification stage.
    Ensures mock results are never confused with genuine production model evaluation.
    """
    NOT_RUN = "NOT_RUN"
    REAL_VERIFIED = "REAL_VERIFIED"
    MOCK_VERIFIED = "MOCK_VERIFIED"
    UNAVAILABLE = "UNAVAILABLE"
    FAILED = "FAILED"


class VisionCheckResult(BaseModel):
    """A single boolean vision check -- pass/fail with optional detail."""
    model_config = ConfigDict(extra="forbid")

    passed: bool
    severity: QAStatus
    detail: Optional[str] = None


class VisionVerificationChecks(BaseModel):
    """Structured per-domain check results from vision model inspection."""
    model_config = ConfigDict(extra="forbid")

    # Text domain
    text_readable: VisionCheckResult
    text_no_clipping: VisionCheckResult
    text_no_unexpected_content: VisionCheckResult

    # Product domain
    product_visible: VisionCheckResult
    product_placement_reasonable: VisionCheckResult
    product_no_corruption: VisionCheckResult

    # Composition domain
    composition_hierarchy: VisionCheckResult
    composition_no_clutter: VisionCheckResult

    # Branding domain
    branding_colors_present: VisionCheckResult
    branding_no_unauthorized: VisionCheckResult

    # Artifact domain
    no_ai_artifacts: VisionCheckResult
    no_watermarks: VisionCheckResult


class VisionVerificationResult(BaseModel):
    """
    Top-level structured result for one final-ad vision verification run.

    status:   PASS / WARNING / FAIL -- overall gate decision.
    checks:   Per-domain structured boolean results.
    issues:   Actionable blocking issues (FAIL-level).
    warnings: Non-blocking concerns (WARNING-level).
    summary:  Human-readable brief from the vision model.
    advisory: True -- vision QA is advisory; deterministic QA is authoritative.
    """
    model_config = ConfigDict(extra="forbid")

    status: QAStatus
    checks: VisionVerificationChecks
    issues: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    summary: str
    advisory: bool = True

    # Provenance / cost tracking & authenticity
    provider: str = "mock"
    model_name: str = "mock-vision-v1"
    is_mock: bool = True
    verification_id: Optional[str] = None
    generation_id: Optional[str] = None
    output_hash: Optional[str] = None
    final_ad_id: Optional[str] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    latency_ms: Optional[int] = None
    verified_at: Optional[str] = None

    # Expected-value payload sent to the vision model (for audit)
    expected_values_sent: Dict[str, Any] = Field(default_factory=dict)
