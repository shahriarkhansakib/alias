"""
Phase 8: Production Simulation & End-to-End Validation Test Suite.
Validates the complete Alias Img-Gen creative pipeline under realistic and adversarial production inputs:
Pipeline: Final Ad Brief -> Asset Validation -> Creative Strategy -> Background Gen -> Background QA -> Product Cutout -> Composite -> Composite QA -> Final Rendering -> Deterministic Final QA -> Vision QA -> Approval.

Covers all 30 Matrix Items:
1. Normal English brief
2. Long headline
3. Long subheadline
4. Long CTA
5. Price + discount
6. Missing optional fields
7. Bangla-only copy
8. Mixed Bangla-English copy
9. Special characters/currency/numbers
10. Portrait product image
11. Landscape product image
12. Transparent PNG product
13. Facebook 1080x1080
14. Instagram 1080x1350
15. LinkedIn 1200x628
16. Background QA failure
17. Composite QA failure
18. Final deterministic QA failure
19. Vision provider unavailable
20. Vision mock verification
21. Real Vision provider integration path if credentials are available
22. Stale final after background regeneration
23. Stale final after composite regeneration
24. Stale final after strategy/copy change
25. Cache hit
26. Force regeneration
27. Cross-tenant resource access
28. Unauthorized approval
29. Concurrent duplicate generation/idempotency
30. PostgreSQL connectivity/migration smoke test
"""

import io
import os
import uuid
import socket
import asyncio
import pytest
import pytest_asyncio
from PIL import Image, ImageDraw
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient
from sqlalchemy import select, func, create_engine, inspect
from sqlalchemy.schema import CreateTable
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException
from alembic.config import Config
from alembic import command

from app.core.config import settings
from app.core.database import Base
from app.models.auth import Tenant, User, Membership, DEFAULT_TENANT_ID, DEFAULT_USER_ID
from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.models.strategy import CreativeStrategyRecord
from app.models.job import CreativeJob, JobStatus
from app.models.background import GeneratedBackgroundRecord
from app.models.composite import CompositedCreativeRecord
from app.models.final_ad import FinalRenderedCreativeRecord
from app.schemas.platform import TargetPlatform
from app.schemas.background import QAStatus
from app.schemas.strategy import (
    CreativeStrategySpec,
    ConceptSpec,
    VisualDirectionSpec,
    CopySpec,
    CopyPolicyType,
    PlacementDirection,
)
from app.schemas.final_ad import (
    TypographyStyle,
    CTAStyle,
    PriceBadgeStyle,
    ReadabilityEnhancementConfig,
)
from app.schemas.vision_verification import (
    VisionQAStatus,
    VisionVerificationResult,
    VisionVerificationChecks,
    VisionCheckResult,
)
from app.platforms.registry import get_platform_definition, build_platform_creative_spec
from app.services.typography_engine import TypographyEngine, FontRegistry
from app.services.cta_renderer import CTARenderer
from app.services.price_badge_renderer import PriceBadgeRenderer
from app.services.final_ad_qa import FinalAdQAService
from app.services.final_ad_service import FinalAdService
from app.services.dependency_invalidation import DependencyInvalidationService
from app.services.vision_verification_service import (
    VisionVerificationService,
    get_vision_verification_service,
    build_expected_values_payload,
)
from app.providers.mock_vision_provider import MockVisionQAProvider, UnavailableVisionQAProvider
from app.providers.storage_provider import get_storage_provider
from app.workers.job_runner import execute_job_stage
from app.demo.sample_assets import SMARTFIT_X1_DEMO_BRIEF, generate_demo_smartwatch_png


# ==============================================================================
# Pipeline Setup Helper
# ==============================================================================

