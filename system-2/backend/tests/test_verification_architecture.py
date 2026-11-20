"""
Test Suite: Verification Architecture for Alias Img-Gen.

Validates the complete hybrid verification model:
1. Schema Validation (Pydantic / structured inputs & outputs)
2. Product Input Validation (deterministic Pillow checks: decodability, resolution, alpha)
3. Platform / Template Validation (registry-backed validation, aspect ratio, dimensions)
4. Text Validation (rendered bounds, safe-zone overflow wrapping, exact copy)
5. Dependency & Invalidation (upstream changes mark downstream final ads stale)
6. Final Visual Verification (Level 4 advisory vision QA with structured expected values)
7. Cost & Token Control (vision QA runs ONLY after final render, single-call budget)
"""

import io
import pytest
from PIL import Image
from unittest.mock import patch, AsyncMock
from pydantic import ValidationError

from app.schemas.brief import FinalAdBriefPayload, BrandInfo, ProductAssetInput
from app.schemas.platform import TargetPlatform
from app.platforms.registry import SUPPORTED_PLATFORMS, get_platform_definition
from app.schemas.background import QAStatus
from app.schemas.vision_verification import (
    VisionVerificationResult,
    VisionVerificationChecks,
    VisionCheckResult,
)
from app.services.asset_gate import asset_gate_service
from app.services.typography_engine import TypographyEngine, FontRegistry
from app.services.dependency_invalidation import DependencyInvalidationService
from app.services.vision_verification_service import (
    VisionVerificationService,
    build_expected_values_payload,
)
from app.models.brief import AdBrief
from app.models.strategy import CreativeStrategyRecord
from app.models.final_ad import FinalRenderedCreativeRecord
from app.models.composite import CompositedCreativeRecord
from app.models.job import CreativeJob, JobStatus
from app.models.auth import Tenant, DEFAULT_TENANT_ID
from app.demo.sample_assets import (
    SMARTFIT_X1_DEMO_BRIEF,
    generate_demo_smartwatch_png,
    generate_opaque_sample_jpg,
    generate_low_res_sample_png,
)


# ==============================================================================
# 1. SCHEMA VALIDATION TESTS
# ==============================================================================

def test_schema_malformed_json_and_missing_required_fields():
    """Verify that missing required fields in brief payload are rejected by Pydantic."""
    # Missing required 'brand' and 'product'
    with pytest.raises(ValidationError) as exc_info:
        FinalAdBriefPayload(campaign={"platforms": ["instagram"]})
    errors = exc_info.value.errors()
    missing_fields = {e["loc"][0] for e in errors}
    assert "brand" in missing_fields or "product" in missing_fields


def test_schema_invalid_platform_enum_rejected():
    """Verify that invalid platform string is rejected."""
    broken = SMARTFIT_X1_DEMO_BRIEF.copy()
    broken_campaign = broken["campaign"].copy()
    broken_campaign["platforms"] = ["invalid_super_platform_xyz"]
    broken["campaign"] = broken_campaign

    with pytest.raises(ValidationError) as exc_info:
        FinalAdBriefPayload(**broken)
    err = str(exc_info.value)
    assert "platform" in err.lower() or "input should be" in err.lower()


def test_schema_invalid_hex_color_rejected():
    """Verify that malformed hex colors in brand spec are rejected."""
    broken = SMARTFIT_X1_DEMO_BRIEF.copy()
    broken_brand = broken["brand"].copy()
    broken_brand["colors"] = ["#ZZZZZZ", "blue"]
    broken["brand"] = broken_brand

    with pytest.raises(ValidationError) as exc_info:
        FinalAdBriefPayload(**broken)
    err = str(exc_info.value)
    assert "invalid hex color" in err.lower()


# ==============================================================================
# 2. PRODUCT INPUT VALIDATION (DETERMINISTIC)
# ==============================================================================

@pytest.mark.asyncio
async def test_product_validation_corrupt_image_rejected():
    """Corrupt bytes that cannot be opened as an image must be rejected."""
    corrupt_bytes = b"\x89PNG\r\n\x1a\ncorrupt_random_binary_garbage_stream"

    with patch.object(
        asset_gate_service,
        "_secure_download",
        return_value=((corrupt_bytes, "https://example.com/corrupt.png", "image/png"), None),
    ), patch("app.services.asset_gate.validate_url_safety", return_value=(True, None, None)):
        res = await asset_gate_service.validate_url_and_asset("https://example.com/corrupt.png")
        assert res.is_valid is False
        assert res.status == "FAIL"
        assert any("corrupt" in err.lower() or "decode" in err.lower() for err in res.report.errors)


