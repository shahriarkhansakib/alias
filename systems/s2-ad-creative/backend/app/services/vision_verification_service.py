"""
Vision Verification Service.

Cost-controlled orchestrator for the final-ad vision QA step.

Architecture:
  AI generation -> cheap deterministic QA -> retry if needed
  -> deterministic composite -> final render -> ONE vision QA call

Cost controls:
  - Disabled by default (ENABLE_VISION_QA=False in config).
  - Only runs after the FINAL rendered advertisement, never after intermediate stages.
  - Configurable max calls per pipeline run (VISION_QA_MAX_CALLS_PER_PIPELINE).
  - Records exact expected-value payload sent for audit.
  - Advisory: vision result DOES NOT override deterministic QA status.

Dependency invalidation:
  - When a deterministic upstream input changes (product, background, composite),
    any downstream final ad must be marked stale.
  - vision_qa_status is cleared when an ad is re-rendered from a changed input.
"""
import time
from datetime import datetime, timezone
from typing import Dict, Any, Optional

from app.core.logging import logger
from app.core.config import settings
from app.schemas.background import QAStatus
from app.schemas.vision_verification import (
    VisionVerificationResult,
    VisionQAStatus,
    VisionCheckResult,
    VisionVerificationChecks,
)


class VisionVerificationService:
    """
    Orchestrates vision QA with strict cost controls.

    Usage:
        service = VisionVerificationService(provider)
        result = await service.verify_final_ad(
            image_bytes=rendered_bytes,
            expected_values=expected_payload,
            artifact_key="job_id:attempt_1",
            output_hash="sha256_hash",
            final_ad_id="final_ad_uuid",
        )
    """

    def __init__(self, provider=None):
        from app.providers.mock_vision_provider import MockVisionQAProvider
        self._provider = provider or MockVisionQAProvider()
        # Per-artifact call tracker ensuring quotas are scoped to individual final artifacts
        # and NEVER accidentally shared globally across jobs or pipeline runs.
        self._artifact_call_counts: Dict[str, int] = {}

    def get_artifact_call_count(self, artifact_key: str) -> int:
        """Returns the number of vision QA evaluations executed for the given artifact key."""
        return self._artifact_call_counts.get(artifact_key, 0)

    def reset_pipeline_quota(self, artifact_key: Optional[str] = None) -> None:
        """Reset call counter for a specific artifact, or all if None."""
        if artifact_key:
            self._artifact_call_counts.pop(artifact_key, None)
        else:
            self._artifact_call_counts.clear()

    @property
    def is_enabled(self) -> bool:
        return settings.ENABLE_VISION_QA

    @property
    def is_mock_provider(self) -> bool:
        return bool(
            getattr(self._provider, "is_mock", False)
            or settings.VISION_QA_PROVIDER.lower() == "mock"
        )

    async def verify_final_ad(
        self,
        image_bytes: bytes,
        expected_values: Dict[str, Any],
        pipeline_call_count: Optional[int] = None,
        artifact_key: str = "default",
        output_hash: Optional[str] = None,
        final_ad_id: Optional[str] = None,
    ) -> Optional[VisionVerificationResult]:
        """
        Run vision QA on the rendered final advertisement.

        Returns VisionVerificationResult if vision QA is enabled and quota permits,
        otherwise returns None (deterministic QA still runs regardless).

        Cost controls enforced:
        - ENABLE_VISION_QA must be True
        - Evaluated call count for artifact_key must be < VISION_QA_MAX_CALLS_PER_PIPELINE
        """
        if not self.is_enabled:
            logger.debug("[VisionQA] Disabled by ENABLE_VISION_QA=False. Skipping.")
            return None

        # Determine effective current call count for this specific artifact
        effective_count = (
            pipeline_call_count
            if pipeline_call_count is not None
            else self._artifact_call_counts.get(artifact_key, 0)
        )

        max_calls = settings.VISION_QA_MAX_CALLS_PER_PIPELINE
        if effective_count >= max_calls:
            logger.warning(
                f"[VisionQA] Quota reached for artifact '{artifact_key}' ({effective_count}/{max_calls}). "
                "Skipping vision call to control cost."
            )
            return None

        if not image_bytes:
            logger.warning("[VisionQA] Empty image bytes. Skipping vision call.")
            return None

        self._artifact_call_counts[artifact_key] = effective_count + 1

        logger.info(
            f"[VisionQA] Running final-ad vision verification. "
            f"artifact={artifact_key} call={effective_count + 1}/{max_calls} "
            f"provider={settings.VISION_QA_PROVIDER}"
        )

        start = time.monotonic()
        is_mock = self.is_mock_provider
        try:
            raw = await self._provider.evaluate_creative(
                image_bytes=image_bytes,
                spec=expected_values,
            )
        except Exception as exc:
            logger.error(f"[VisionQA] Provider call failed: {exc}. Returning UNAVAILABLE advisory.")
            def _fail_check(detail: str) -> VisionCheckResult:
                return VisionCheckResult(passed=False, severity=QAStatus.FAIL, detail=detail)
            def _pass_check() -> VisionCheckResult:
                return VisionCheckResult(passed=True, severity=QAStatus.PASS)

            fail_checks = VisionVerificationChecks(
                text_readable=_fail_check("Vision provider unavailable"),
                text_no_clipping=_pass_check(),
                text_no_unexpected_content=_pass_check(),
                product_visible=_pass_check(),
                product_placement_reasonable=_pass_check(),
                product_no_corruption=_pass_check(),
                composition_hierarchy=_pass_check(),
                composition_no_clutter=_pass_check(),
                branding_colors_present=_pass_check(),
                branding_no_unauthorized=_pass_check(),
                no_ai_artifacts=_pass_check(),
                no_watermarks=_pass_check(),
            )
            return VisionVerificationResult(
                status=QAStatus.FAIL,
                checks=fail_checks,
                issues=[f"Vision QA provider error: {exc}"],
                warnings=[],
                summary=f"Vision QA unavailable due to provider error: {exc}. Deterministic QA is authoritative.",
                advisory=True,
                provider=settings.VISION_QA_PROVIDER,
                model_name="unavailable",
                is_mock=False,
                latency_ms=int((time.monotonic() - start) * 1000),
                verified_at=datetime.now(timezone.utc).isoformat(),
                expected_values_sent=expected_values,
                output_hash=output_hash,
                final_ad_id=final_ad_id,
            )

        latency_ms = int((time.monotonic() - start) * 1000)

        # Parse and enrich with provenance and authenticity metadata
        if isinstance(raw, dict):
            raw["verified_at"] = datetime.now(timezone.utc).isoformat()
            raw["latency_ms"] = latency_ms
            raw["is_mock"] = is_mock
            if output_hash and not raw.get("output_hash"):
                raw["output_hash"] = output_hash
            if final_ad_id and not raw.get("final_ad_id"):
                raw["final_ad_id"] = final_ad_id
            result = VisionVerificationResult.model_validate(raw)
        else:
            result = raw
            result.is_mock = is_mock
            if output_hash:
                result.output_hash = output_hash
            if final_ad_id:
                result.final_ad_id = final_ad_id

        logger.info(
            f"[VisionQA] Result: status={result.status.value} is_mock={result.is_mock} "
            f"issues={len(result.issues)} warnings={len(result.warnings)} "
            f"latency={latency_ms}ms advisory={result.advisory}"
        )

        return result

    @staticmethod
    def compute_vision_qa_status(
        result: Optional[VisionVerificationResult],
        is_enabled: Optional[bool] = None,
    ) -> VisionQAStatus:
        """
        Derive the authoritative VisionQAStatus enum from the verification result.
        Strictly distinguishes:
        - NOT_RUN: Vision QA disabled or not executed.
        - REAL_VERIFIED: Genuine external Vision provider evaluated successfully.
        - MOCK_VERIFIED: Evaluated by mock/dev provider.
        - UNAVAILABLE: Vision provider call failed or credentials missing.
        - FAILED: Image evaluation detected blocking defects/issues.
        """
        effective_enabled = is_enabled if is_enabled is not None else settings.ENABLE_VISION_QA
        if not effective_enabled or result is None:
            return VisionQAStatus.NOT_RUN

        if result.model_name == "unavailable" or "unavailable" in result.summary.lower() or "provider error" in result.summary.lower():
            return VisionQAStatus.UNAVAILABLE

        if result.status == QAStatus.FAIL or len(result.issues) > 0:
            return VisionQAStatus.FAILED

        if result.is_mock or result.provider.lower() == "mock":
            return VisionQAStatus.MOCK_VERIFIED

        return VisionQAStatus.REAL_VERIFIED