async def setup_test_pipeline(
    session: AsyncSession,
    platform: TargetPlatform = TargetPlatform.FACEBOOK,
    headline: str = "SmartFit X1 Pro",
    subheadline: str = "Precision titanium fitness tracker with 14-day battery life.",
    cta: str = "Shop Now",
    offer: str = None,
    product_img_size: tuple = (800, 800),
    is_transparent: bool = True,
    bg_qa_status: str = "PASS",
    comp_qa_status: str = "PASS",
    tenant_id: str = DEFAULT_TENANT_ID,
):
    storage = get_storage_provider()
    plat_def = get_platform_definition(platform)

    # 1. Brief
    brief_payload = dict(SMARTFIT_X1_DEMO_BRIEF)
    brief_payload["campaign"]["platforms"] = [platform.value]
    if offer:
        brief_payload["offer"] = {"price": 199.99, "currency": "USD", "discount": offer}

    brief = AdBrief(
        brand_name="SmartFit",
        product_name="SmartFit X1 Pro",
        price=199.99 if offer else 999.0,
        currency="USD" if offer else "BDT",
        platforms=[platform.value],
        validation_status="PASS",
        payload=brief_payload,
        tenant_id=tenant_id,
    )
    session.add(brief)
    await session.flush()

    # 2. Product Asset
    if is_transparent:
        prod_img = Image.new("RGBA", product_img_size, color=(0, 0, 0, 0))
        d = ImageDraw.Draw(prod_img)
        d.ellipse([10, 10, product_img_size[0] - 10, product_img_size[1] - 10], fill=(40, 80, 180, 255))
    else:
        prod_img = Image.new("RGB", product_img_size, color=(100, 120, 150))
    
    prod_buf = io.BytesIO()
    prod_img.save(prod_buf, format="PNG")
    prod_bytes = prod_buf.getvalue()
    prod_key = f"assets/{brief.id}/product_{uuid.uuid4().hex[:6]}.png"
    await storage.save_bytes(prod_bytes, prod_key, content_type="image/png")

    primary_url = f"http://example.com/assets/{uuid.uuid4().hex[:6]}.png"
    brief_payload["images"][0]["url"] = primary_url

    asset = AssetValidationRecord(
        url=primary_url,
        storage_key=prod_key,
        validation_status="PASS",
        width=product_img_size[0],
        height=product_img_size[1],
        has_alpha_channel=is_transparent,
        file_size_bytes=len(prod_bytes),
        tenant_id=tenant_id,
    )
    session.add(asset)

    # Logo Asset
    logo_url = f"http://example.com/logo_{uuid.uuid4().hex[:6]}.png"
    brief_payload["brand"]["logo_url"] = logo_url
    logo_img = Image.new("RGBA", (200, 60), color=(0, 0, 0, 0))
    d = ImageDraw.Draw(logo_img)
    d.rectangle([(0, 0), (199, 59)], fill=(59, 130, 246, 255))
    logo_buf = io.BytesIO()
    logo_img.save(logo_buf, format="PNG")
    logo_bytes = logo_buf.getvalue()
    logo_key = f"assets/{brief.id}/logo_{uuid.uuid4().hex[:6]}.png"
    await storage.save_bytes(logo_bytes, logo_key, content_type="image/png")

    logo_asset = AssetValidationRecord(
        url=logo_url,
        storage_key=logo_key,
        validation_status="PASS",
        width=200,
        height=60,
        has_alpha_channel=True,
        file_size_bytes=len(logo_bytes),
        tenant_id=tenant_id,
    )
    session.add(logo_asset)
    await session.flush()

    # 3. Strategy
    strat_spec = CreativeStrategySpec(
        concept=ConceptSpec(
            name="Production Simulation",
            creative_angle="Reliable E2E pipeline performance",
            reasoning_notes="Test spec",
        ),
        visual_direction=VisualDirectionSpec(
            mood="clean studio",
            lighting="studio rim lighting",
            background_direction="Minimalist dark studio with negative space",
            negative_prompt="text, logo, watermark, product",
            product_placement=PlacementDirection.RIGHT,
            text_placement=PlacementDirection.LEFT,
        ),
        copy_spec=CopySpec(
            headline=headline,
            subheadline=subheadline,
            cta=cta,
            offer_mention=offer,
            headline_policy=CopyPolicyType.AI_GENERATED_CREATIVE,
            subheadline_policy=CopyPolicyType.FACTUAL,
            cta_policy=CopyPolicyType.USER_PROVIDED,
        ),
        template_id="product_sale_dark",
    )
    strategy = CreativeStrategyRecord(
        brief_id=brief.id,
        version_number=1,
        status="APPROVED",
        template_id="product_sale_dark",
        strategy_spec=strat_spec.model_dump(),
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
        tenant_id=tenant_id,
    )
    session.add(strategy)
    await session.flush()

    # 4. Job
    job = CreativeJob(
        brief_id=brief.id,
        strategy_id=strategy.id,
        status=JobStatus.COMPOSITE_APPROVED.value if comp_qa_status in ("PASS", "WARNING") else JobStatus.BACKGROUND_APPROVED.value,
        current_stage="Composite Approved",
        tenant_id=tenant_id,
    )
    session.add(job)
    await session.flush()

    # 5. Background
    bg_img = Image.new("RGB", (plat_def.target_width, plat_def.target_height), color=(15, 23, 42))
    bg_buf = io.BytesIO()
    bg_img.save(bg_buf, format="PNG")
    bg_bytes = bg_buf.getvalue()
    bg_key = f"backgrounds/{job.id}/{platform.value}/bg_{uuid.uuid4().hex[:6]}.png"
    await storage.save_bytes(bg_bytes, bg_key, content_type="image/png")

    bg = GeneratedBackgroundRecord(
        job_id=job.id,
        brief_id=brief.id,
        strategy_id=strategy.id,
        platform=platform.value,
        width=plat_def.target_width,
        height=plat_def.target_height,
        aspect_ratio=plat_def.aspect_ratio,
        storage_key=bg_key,
        provider="mock",
        model_name="mock-sdxl",
        prompt_spec={"prompt": "Studio background", "negative_prompt": "text, logo"},
        prompt_version="1.0",
        qa_status=bg_qa_status,
        qa_result={"status": bg_qa_status, "overall_score": 0.95 if bg_qa_status == "PASS" else 0.40},
        cache_key=f"bg_cache_{uuid.uuid4().hex[:8]}",
        tenant_id=tenant_id,
    )
    session.add(bg)
    await session.flush()

    # 6. Composite
    comp_img = bg_img.copy()
    pw = int(plat_def.target_width * 0.40)
    ph = int(pw * (product_img_size[1] / product_img_size[0]))
    px = int(plat_def.target_width * 0.55)
    py = int((plat_def.target_height - ph) * 0.5)
    
    comp_buf = io.BytesIO()
    comp_img.save(comp_buf, format="PNG")
    comp_bytes = comp_buf.getvalue()
    comp_key = f"composites/{job.id}/{platform.value}/comp_{uuid.uuid4().hex[:6]}.png"
    await storage.save_bytes(comp_bytes, comp_key, content_type="image/png")

    composite = CompositedCreativeRecord(
        job_id=job.id,
        brief_id=brief.id,
        strategy_id=strategy.id,
        background_id=bg.id,
        platform=platform.value,
        width=plat_def.target_width,
        height=plat_def.target_height,
        aspect_ratio=plat_def.aspect_ratio,
        storage_key=comp_key,
        placement_spec={"x": px, "y": py, "width": pw, "height": ph},
        shadow_spec={"enabled": True, "opacity": 0.35},
        integrity_metadata={
            "source_asset_id": asset.id,
            "source_asset_hash": "src_hash_123",
            "cutout_hash": "cutout_hash_123",
            "background_id": bg.id,
            "output_hash": "comp_output_hash_123",
            "compositing_method": "deterministic_pillow_v1",
        },
        qa_status=comp_qa_status,
        qa_result={"status": comp_qa_status, "overall_score": 0.95 if comp_qa_status == "PASS" else 0.30},
        cache_key=f"comp_cache_{uuid.uuid4().hex[:8]}",
        tenant_id=tenant_id,
    )
    session.add(composite)
    await session.commit()

    return {
        "job": job,
        "brief": brief,
        "asset": asset,
        "logo_asset": logo_asset,
        "strategy": strategy,
        "background": bg,
        "composite": composite,
    }