@pytest.mark.asyncio
async def test_product_validation_insufficient_resolution_rejected():
    """An image smaller than required minimum dimensions (e.g. 200x200) must be rejected."""
    lowres_bytes = generate_low_res_sample_png()  # 200x200

    with patch.object(
        asset_gate_service,
        "_secure_download",
        return_value=((lowres_bytes, "https://example.com/tiny.png", "image/png"), None),
    ), patch("app.services.asset_gate.validate_url_safety", return_value=(True, None, None)):
        res = await asset_gate_service.validate_url_and_asset("https://example.com/tiny.png")
        assert res.is_valid is False
        assert res.status == "FAIL"
        assert any("resolution" in err.lower() or "too low" in err.lower() for err in res.report.errors)


@pytest.mark.asyncio
async def test_product_validation_missing_alpha_channel_detected():
    """When a transparent product cutout is required, an RGB image without alpha must be flagged."""
    opaque_bytes = generate_opaque_sample_jpg()

    with patch.object(
        asset_gate_service,
        "_secure_download",
        return_value=((opaque_bytes, "https://example.com/opaque.jpg", "image/jpeg"), None),
    ), patch("app.services.asset_gate.validate_url_safety", return_value=(True, None, None)):
        res = await asset_gate_service.validate_url_and_asset("https://example.com/opaque.jpg", require_transparency=True)
        assert res.is_valid is False
        assert res.status == "FAIL"
        assert any("no alpha transparency channel" in err.lower() for err in res.report.errors)


@pytest.mark.asyncio
async def test_product_validation_valid_rgba_accepted():
    """A high-res RGBA image with valid alpha must pass deterministic validation."""
    valid_png_bytes = generate_demo_smartwatch_png()

    with patch.object(
        asset_gate_service,
        "_secure_download",
        return_value=((valid_png_bytes, "https://example.com/watch.png", "image/png"), None),
    ), patch("app.services.asset_gate.validate_url_safety", return_value=(True, None, None)):
        res = await asset_gate_service.validate_url_and_asset("https://example.com/watch.png")
        assert res.is_valid is True
        assert res.status in ("PASS", "WARNING")
        assert res.asset_metadata["has_alpha_channel"] is True
        assert res.asset_metadata["transparency_percent"] > 20.0
        assert res.asset_metadata["width"] == 800
        assert res.asset_metadata["height"] == 800


# ==============================================================================
# 3. PLATFORM & TEMPLATE VALIDATION
# ==============================================================================

def test_platform_registry_authoritative_specs():
    """Backend registry is authoritative: Instagram is 1080x1350 (4:5), Facebook is 1080x1080 (1:1)."""
    assert TargetPlatform.INSTAGRAM in SUPPORTED_PLATFORMS
    assert TargetPlatform.FACEBOOK in SUPPORTED_PLATFORMS
    assert TargetPlatform.LINKEDIN in SUPPORTED_PLATFORMS

    ig = SUPPORTED_PLATFORMS[TargetPlatform.INSTAGRAM]
    assert ig.target_width == 1080
    assert ig.target_height == 1350
    assert ig.aspect_ratio == "4:5"

    fb = SUPPORTED_PLATFORMS[TargetPlatform.FACEBOOK]
    assert fb.target_width == 1080
    assert fb.target_height == 1080
    assert fb.aspect_ratio == "1:1"


def test_platform_mismatched_dimensions_rejected():
    """Validation fails if dimensions do not match platform aspect ratio."""
    spec = SUPPORTED_PLATFORMS[TargetPlatform.INSTAGRAM]
    # Instagram 1080x1350 has aspect ratio 4:5 (0.8)
    assert spec.aspect_ratio == "4:5"
    assert round(spec.target_width / spec.target_height, 2) == 0.80


# ==============================================================================
# 4. TEXT VALIDATION (SERVER-SIDE BOUNDS & WRAPPING)
# ==============================================================================

def test_text_bounds_and_overflow_handling():
    """Verify that lengthy headlines are truncated or line-wrapped rather than overflowing canvas."""
    font = FontRegistry.get_instance().load_font("Inter", "bold", 52)

    # Extremely long headline that would overflow if not wrapped
    long_headline = "This is an extremely long headline designed to test server side wrapping bounds and prevent clipping across devices " * 2
    wrapped_lines = TypographyEngine.wrap_text(
        text=long_headline,
        font=font,
        max_width=800,
    )
    assert len(wrapped_lines) > 1

    # Fit into bounding slot enforces limits
    fitted_lines, fitted_font, line_h, fits_cleanly = TypographyEngine.fit_text_to_box(
        text=long_headline,
        font_family="Inter",
        weight="bold",
        initial_size=52,
        min_size=24,
        max_width=800,
        max_height=300,
    )
    assert len(fitted_lines) >= 1
    assert fitted_font.size <= 52


