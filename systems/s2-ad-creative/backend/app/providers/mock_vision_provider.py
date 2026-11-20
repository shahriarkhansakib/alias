"""
Mock Vision QA Provider.

Deterministic structured mock for development and testing.
Returns a realistic PASS result without calling any external API.
In production replace with a real provider (e.g. Google Gemini Vision).
"""
import time
import uuid
from typing import Dict, Any, Optional

from app.providers.base import VisionQAProvider
from app.schemas.background import QAStatus
from app.schemas.vision_verification import (
    VisionCheckResult,
    VisionVerificationChecks,
    VisionVerificationResult,
)
from app.core.logging import logger


class MockVisionQAProvider(VisionQAProvider):
    """
    Mock Vision QA provider for dev/test.
    Always returns a deterministic PASS with full structured output.
    Supports override_status injection for testing WARNING/FAIL paths.
    """

    def __init__(self, override_status: Optional[str] = None, override_issues: Optional[list] = None):
        self.override_status = override_status  # "PASS" | "WARNING" | "FAIL"
        self.override_issues = override_issues or []
        self.is_mock = True

    async def evaluate_creative(
        self,
        image_bytes: bytes,
        spec: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Structured mock evaluation. Returns a dict conforming to VisionVerificationResult.
        Does NOT call any LLM or vision API.
        """
        start = time.monotonic()

        status_str = self.override_status or "PASS"
        status = QAStatus(status_str)
        issues = list(self.override_issues)
        warnings: list = []

        def _check(passed: bool, fail_detail: Optional[str] = None, warn: bool = False) -> VisionCheckResult:
            if not passed and not warn:
                sev = QAStatus.FAIL
            elif warn and not passed:
                sev = QAStatus.WARNING
            else:
                sev = QAStatus.PASS
            return VisionCheckResult(passed=passed, severity=sev, detail=fail_detail)

        all_pass = (status == QAStatus.PASS)
        is_fail = (status == QAStatus.FAIL)
        is_warn = (status == QAStatus.WARNING)

        checks = VisionVerificationChecks(
            text_readable=_check(not is_fail, "Text appears unreadable" if is_fail else None),
            text_no_clipping=_check(True),
            text_no_unexpected_content=_check(True),
            product_visible=_check(True),
            product_placement_reasonable=_check(True),
            product_no_corruption=_check(True),
            composition_hierarchy=_check(not is_fail, "Hierarchy compromised" if is_fail else None),
            composition_no_clutter=_check(not is_warn, "Minor clutter detected" if is_warn else None, warn=is_warn),
            branding_colors_present=_check(True),
            branding_no_unauthorized=_check(True),
            no_ai_artifacts=_check(not is_fail, "AI artifact detected" if is_fail else None),
            no_watermarks=_check(True),
        )

        if is_warn:
            warnings.append("Minor visual clutter detected — review composition before publishing.")

        latency = int((time.monotonic() - start) * 1000)
        v_id = f"mock-vis-{uuid.uuid4().hex[:12]}"

        result = VisionVerificationResult(
            status=status,
            checks=checks,
            issues=issues,
            warnings=warnings,
            summary=(
                "Mock vision QA: all checks passed deterministically (development mode)."
                if all_pass
                else f"Mock vision QA: status={status_str}, issues={len(issues)}, warnings={len(warnings)}."
            ),
            advisory=True,
            provider="mock",
            model_name="mock-vision-qa-v1",
            is_mock=True,
            verification_id=v_id,
            generation_id=v_id,
            input_tokens=0,
            output_tokens=0,
            latency_ms=latency,
            expected_values_sent=spec,
        )

        logger.info(
            f"[MockVisionQA] status={status.value} issues={len(issues)} "
            f"latency={latency}ms advisory=True"
        )

        return result.model_dump(mode="json")


class UnavailableVisionQAProvider(VisionQAProvider):
    """
    Explicit stub provider for when a real vision provider (Gemini/OpenAI) is configured
    but cannot run due to missing API keys, network unavailability, or unconfigured credentials.
    Ensures provider failures never silently fall back to MockVisionQAProvider.
    """

    def __init__(self, provider_name: str, reason: str = "Provider unconfigured or API key missing"):
        self.provider_name = provider_name
        self.reason = reason
        self.is_mock = False

    async def evaluate_creative(
        self,
        image_bytes: bytes,
        spec: Dict[str, Any],
    ) -> Dict[str, Any]:
        raise RuntimeError(f"Vision provider '{self.provider_name}' is unavailable: {self.reason}")