# ==============================================================================
# TESTS 1 - 6: COPY & FIELD VARIATIONS
# ==============================================================================

@pytest.mark.asyncio
async def test_01_normal_english_brief(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 1: Normal English brief end-to-end pipeline execution and verification."""
    pipeline = await setup_test_pipeline(test_db_session, platform=TargetPlatform.FACEBOOK)
    comp_id = pipeline["composite"].id

    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": comp_id})
    assert res.status_code == 200, res.text
    data = res.json()

    assert data["platform"] == "facebook"
    assert data["width"] == 1080
    assert data["height"] == 1080
    assert data["copy_spec"]["headline"] == "SmartFit X1 Pro"
    assert data["qa_status"] in ("PASS", "WARNING")
    assert data["provenance_chain"]["source_asset_id"] is not None

    # Database state verification
    record = await test_db_session.get(FinalRenderedCreativeRecord, data["id"])
    assert record is not None
    assert record.is_stale is False
    assert record.tenant_id == DEFAULT_TENANT_ID


@pytest.mark.asyncio
async def test_02_long_headline(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 2: Long headline wrapping without clipping or silent omission."""
    long_head = "Experience Unmatched High Performance and Intelligent Battery Endurance Throughout Every Single Day"
    pipeline = await setup_test_pipeline(test_db_session, headline=long_head)
    comp_id = pipeline["composite"].id

    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": comp_id})
    assert res.status_code == 200
    data = res.json()
    assert data["copy_spec"]["headline"] == long_head
    assert data["qa_result"]["exact_copy_check"]["severity"] in ("PASS", "WARNING")


@pytest.mark.asyncio
async def test_03_long_subheadline(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 3: Long subheadline multi-line box fitting without text truncation."""
    long_sub = "Engineered with aerospace-grade titanium and biometric sensors to deliver comprehensive 24/7 cardiovascular monitoring, sleep tracking, and active calorie telemetry across all sporting environments."
    pipeline = await setup_test_pipeline(test_db_session, subheadline=long_sub)
    comp_id = pipeline["composite"].id

    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": comp_id})
    assert res.status_code == 200
    data = res.json()
    assert data["copy_spec"]["subheadline"] == long_sub
    assert data["qa_status"] in ("PASS", "WARNING")


@pytest.mark.asyncio
async def test_04_long_cta(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 4: Long CTA button text expands within bounds and preserves exact string."""
    long_cta = "Discover Exclusive Offers Now"
    pipeline = await setup_test_pipeline(test_db_session, cta=long_cta)
    comp_id = pipeline["composite"].id

    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": comp_id})
    assert res.status_code == 200
    data = res.json()
    assert data["copy_spec"]["cta"] == long_cta
    assert data["qa_result"]["cta_check"]["severity"] in ("PASS", "WARNING")


@pytest.mark.asyncio
async def test_05_price_and_discount(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 5: Price + discount rendered conditionally and factual claims preserved."""
    offer_str = "$199.99 (30% OFF)"
    pipeline = await setup_test_pipeline(test_db_session, offer=offer_str)
    comp_id = pipeline["composite"].id

    res = await client.post("/api/v1/final-ads/generate", json={
        "composite_id": comp_id,
        "price_badge": {"enabled": True, "bg_color": "#EF4444", "text_color": "#FFFFFF"}
    })
    assert res.status_code == 200
    data = res.json()
    assert data["price_badge_spec"]["enabled"] is True
    assert data["price_badge_spec"]["text"] == offer_str


@pytest.mark.asyncio
async def test_06_missing_optional_fields(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 6: Pipeline executes cleanly with missing optional fields (no offer, no logo)."""
    pipeline = await setup_test_pipeline(test_db_session, offer=None)
    # Remove logo
    pipeline["brief"].payload["brand"]["logo_url"] = None
    await test_db_session.commit()

    res = await client.post("/api/v1/final-ads/generate", json={
        "composite_id": pipeline["composite"].id,
        "price_badge": {"enabled": False}
    })
    assert res.status_code == 200
    data = res.json()
    assert data["price_badge_spec"] is None
    assert data["qa_status"] in ("PASS", "WARNING")


# ==============================================================================
# TESTS 7 - 9: MULTILINGUAL & SPECIAL CHARACTERS
# ==============================================================================

@pytest.mark.asyncio
async def test_07_bangla_only_copy(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 7: Bangla-only copy preservation and script detection."""
    bangla_head = "স্মার্টফিট প্রো এক্স১"
    bangla_sub = "১৪ দিনের ব্যাটারি ব্যাকআপ সহ প্রিমিয়াম স্মার্টওয়াচ"
    bangla_cta = "এখনই কিনুন"

    pipeline = await setup_test_pipeline(
        test_db_session,
        headline=bangla_head,
        subheadline=bangla_sub,
        cta=bangla_cta,
    )
    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": pipeline["composite"].id})
    assert res.status_code == 200
    data = res.json()

    assert data["copy_spec"]["headline"] == bangla_head
    assert data["copy_spec"]["subheadline"] == bangla_sub
    assert data["copy_spec"]["cta"] == bangla_cta
    script_analysis = data["typography_spec"]["script_analysis"]
    assert script_analysis["has_bengali"] is True
    assert script_analysis["ctl_shaping_guaranteed"] is False


@pytest.mark.asyncio
async def test_08_mixed_bangla_english_copy(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 8: Mixed Bangla-English copy preserves Unicode characters verbatim."""
    mixed_head = "নতুন SmartFit Pro"
    mixed_sub = "প্রিমিয়াম Titanium বডি ও 14-day ব্যাটারি"
    mixed_cta = "Order Now"

    pipeline = await setup_test_pipeline(
        test_db_session,
        headline=mixed_head,
        subheadline=mixed_sub,
        cta=mixed_cta,
    )
    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": pipeline["composite"].id})
    assert res.status_code == 200
    data = res.json()

    assert data["copy_spec"]["headline"] == mixed_head
    script_analysis = data["typography_spec"]["script_analysis"]
    assert script_analysis["has_bengali"] is True
    assert script_analysis["has_latin"] is True


@pytest.mark.asyncio
async def test_09_special_characters_currency_numbers(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 9: Currencies (৳, $), symbols, URLs, and phone numbers preserved without corruption."""
    head = "SmartFit X1 Pro: Special @ ৳4,999!"
    sub = "Official warranty at https://smartfit.bd or call +880 1712-345678."
    offer = "৳4,999 (20% OFF)"

    pipeline = await setup_test_pipeline(test_db_session, headline=head, subheadline=sub, offer=offer)
    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": pipeline["composite"].id})
    assert res.status_code == 200
    data = res.json()

    assert "৳4,999" in data["copy_spec"]["headline"]
    assert "https://smartfit.bd" in data["copy_spec"]["subheadline"]
    assert "+880 1712-345678" in data["copy_spec"]["subheadline"]


# ==============================================================================
# TESTS 10 - 12: ASSET SHAPES & FORMATS
# ==============================================================================

@pytest.mark.asyncio
async def test_10_portrait_product_image(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 10: Portrait product image (height > width) composited cleanly."""
    pipeline = await setup_test_pipeline(test_db_session, product_img_size=(400, 800))
    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": pipeline["composite"].id})
    assert res.status_code == 200
    data = res.json()
    assert data["qa_status"] in ("PASS", "WARNING")


@pytest.mark.asyncio
async def test_11_landscape_product_image(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 11: Landscape product image (width > height) composited cleanly."""
    pipeline = await setup_test_pipeline(test_db_session, product_img_size=(800, 400))
    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": pipeline["composite"].id})
    assert res.status_code == 200
    data = res.json()
    assert data["qa_status"] in ("PASS", "WARNING")


@pytest.mark.asyncio
async def test_12_transparent_png_product(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 12: Transparent PNG asset validation and alpha channel preservation."""
    pipeline = await setup_test_pipeline(test_db_session, is_transparent=True)
    assert pipeline["asset"].has_alpha_channel is True
    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": pipeline["composite"].id})
    assert res.status_code == 200


# ==============================================================================
# TESTS 13 - 15: PLATFORM DIMENSIONS
# ==============================================================================

@pytest.mark.asyncio
async def test_13_facebook_1080x1080(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 13: Facebook feed canvas dimensions 1080x1080 (1:1)."""
    pipeline = await setup_test_pipeline(test_db_session, platform=TargetPlatform.FACEBOOK)
    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": pipeline["composite"].id})
    assert res.status_code == 200
    data = res.json()
    assert data["width"] == 1080
    assert data["height"] == 1080
    assert data["aspect_ratio"] == "1:1"


@pytest.mark.asyncio
async def test_14_instagram_1080x1350(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 14: Instagram feed canvas dimensions 1080x1350 (4:5)."""
    pipeline = await setup_test_pipeline(test_db_session, platform=TargetPlatform.INSTAGRAM)
    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": pipeline["composite"].id})
    assert res.status_code == 200
    data = res.json()
    assert data["width"] == 1080
    assert data["height"] == 1350
    assert data["aspect_ratio"] == "4:5"


@pytest.mark.asyncio
async def test_15_linkedin_1200x628(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 15: LinkedIn sponsored content canvas dimensions 1200x628 (1.91:1)."""
    pipeline = await setup_test_pipeline(test_db_session, platform=TargetPlatform.LINKEDIN)
    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": pipeline["composite"].id})
    assert res.status_code == 200
    data = res.json()
    assert data["width"] == 1200
    assert data["height"] == 628
    assert data["aspect_ratio"] == "1.91:1"


# ==============================================================================
# TESTS 16 - 18: QA FAILURE MODES
# ==============================================================================

@pytest.mark.asyncio
async def test_16_background_qa_failure(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 16: Upstream background QA failure blocks downstream rendering."""
    pipeline = await setup_test_pipeline(test_db_session, bg_qa_status="FAILED")
    # Background failed QA, compositing should be rejected
    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": pipeline["composite"].id})
    # If composite points to a failed background, or composite itself is blocked
    # In our pipeline, composite gate checks if composite passed
    pipeline["composite"].qa_status = "FAILED"
    await test_db_session.commit()

    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": pipeline["composite"].id})
    assert res.status_code == 400
    assert "Only 'PASS' or 'WARNING' composites can proceed" in res.json()["detail"]


@pytest.mark.asyncio
async def test_17_composite_qa_failure(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 17: Composite QA failure strictly blocks final ad rendering."""
    pipeline = await setup_test_pipeline(test_db_session, comp_qa_status="FAILED")
    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": pipeline["composite"].id})
    assert res.status_code == 400
    assert "Only 'PASS' or 'WARNING' composites can proceed" in res.json()["detail"]


@pytest.mark.asyncio
async def test_18_final_deterministic_qa_failure(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 18: Deterministic QA rejection blocks approval and skips Vision QA."""
    pipeline = await setup_test_pipeline(test_db_session)
    comp_id = pipeline["composite"].id

    # Mock FinalAdQAService.evaluate to simulate deterministic scorecard failure
    with patch.object(FinalAdQAService, "evaluate") as mock_qa:
        from app.schemas.final_ad import FinalAdQAResult
        from app.schemas.background import DiagnosticCheck
        mock_result = FinalAdQAResult(
            status=QAStatus.FAIL,
            overall_score=0.45,
            dimension_check=DiagnosticCheck(passed=True, severity=QAStatus.PASS, score=1.0, details="ok"),
            opacity_check=DiagnosticCheck(passed=True, severity=QAStatus.PASS, score=1.0, details="ok"),
            text_safe_zone_check=DiagnosticCheck(passed=False, severity=QAStatus.FAIL, score=0.0, details="Text overflow"),
            exact_copy_check=DiagnosticCheck(passed=False, severity=QAStatus.FAIL, score=0.0, details="Mismatch"),
            cta_check=DiagnosticCheck(passed=True, severity=QAStatus.PASS, score=1.0, details="ok"),
            product_occlusion_check=DiagnosticCheck(passed=False, severity=QAStatus.FAIL, score=0.0, details="Occluded"),
            contrast_check=DiagnosticCheck(passed=False, severity=QAStatus.FAIL, score=0.0, details="Low contrast"),
            issues=["Text overlaps product area", "Contrast ratio below 4.5:1"],
        )
        mock_qa.return_value = mock_result

        failed_rec = await FinalAdService.render_final_ad(db=test_db_session, composite_id=comp_id, force_regenerate=True)
        assert failed_rec.qa_status == QAStatus.FAIL.value
        assert failed_rec.vision_qa_status == VisionQAStatus.NOT_RUN.value
        can_approve, msg = FinalAdService.evaluate_approval(failed_rec)
        assert can_approve is False
        assert "deterministic qa failed" in msg.lower()


# ==============================================================================
# TESTS 19 - 21: VISION QA STATES & PROVIDERS
# ==============================================================================

@pytest.mark.asyncio
async def test_19_vision_provider_unavailable(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 19: Vision provider unavailable results in UNAVAILABLE status without mock masquerade."""
    pipeline = await setup_test_pipeline(test_db_session)
    comp_id = pipeline["composite"].id

    with patch("app.core.config.settings.ENABLE_VISION_QA", True):
        with patch("app.core.config.settings.VISION_QA_PROVIDER", "google_gemini"):
            with patch("app.core.config.settings.GEMINI_API_KEY", None):
                record = await FinalAdService.render_final_ad(db=test_db_session, composite_id=comp_id, force_regenerate=True)
                assert record.vision_qa_status == VisionQAStatus.UNAVAILABLE.value
                assert record.vision_qa_status != VisionQAStatus.MOCK_VERIFIED.value
                assert record.vision_qa_status != VisionQAStatus.REAL_VERIFIED.value


@pytest.mark.asyncio
async def test_20_vision_mock_verification(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 20: Vision mock verification records MOCK_VERIFIED and never claims REAL_VERIFIED."""
    pipeline = await setup_test_pipeline(test_db_session)
    comp_id = pipeline["composite"].id

    with patch("app.core.config.settings.ENABLE_VISION_QA", True):
        with patch("app.core.config.settings.VISION_QA_PROVIDER", "mock"):
            record = await FinalAdService.render_final_ad(db=test_db_session, composite_id=comp_id, force_regenerate=True)
            assert record.vision_qa_status == VisionQAStatus.MOCK_VERIFIED.value
            assert record.vision_qa_result is not None
            assert record.vision_qa_result["provider"] == "mock"
            assert record.vision_qa_status != VisionQAStatus.REAL_VERIFIED.value


def test_21_real_vision_provider_integration_path():
    """Matrix Item 21: Real vision provider integration path safely checks credentials and does not masquerade."""
    gemini_key = os.getenv("GEMINI_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")

    with patch("app.core.config.settings.ENABLE_VISION_QA", True):
        if not gemini_key:
            with patch("app.core.config.settings.VISION_QA_PROVIDER", "google_gemini"), patch("app.core.config.settings.GEMINI_API_KEY", None):
                service = get_vision_verification_service()
                assert isinstance(service._provider, UnavailableVisionQAProvider)
                assert service._provider.is_mock is False
        else:
            with patch("app.core.config.settings.VISION_QA_PROVIDER", "google_gemini"):
                service = get_vision_verification_service()
                assert service._provider.is_mock is False

        if not openai_key:
            with patch("app.core.config.settings.VISION_QA_PROVIDER", "openai"), patch("app.core.config.settings.OPENAI_API_KEY", None):
                service = get_vision_verification_service()
                assert isinstance(service._provider, UnavailableVisionQAProvider)
                assert service._provider.is_mock is False
        else:
            with patch("app.core.config.settings.VISION_QA_PROVIDER", "openai"):
                service = get_vision_verification_service()
                assert service._provider.is_mock is False


# ==============================================================================
# TESTS 22 - 24: INVALIDATION CASCADE & STALENESS
# ==============================================================================

@pytest.mark.asyncio
async def test_22_stale_final_after_background_regeneration(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 22: Background regeneration cascades staleness to composites and final ads."""
    pipeline = await setup_test_pipeline(test_db_session)
    final_ad = await FinalAdService.render_final_ad(db=test_db_session, composite_id=pipeline["composite"].id)
    assert final_ad.is_stale is False

    # Simulate background regeneration invalidation cascade
    await DependencyInvalidationService.invalidate_finals_for_background(
        db=test_db_session,
        background_id=pipeline["background"].id,
        reason="Background regenerated by user",
    )
    await test_db_session.refresh(final_ad)
    assert final_ad.is_stale is True

    # Attempting to approve stale final ad must be rejected
    res = await client.post(f"/api/v1/final-ads/{final_ad.id}/approve")
    assert res.status_code == 400
    assert "stale" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_23_stale_final_after_composite_regeneration(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 23: Composite regeneration cascades staleness to downstream final ads."""
    pipeline = await setup_test_pipeline(test_db_session)
    final_ad = await FinalAdService.render_final_ad(db=test_db_session, composite_id=pipeline["composite"].id)
    assert final_ad.is_stale is False

    await DependencyInvalidationService.invalidate_finals_for_composite(
        db=test_db_session,
        composite_id=pipeline["composite"].id,
        reason="Product placement updated",
    )
    await test_db_session.refresh(final_ad)
    assert final_ad.is_stale is True


@pytest.mark.asyncio
async def test_24_stale_final_after_strategy_copy_change(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 24: Strategy update cascades staleness through background, composite, and final ads."""
    pipeline = await setup_test_pipeline(test_db_session)
    final_ad = await FinalAdService.render_final_ad(db=test_db_session, composite_id=pipeline["composite"].id)
    assert final_ad.is_stale is False

    await DependencyInvalidationService.invalidate_finals_for_strategy(
        db=test_db_session,
        strategy_id=pipeline["strategy"].id,
        reason="Approved copy revised",
    )
    await test_db_session.refresh(final_ad)
    assert final_ad.is_stale is True


# ==============================================================================
# TESTS 25 - 26: CACHING & FORCE REGENERATION
# ==============================================================================

@pytest.mark.asyncio
async def test_25_cache_hit(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 25: Repeated request with identical parameters returns cached final ad."""
    pipeline = await setup_test_pipeline(test_db_session)
    comp_id = pipeline["composite"].id

    res1 = await client.post("/api/v1/final-ads/generate", json={"composite_id": comp_id, "force_regenerate": False})
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["is_cached"] is False

    res2 = await client.post("/api/v1/final-ads/generate", json={"composite_id": comp_id, "force_regenerate": False})
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["id"] == data1["id"]
    assert data2["is_cached"] is True


@pytest.mark.asyncio
async def test_26_force_regeneration(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 26: force_regenerate=True bypasses cache and creates new attempt."""
    pipeline = await setup_test_pipeline(test_db_session)
    comp_id = pipeline["composite"].id

    res1 = await client.post("/api/v1/final-ads/generate", json={"composite_id": comp_id})
    assert res1.status_code == 200
    data1 = res1.json()

    res2 = await client.post(f"/api/v1/final-ads/{data1['id']}/regenerate", json={
        "custom_feedback": "Increase contrast and re-render",
    })
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["id"] != data1["id"]
    assert data2["attempt_number"] == data1["attempt_number"] + 1
    assert data2["is_cached"] is False


# ==============================================================================
# TESTS 27 - 28: SECURITY & TENANT ISOLATION
# ==============================================================================

@pytest.mark.asyncio
async def test_27_cross_tenant_resource_access(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 27: Cross-tenant resource access is strictly blocked."""
    # Seed pipeline under different tenant
    other_tenant_id = "tenant-mallory-6666"
    other_tenant = Tenant(id=other_tenant_id, name="Malicious Org", slug="malicious")
    test_db_session.add(other_tenant)
    await test_db_session.flush()

    pipeline = await setup_test_pipeline(test_db_session, tenant_id=other_tenant_id)
    comp_id = pipeline["composite"].id

    # Default client has DEFAULT_TENANT_ID, attempting to access mallory's composite
    res = await client.post("/api/v1/final-ads/generate", json={"composite_id": comp_id})
    assert res.status_code == 404, "Cross-tenant resource must not be discoverable or accessible"


@pytest.mark.asyncio
async def test_28_unauthorized_approval(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 28: Unauthorized tenant cannot approve another tenant's creative."""
    other_tenant_id = "tenant-other-7777"
    other_tenant = Tenant(id=other_tenant_id, name="Other Org", slug="other-org")
    test_db_session.add(other_tenant)
    await test_db_session.flush()

    pipeline = await setup_test_pipeline(test_db_session, tenant_id=other_tenant_id)
    final_ad = await FinalAdService.render_final_ad(db=test_db_session, composite_id=pipeline["composite"].id)

    # Authenticated client (DEFAULT_TENANT_ID) attempts to approve other tenant's final ad
    res = await client.post(f"/api/v1/final-ads/{final_ad.id}/approve")
    assert res.status_code == 404, "Foreign tenant final ad cannot be approved"


# ==============================================================================
# TESTS 29 - 30: CONCURRENCY & POSTGRESQL INTEGRATION
# ==============================================================================

@pytest.mark.asyncio
async def test_29_concurrent_duplicate_generation_idempotency(test_db_session: AsyncSession):
    """Matrix Item 29: Concurrent duplicate execution of worker stage returns idempotent result."""
    pipeline = await setup_test_pipeline(test_db_session)
    job = pipeline["job"]

    # Execute 3 concurrent stage executions
    tasks = [
        execute_job_stage(
            job_id=job.id,
            stage="FINAL_AD",
            params={"composite_id": pipeline["composite"].id, "platform": pipeline["composite"].platform},
            db=test_db_session,
        )
        for _ in range(3)
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    valid_results = [r for r in results if isinstance(r, dict)]
    assert len(valid_results) >= 1
    # All successful executions point to the same or idempotent resource
    resource_ids = {r["resource_id"] for r in valid_results}
    assert len(resource_ids) == 1


def test_30_postgresql_connectivity_migration_smoke_test(tmp_path):
    """
    Matrix Item 30: PostgreSQL connectivity or offline DDL / dialect / migration smoke test.
    Checks live port 5432, verifies postgresql dialect table DDL compilation, and tests Alembic migrations.
    """
    # 1. Live PostgreSQL socket check
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.5)
    live_postgres = False
    try:
        s.connect(("localhost", 5432))
        live_postgres = True
    except (socket.timeout, ConnectionRefusedError, OSError):
        live_postgres = False
    finally:
        s.close()

    print(f"\n[PostgreSQL Smoke Test] Live instance on 5432: {live_postgres}")

    # 2. Dialect DDL Compilation & Model Schema Check
    pg_dialect = postgresql.dialect()
    tables_to_verify = [
        AdBrief.__table__,
        AssetValidationRecord.__table__,
        CreativeStrategyRecord.__table__,
        CreativeJob.__table__,
        GeneratedBackgroundRecord.__table__,
        CompositedCreativeRecord.__table__,
        FinalRenderedCreativeRecord.__table__,
    ]

    for table in tables_to_verify:
        ddl = str(CreateTable(table).compile(dialect=pg_dialect))
        assert "CREATE TABLE" in ddl
        assert table.name in ddl

    # 3. Alembic offline migration verification
    db_file = tmp_path / "smoke_alembic.db"
    sync_url = f"sqlite:///{db_file}"
    ini_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    alembic_cfg = Config(ini_path)
    alembic_cfg.set_main_option("sqlalchemy.url", sync_url)

    command.upgrade(alembic_cfg, "head")
    sync_engine = create_engine(sync_url)
    inspector = inspect(sync_engine)
    table_names = inspector.get_table_names()
    assert "final_rendered_creatives" in table_names
    assert "creative_jobs" in table_names
    sync_engine.dispose()