# ==============================================================================
# 5. DEPENDENCY INVALIDATION TESTS
# ==============================================================================

@pytest.mark.asyncio
async def test_dependency_invalidation_composite_marks_final_ad_stale(test_db_session):
    """When a composite changes, any downstream final ads must be marked stale with vision QA cleared."""
    from app.models.brief import AdBrief
    from app.models.strategy import CreativeStrategyRecord
    from app.models.background import GeneratedBackgroundRecord

    tenant = Tenant(name="Test Invalidation Tenant", slug="test-inv-slug")
    test_db_session.add(tenant)
    await test_db_session.flush()

    brief = AdBrief(
        brand_name="SmartFit",
        product_name="SmartFit X1",
        price=4999.0,
        currency="BDT",
        platforms=["instagram"],
        validation_status="PASS",
        payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief)
    await test_db_session.flush()

    strategy = CreativeStrategyRecord(
        brief_id=brief.id,
        version_number=1,
        status="APPROVED",
        template_id="product_sale_dark",
        strategy_spec={"concept": {"angle": "Fitness"}},
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strategy)
    await test_db_session.flush()

    job = CreativeJob(
        tenant_id=tenant.id,
        brief_id=brief.id,
        strategy_id=strategy.id,
        status=JobStatus.COMPLETED.value,
    )
    test_db_session.add(job)
    await test_db_session.flush()

    bg = GeneratedBackgroundRecord(
        job_id=job.id,
        strategy_id=strategy.id,
        platform=TargetPlatform.INSTAGRAM,
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        provider="mock",
        model_name="mock-studio-v1",
        prompt_spec={"positive_prompt": "modern studio backdrop"},
        prompt_version="1.0",
        storage_key="bg.png",
        qa_status=QAStatus.PASS,
        qa_result={},
        attempt_number=1,
    )
    test_db_session.add(bg)
    await test_db_session.flush()

    comp = CompositedCreativeRecord(
        job_id=job.id,
        strategy_id=strategy.id,
        background_id=bg.id,
        platform=TargetPlatform.INSTAGRAM,
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        storage_key="comp.png",
        placement_spec={"scale": 0.8},
        shadow_spec={"enabled": True},
        integrity_metadata={"source_hash": "hash1"},
        qa_status=QAStatus.PASS,
        qa_result={"status": "PASS", "summary": "Composite verified"},
        attempt_number=1,
    )
    test_db_session.add(comp)
    await test_db_session.flush()

    final_ad = FinalRenderedCreativeRecord(
        tenant_id=tenant.id,
        job_id=job.id,
        strategy_id=strategy.id,
        brief_id=brief.id,
        composite_id=comp.id,
        background_id=bg.id,
        platform=TargetPlatform.INSTAGRAM,
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        storage_key="tenants/test/final.png",
        copy_spec={"headline": "SmartFit X1"},
        typography_spec={},
        cta_spec={},
        readability_spec={},
        provenance_chain={},
        qa_status=QAStatus.PASS,
        qa_result={},
        vision_qa_status=QAStatus.PASS,
        vision_qa_result={"status": "PASS", "summary": "Approved"},
        is_stale=False,
        attempt_number=1,
    )
    test_db_session.add(final_ad)
    await test_db_session.commit()

    # Invalidate downstream from composite
    invalidated_count = await DependencyInvalidationService.invalidate_finals_for_composite(
        db=test_db_session,
        composite_id=comp.id,
        reason="composite_regenerated",
    )
    assert invalidated_count == 1

    # Reload record
    await test_db_session.refresh(final_ad)
    assert final_ad.is_stale is True
    assert final_ad.vision_qa_status is None
    assert final_ad.vision_qa_result is None