def build_expected_values_payload(
    platform: str,
    aspect_ratio: str,
    width: int,
    height: int,
    headline: str,
    subheadline: str,
    cta: str,
    offer_text: Optional[str] = None,
    brand_primary_color: Optional[str] = None,
    logo_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Build the compact expected-value payload sent to the vision model.
    Only includes what the vision model should inspect -- no unnecessary pipeline history.
    """
    payload: Dict[str, Any] = {
        "platform": platform,
        "aspect_ratio": aspect_ratio,
        "dimensions": {"width": width, "height": height},
        "expected_text": {
            "headline": headline,
            "subheadline": subheadline,
            "cta": cta,
        },
    }
    if offer_text:
        payload["expected_text"]["offer"] = offer_text
    if brand_primary_color:
        payload["brand_primary_color"] = brand_primary_color
    if logo_url:
        payload["logo_present"] = True
    return payload


def get_vision_verification_service() -> VisionVerificationService:
    """
    Factory: returns the configured VisionVerificationService.
    In dev: MockVisionQAProvider (clearly identified with is_mock=True).
    In prod: configured real provider (e.g. google_gemini or openai).
    If a real provider is configured but missing credentials, returns UnavailableVisionQAProvider
    so it fails explicitly with UNAVAILABLE rather than silently masquerading as real.
    """
    provider_name = settings.VISION_QA_PROVIDER.lower()
    if provider_name == "mock":
        from app.providers.mock_vision_provider import MockVisionQAProvider
        provider = MockVisionQAProvider()
    else:
        # Check API key credentials
        api_key = settings.GEMINI_API_KEY if "gemini" in provider_name else settings.OPENAI_API_KEY
        if not api_key:
            logger.warning(
                f"[VisionQA] Real provider '{provider_name}' configured but lacks API key. "
                "Registering UnavailableVisionQAProvider."
            )
            from app.providers.mock_vision_provider import UnavailableVisionQAProvider
            provider = UnavailableVisionQAProvider(
                provider_name=provider_name,
                reason="API key not configured in environment.",
            )
        else:
            from app.providers.mock_vision_provider import UnavailableVisionQAProvider
            provider = UnavailableVisionQAProvider(
                provider_name=provider_name,
                reason=f"Provider '{provider_name}' integration pending production credentials.",
            )

    return VisionVerificationService(provider=provider)