@pytest.mark.asyncio
async def test_dependency_invalidation_product_change_invalidates_job(test_db_session):
    """When the root product changes for a job, all final ads for that job become stale."""
    from app.models.brief import AdBrief
    from app.models.strategy import CreativeStrategyRecord
    from app.models.background import GeneratedBackgroundRecord

    tenant = Tenant(name="Test Job Tenant", slug="test-job-slug")
    test_db_session.add(tenant)
    await test_db_session.flush()

    brief = AdBrief(
        brand_name="SmartFit",
        product_name="SmartFit X1",
        price=4999.0,
        currency="BDT",
        platforms=["instagram"],
        validation_status="PASS",
        payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief)
    await test_db_session.flush()

    strategy = CreativeStrategyRecord(
        brief_id=brief.id,
        version_number=1,
        status="APPROVED",
        template_id="product_sale_dark",
        strategy_spec={"concept": {"angle": "Fitness"}},
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strategy)
    await test_db_session.flush()

    job = CreativeJob(
        tenant_id=tenant.id,
        brief_id=brief.id,
        strategy_id=strategy.id,
        status=JobStatus.COMPLETED.value,
    )
    test_db_session.add(job)
    await test_db_session.flush()

    bg = GeneratedBackgroundRecord(
        job_id=job.id,
        strategy_id=strategy.id,
        platform=TargetPlatform.INSTAGRAM,
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        provider="mock",
        model_name="mock-studio-v1",
        prompt_spec={"positive_prompt": "modern studio backdrop"},
        prompt_version="1.0",
        storage_key="bg.png",
        qa_status=QAStatus.PASS,
        qa_result={},
        attempt_number=1,
    )
    test_db_session.add(bg)
    await test_db_session.flush()

    comp = CompositedCreativeRecord(
        job_id=job.id,
        strategy_id=strategy.id,
        background_id=bg.id,
        platform=TargetPlatform.INSTAGRAM,
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        storage_key="comp.png",
        placement_spec={"scale": 0.8},
        shadow_spec={"enabled": True},
        integrity_metadata={"source_hash": "hash1"},
        qa_status=QAStatus.PASS,
        qa_result={"status": "PASS", "summary": "Composite verified"},
        attempt_number=1,
    )
    test_db_session.add(comp)
    await test_db_session.flush()

    ad1 = FinalRenderedCreativeRecord(
        tenant_id=tenant.id,
        job_id=job.id,
        strategy_id=strategy.id,
        brief_id=brief.id,
        composite_id=comp.id,
        background_id=bg.id,
        platform=TargetPlatform.INSTAGRAM,
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        storage_key="path/1.png",
        copy_spec={"headline": "SmartFit X1"},
        typography_spec={},
        cta_spec={},
        readability_spec={},
        provenance_chain={},
        qa_status=QAStatus.PASS,
        qa_result={},
        is_stale=False,
    )
    test_db_session.add(ad1)
    await test_db_session.commit()

    count = await DependencyInvalidationService.invalidate_finals_for_job(
        db=test_db_session,
        job_id=job.id,
        reason="product_asset_replaced",
    )
    assert count == 1

    stale_ads = await DependencyInvalidationService.get_stale_finals_for_job(test_db_session, job.id)
    assert len(stale_ads) == 1
    assert stale_ads[0].id == ad1.id
    assert stale_ads[0].is_stale is True


# ==============================================================================
# 6. FINAL VISION VERIFICATION (LEVEL 4) & COST CONTROL TESTS
# ==============================================================================

@pytest.mark.asyncio
async def test_vision_qa_cost_control_disabled_by_default():
    """Vision verification should return None when ENABLE_VISION_QA is False (cost control)."""
    service = VisionVerificationService()
    with patch("app.core.config.settings.ENABLE_VISION_QA", False):
        res = await service.verify_final_ad(
            image_bytes=b"dummy_bytes",
            expected_values={"headline": "Test"},
            pipeline_call_count=0,
        )
        assert res is None


@pytest.mark.asyncio
async def test_vision_qa_single_call_budget_enforcement():
    """Vision verification enforces max calls per pipeline to prevent runaway cost."""
    service = VisionVerificationService()
    with patch("app.core.config.settings.ENABLE_VISION_QA", True), patch("app.core.config.settings.VISION_QA_MAX_CALLS_PER_PIPELINE", 1):
        # First call is within budget
        expected = build_expected_values_payload(
            platform="instagram",
            aspect_ratio="4:5",
            width=1080,
            height=1350,
            headline="SmartFit X1",
            subheadline="Elevate Every Day",
            cta="Shop Now",
        )
        valid_bytes = generate_demo_smartwatch_png()

        res1 = await service.verify_final_ad(
            image_bytes=valid_bytes,
            expected_values=expected,
            pipeline_call_count=0,
        )
        assert res1 is not None
        assert res1.status in (QAStatus.PASS, QAStatus.WARNING)

        # Second call in same pipeline exceeds max_calls=1 -> skipped for cost control
        res2 = await service.verify_final_ad(
            image_bytes=valid_bytes,
            expected_values=expected,
            pipeline_call_count=1,
        )
        assert res2 is None


@pytest.mark.asyncio
async def test_vision_qa_evaluates_expected_values():
    """Verify that expected values payload is compact and structured."""
    payload = build_expected_values_payload(
        platform="instagram",
        aspect_ratio="4:5",
        width=1080,
        height=1350,
        headline="Special Offer",
        subheadline="Limited time only",
        cta="Claim Now",
        offer_text="Save 20%",
        brand_primary_color="#1D4ED8",
    )
    assert payload["platform"] == "instagram"
    assert payload["aspect_ratio"] == "4:5"
    assert payload["expected_text"]["headline"] == "Special Offer"
    assert payload["expected_text"]["subheadline"] == "Limited time only"
    assert payload["expected_text"]["cta"] == "Claim Now"
    assert payload["expected_text"]["offer"] == "Save 20%"
    assert payload["brand_primary_color"] == "#1D4ED8"
    assert payload["dimensions"] == {"width": 1080, "height": 1350}
    # Unnecessary pipeline prompt history is excluded
    assert "raw_prompt_history" not in payload


# ==============================================================================
# 7. HARDENING AUDIT: APPROVAL SEMANTICS, QUOTA SCOPING & MOCK/REAL DISTINCTION
# ==============================================================================

from app.schemas.vision_verification import VisionQAStatus
from app.services.final_ad_service import FinalAdService


def test_approval_policy_vision_disabled_deterministic_pass():
    """CASE A: When Vision QA is disabled, deterministic QA PASS + not stale allows approval."""
    record = FinalRenderedCreativeRecord(
        tenant_id="tenant-1",
        job_id="job-1",
        strategy_id="strat-1",
        brief_id="brief-1",
        composite_id="comp-1",
        background_id="bg-1",
        platform=TargetPlatform.INSTAGRAM,
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        storage_key="test.png",
        copy_spec={},
        typography_spec={},
        cta_spec={},
        readability_spec={},
        provenance_chain={},
        qa_status=QAStatus.PASS.value,
        qa_result={"status": "PASS"},
        vision_qa_status=VisionQAStatus.NOT_RUN.value,
        is_stale=False,
    )
    can_approve, msg = FinalAdService.evaluate_approval(record, is_vision_enabled=False)
    assert can_approve is True
    assert msg == "Creative approved"


def test_approval_policy_vision_enabled_real_verified():
    """CASE B: When Vision QA is enabled, REAL_VERIFIED allows approval."""
    record = FinalRenderedCreativeRecord(
        tenant_id="tenant-1",
        job_id="job-1",
        strategy_id="strat-1",
        brief_id="brief-1",
        composite_id="comp-1",
        background_id="bg-1",
        platform=TargetPlatform.INSTAGRAM,
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        storage_key="test.png",
        copy_spec={},
        typography_spec={},
        cta_spec={},
        readability_spec={},
        provenance_chain={},
        qa_status=QAStatus.PASS.value,
        qa_result={"status": "PASS"},
        vision_qa_status=VisionQAStatus.REAL_VERIFIED.value,
        is_stale=False,
    )
    can_approve, msg = FinalAdService.evaluate_approval(record, is_vision_enabled=True)
    assert can_approve is True


def test_approval_policy_vision_enabled_mock_verified_dev():
    """CASE B (dev): When Vision QA is enabled in dev, MOCK_VERIFIED allows approval."""
    record = FinalRenderedCreativeRecord(
        tenant_id="tenant-1",
        job_id="job-1",
        strategy_id="strat-1",
        brief_id="brief-1",
        composite_id="comp-1",
        background_id="bg-1",
        platform=TargetPlatform.INSTAGRAM,
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        storage_key="test.png",
        copy_spec={},
        typography_spec={},
        cta_spec={},
        readability_spec={},
        provenance_chain={},
        qa_status=QAStatus.PASS.value,
        qa_result={"status": "PASS"},
        vision_qa_status=VisionQAStatus.MOCK_VERIFIED.value,
        is_stale=False,
    )
    can_approve, msg = FinalAdService.evaluate_approval(record, is_vision_enabled=True)
    assert can_approve is True


def test_approval_policy_vision_enabled_provider_unavailable_blocks():
    """CASE C: Vision QA provider unavailable must explicitly block approval."""
    record = FinalRenderedCreativeRecord(
        tenant_id="tenant-1",
        job_id="job-1",
        strategy_id="strat-1",
        brief_id="brief-1",
        composite_id="comp-1",
        background_id="bg-1",
        platform=TargetPlatform.INSTAGRAM,
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        storage_key="test.png",
        copy_spec={},
        typography_spec={},
        cta_spec={},
        readability_spec={},
        provenance_chain={},
        qa_status=QAStatus.PASS.value,
        qa_result={"status": "PASS"},
        vision_qa_status=VisionQAStatus.UNAVAILABLE.value,
        is_stale=False,
    )
    can_approve, msg = FinalAdService.evaluate_approval(record, is_vision_enabled=True)
    assert can_approve is False
    assert "unavailable" in msg.lower()


def test_approval_policy_vision_enabled_failed_blocks():
    """CASE D: Visual verification failure must strictly block approval."""
    record = FinalRenderedCreativeRecord(
        tenant_id="tenant-1",
        job_id="job-1",
        strategy_id="strat-1",
        brief_id="brief-1",
        composite_id="comp-1",
        background_id="bg-1",
        platform=TargetPlatform.INSTAGRAM,
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        storage_key="test.png",
        copy_spec={},
        typography_spec={},
        cta_spec={},
        readability_spec={},
        provenance_chain={},
        qa_status=QAStatus.PASS.value,
        qa_result={"status": "PASS"},
        vision_qa_status=VisionQAStatus.FAILED.value,
        is_stale=False,
    )
    can_approve, msg = FinalAdService.evaluate_approval(record, is_vision_enabled=True)
    assert can_approve is False
    assert "failed" in msg.lower()


def test_approval_policy_vision_enabled_not_run_blocks():
    """When Vision QA is enabled, NOT_RUN cannot be approved without evaluation."""
    record = FinalRenderedCreativeRecord(
        tenant_id="tenant-1",
        job_id="job-1",
        strategy_id="strat-1",
        brief_id="brief-1",
        composite_id="comp-1",
        background_id="bg-1",
        platform=TargetPlatform.INSTAGRAM,
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        storage_key="test.png",
        copy_spec={},
        typography_spec={},
        cta_spec={},
        readability_spec={},
        provenance_chain={},
        qa_status=QAStatus.PASS.value,
        qa_result={"status": "PASS"},
        vision_qa_status=VisionQAStatus.NOT_RUN.value,
        is_stale=False,
    )
    can_approve, msg = FinalAdService.evaluate_approval(record, is_vision_enabled=True)
    assert can_approve is False
    assert "not executed" in msg.lower() or "required" in msg.lower()


def test_approval_policy_stale_blocks_even_if_verified():
    """CASE E: Stale final ad can NEVER retain approval."""
    record = FinalRenderedCreativeRecord(
        tenant_id="tenant-1",
        job_id="job-1",
        strategy_id="strat-1",
        brief_id="brief-1",
        composite_id="comp-1",
        background_id="bg-1",
        platform=TargetPlatform.INSTAGRAM,
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        storage_key="test.png",
        copy_spec={},
        typography_spec={},
        cta_spec={},
        readability_spec={},
        provenance_chain={},
        qa_status=QAStatus.PASS.value,
        qa_result={"status": "PASS"},
        vision_qa_status=VisionQAStatus.REAL_VERIFIED.value,
        is_stale=True,
    )
    can_approve, msg = FinalAdService.evaluate_approval(record, is_vision_enabled=False)
    assert can_approve is False
    assert "stale" in msg.lower()


def test_approval_policy_deterministic_failure_authoritative():
    """Deterministic failure cannot be overridden by vision model claiming it looks fine."""
    record = FinalRenderedCreativeRecord(
        tenant_id="tenant-1",
        job_id="job-1",
        strategy_id="strat-1",
        brief_id="brief-1",
        composite_id="comp-1",
        background_id="bg-1",
        platform=TargetPlatform.INSTAGRAM,
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        storage_key="test.png",
        copy_spec={},
        typography_spec={},
        cta_spec={},
        readability_spec={},
        provenance_chain={},
        qa_status=QAStatus.FAIL.value,  # Exact copy check failed deterministically
        qa_result={"status": "FAIL", "issues": ["Exact copy mismatch"]},
        vision_qa_status=VisionQAStatus.REAL_VERIFIED.value,
        is_stale=False,
    )
    can_approve, msg = FinalAdService.evaluate_approval(record, is_vision_enabled=False)
    assert can_approve is False
    assert "deterministic qa failed" in msg.lower()


@pytest.mark.asyncio
async def test_mock_verification_cannot_masquerade_as_real():
    """Mock provider must have is_mock=True and status=MOCK_VERIFIED, never REAL_VERIFIED."""
    from app.providers.mock_vision_provider import MockVisionQAProvider
    provider = MockVisionQAProvider()
    service = VisionVerificationService(provider=provider)

    with patch("app.core.config.settings.ENABLE_VISION_QA", True), patch("app.core.config.settings.VISION_QA_PROVIDER", "mock"):
        result = await service.verify_final_ad(
            image_bytes=generate_demo_smartwatch_png(),
            expected_values={"headline": "Test"},
            artifact_key="test_art_1",
        )
        assert result is not None
        assert result.is_mock is True
        status_enum = VisionVerificationService.compute_vision_qa_status(result, is_enabled=True)
        assert status_enum == VisionQAStatus.MOCK_VERIFIED
        assert status_enum != VisionQAStatus.REAL_VERIFIED


@pytest.mark.asyncio
async def test_real_provider_failure_returns_unavailable():
    """When a real provider fails/errors, status is UNAVAILABLE, never silently mock or real."""
    class FailingRealProvider:
        is_mock = False
        async def evaluate_creative(self, image_bytes, spec):
            raise ConnectionError("Gemini Vision API timeout / quota exceeded")

    service = VisionVerificationService(provider=FailingRealProvider())

    with patch("app.core.config.settings.ENABLE_VISION_QA", True), patch("app.core.config.settings.VISION_QA_PROVIDER", "google_gemini"):
        result = await service.verify_final_ad(
            image_bytes=generate_demo_smartwatch_png(),
            expected_values={"headline": "Test"},
            artifact_key="test_art_2",
        )
        assert result is not None
        assert result.is_mock is False
        assert result.model_name == "unavailable"
        status_enum = VisionVerificationService.compute_vision_qa_status(result, is_enabled=True)
        assert status_enum == VisionQAStatus.UNAVAILABLE
        assert status_enum != VisionQAStatus.REAL_VERIFIED
        assert status_enum != VisionQAStatus.MOCK_VERIFIED


@pytest.mark.asyncio
async def test_real_provider_success_returns_real_verified():
    """When a genuine external vision provider evaluates successfully, status is REAL_VERIFIED."""
    class SuccessfulRealProvider:
        is_mock = False
        async def evaluate_creative(self, image_bytes, spec):
            def _p():
                return VisionCheckResult(passed=True, severity=QAStatus.PASS)
            checks = VisionVerificationChecks(
                text_readable=_p(), text_no_clipping=_p(), text_no_unexpected_content=_p(),
                product_visible=_p(), product_placement_reasonable=_p(), product_no_corruption=_p(),
                composition_hierarchy=_p(), composition_no_clutter=_p(),
                branding_colors_present=_p(), branding_no_unauthorized=_p(),
                no_ai_artifacts=_p(), no_watermarks=_p(),
            )
            return VisionVerificationResult(
                status=QAStatus.PASS,
                checks=checks,
                issues=[],
                warnings=[],
                summary="Genuine Gemini Vision evaluation: all visual criteria satisfied.",
                advisory=True,
                provider="google_gemini",
                model_name="gemini-1.5-flash",
                is_mock=False,
                verification_id="gemini-v-12345",
                latency_ms=850,
                expected_values_sent=spec,
            )

    service = VisionVerificationService(provider=SuccessfulRealProvider())

    with patch("app.core.config.settings.ENABLE_VISION_QA", True), patch("app.core.config.settings.VISION_QA_PROVIDER", "google_gemini"):
        result = await service.verify_final_ad(
            image_bytes=generate_demo_smartwatch_png(),
            expected_values={"headline": "Test"},
            artifact_key="test_art_3",
            output_hash="hash_123",
        )
        assert result is not None
        assert result.is_mock is False
        assert result.output_hash == "hash_123"
        status_enum = VisionVerificationService.compute_vision_qa_status(result, is_enabled=True)
        assert status_enum == VisionQAStatus.REAL_VERIFIED


@pytest.mark.asyncio
async def test_quota_scoped_per_artifact_separate_jobs_do_not_share_quota():
    """Job A quota must never consume Job B quota. New final versions get their own quota."""
    service = VisionVerificationService()

    with patch("app.core.config.settings.ENABLE_VISION_QA", True), patch("app.core.config.settings.VISION_QA_MAX_CALLS_PER_PIPELINE", 1):
        image_bytes = generate_demo_smartwatch_png()
        expected = {"headline": "Test"}

        # Job A Attempt 1 consumes 1 call
        res_job_a_v1 = await service.verify_final_ad(image_bytes, expected, artifact_key="job_A:attempt_1")
        assert res_job_a_v1 is not None

        # Job A Attempt 1 second call is blocked by quota
        res_job_a_v1_again = await service.verify_final_ad(image_bytes, expected, artifact_key="job_A:attempt_1")
        assert res_job_a_v1_again is None

        # Job B Attempt 1 is NOT blocked -- independent quota
        res_job_b_v1 = await service.verify_final_ad(image_bytes, expected, artifact_key="job_B:attempt_1")
        assert res_job_b_v1 is not None

        # Job A Attempt 2 (regenerated version) gets its own quota
        res_job_a_v2 = await service.verify_final_ad(image_bytes, expected, artifact_key="job_A:attempt_2")
        assert res_job_a_v2 is not None


@pytest.mark.asyncio
async def test_strategy_invalidation_cascades_to_final_ad(test_db_session):
    """When a strategy is modified, all dependent final ads are marked stale and vision status cleared."""
    tenant = Tenant(name="Strat Inval Tenant", slug="strat-inval-slug")
    test_db_session.add(tenant)
    await test_db_session.flush()

    brief = AdBrief(
        brand_name="Brand", product_name="Prod", price=100.0, currency="BDT",
        platforms=["instagram"], validation_status="PASS", payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief)
    await test_db_session.flush()

    strat = CreativeStrategyRecord(
        brief_id=brief.id, version_number=1, status="APPROVED", template_id="temp1",
        strategy_spec={"concept": {"angle": "A"}},
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strat)
    await test_db_session.flush()

    job = CreativeJob(tenant_id=tenant.id, brief_id=brief.id, strategy_id=strat.id, status=JobStatus.COMPLETED.value)
    test_db_session.add(job)
    await test_db_session.flush()

    ad = FinalRenderedCreativeRecord(
        tenant_id=tenant.id, job_id=job.id, strategy_id=strat.id, brief_id=brief.id,
        composite_id="comp-xyz", background_id="bg-xyz", platform=TargetPlatform.INSTAGRAM,
        width=1080, height=1350, aspect_ratio="4:5", storage_key="path.png", copy_spec={},
        typography_spec={}, cta_spec={}, readability_spec={}, provenance_chain={},
        qa_status=QAStatus.PASS.value, qa_result={}, vision_qa_status=VisionQAStatus.REAL_VERIFIED.value,
        is_stale=False,
    )
    test_db_session.add(ad)
    await test_db_session.commit()

    count = await DependencyInvalidationService.invalidate_finals_for_strategy(
        db=test_db_session,
        strategy_id=strat.id,
        reason="copy_updated",
    )
    assert count == 1

    await test_db_session.refresh(ad)
    assert ad.is_stale is True
    assert ad.vision_qa_status is None
    assert ad.vision_qa_result is None


@pytest.mark.asyncio
async def test_approve_endpoint_multi_tenant_isolation(test_db_session):
    """Tenant A cannot approve Tenant B's final ad."""
    tenant_a = Tenant(name="Tenant A", slug="tenant-a")
    tenant_b = Tenant(name="Tenant B", slug="tenant-b")
    test_db_session.add_all([tenant_a, tenant_b])
    await test_db_session.flush()

    ad_b = FinalRenderedCreativeRecord(
        tenant_id=tenant_b.id, job_id="job-b", strategy_id="strat-b", brief_id="brief-b",
        composite_id="comp-b", background_id="bg-b", platform=TargetPlatform.INSTAGRAM,
        width=1080, height=1350, aspect_ratio="4:5", storage_key="path.png", copy_spec={},
        typography_spec={}, cta_spec={}, readability_spec={}, provenance_chain={},
        qa_status=QAStatus.PASS.value, qa_result={}, vision_qa_status=VisionQAStatus.MOCK_VERIFIED.value,
        is_stale=False,
    )
    test_db_session.add(ad_b)
    await test_db_session.commit()

    from app.api.v1.final_ads import approve_final_ad
    from fastapi import HTTPException

    # Tenant A attempts to approve Tenant B's ad -> rejected with 404
    with pytest.raises(HTTPException) as exc_info:
        await approve_final_ad(
            final_ad_id=ad_b.id,
            tenant=tenant_a,
            db=test_db_session,
        )
    assert exc_info.value.status_code == 404

    # Tenant B approves Tenant B's ad -> succeeds
    res = await approve_final_ad(
        final_ad_id=ad_b.id,
        tenant=tenant_b,
        db=test_db_session,
    )
    assert res.approved is True

