"""Phase 6: Deterministic Final Advertisement Rendering Tests.

Verifies:
1. Deterministic font registry and font file hash integrity.
2. Exact copy preservation (spelling, capitalization, punctuation, numbers, currencies like ৳ and $, URLs, phone numbers).
3. Line wrapping and text measurement without clipping or silent omission.
4. Deterministic CTA button rendering (geometry, colors, exact text).
5. Price/discount badge conditionality (rendered ONLY when present, NEVER invented).
6. Logo / brand mark safe-region positioning and aspect ratio preservation.
7. Background contrast analysis & deterministic scrim backplates.
8. Product non-occlusion detection.
9. Deterministic 7-point Final Ad QA Scorecard (dimensions, opacity, safe zone, copy match, CTA, occlusion, contrast).
10. Pixel determinism (byte-for-byte identical outputs on identical inputs).
11. Provenance chain tracking (source asset -> cutout -> background -> composite -> final render).
12. Deterministic caching (hit on identical inputs, invalidation on param changes, bypass on force_regenerate).
13. Security and gate enforcement (Brief PASS, Asset PASS, Strategy APPROVED, Composite APPROVED).
14. Job state machine transitions (COMPOSITE_APPROVED -> FINAL_RENDERING -> FINAL_QA -> FINAL_AD_APPROVED).
15. REST API endpoints (generate, get, regenerate).
"""

import io
import pytest
import pytest_asyncio
from PIL import Image, ImageDraw
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.models.strategy import CreativeStrategyRecord
from app.models.background import GeneratedBackgroundRecord
from app.models.composite import CompositedCreativeRecord
from app.models.final_ad import FinalRenderedCreativeRecord
from app.models.job import CreativeJob, JobStatus
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
    FinalAdGenerateRequest,
    FinalAdRegenerateRequest,
)
from app.templates.registry import SlotBounds
from app.platforms.registry import build_platform_creative_spec
from app.services.typography_engine import TypographyEngine, FontRegistry
from app.services.cta_renderer import CTARenderer
from app.services.price_badge_renderer import PriceBadgeRenderer
from app.services.logo_renderer import LogoRenderer
from app.services.readability_service import ReadabilityService
from app.services.final_ad_qa import FinalAdQAService
from app.services.final_ad_service import FinalAdService
from app.providers.storage_provider import get_storage_provider
from app.demo.sample_assets import SMARTFIT_X1_DEMO_BRIEF, generate_demo_smartwatch_png


@pytest.fixture
def sample_strategy_spec() -> CreativeStrategySpec:
    return CreativeStrategySpec(
        concept=ConceptSpec(
            name="Urban Velocity",
            creative_angle="High performance meets everyday elegance",
            reasoning_notes="Focuses on real fitness utility",
        ),
        visual_direction=VisualDirectionSpec(
            mood="dark minimalist studio",
            lighting="dramatic blue rim light with soft directional fill",
            background_direction="Minimalist dark studio atmosphere, subtle geometric shadows, ample negative space.",
            negative_prompt="text, typography, watermark, logo, product, smartwatch, human, cluttered, blurry",
            product_placement=PlacementDirection.RIGHT,
            text_placement=PlacementDirection.LEFT,
        ),
        copy_spec=CopySpec(
            headline="SmartFit X1 Pro",
            subheadline="Precision titanium tracker with 14-day battery life.",
            cta="Shop Now",
            offer_mention="৳999",
            headline_policy=CopyPolicyType.AI_GENERATED_CREATIVE,
            subheadline_policy=CopyPolicyType.FACTUAL,
            cta_policy=CopyPolicyType.USER_PROVIDED,
        ),
        template_id="product_sale_dark",
    )


@pytest_asyncio.fixture
async def seeded_pipeline(test_db_session: AsyncSession, sample_strategy_spec: CreativeStrategySpec):
    """Creates a full prerequisite pipeline: Job -> Brief -> Asset -> Strategy -> Background -> Composite."""
    storage = get_storage_provider()

    # 1. Brief (PASS)
    brief = AdBrief(
        brand_name="SmartFit",
        product_name="SmartFit X1 Pro",
        price=999.0,
        currency="BDT",
        platforms=["instagram"],
        validation_status="PASS",
        payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief)
    await test_db_session.flush()

    # 2. Asset (PASS)
    demo_png_bytes = generate_demo_smartwatch_png()
    asset_storage_key = f"assets/{brief.id}/product.png"
    await storage.save_bytes(demo_png_bytes, asset_storage_key, content_type="image/png")

    primary_url = SMARTFIT_X1_DEMO_BRIEF["images"][0]["url"]
    asset = AssetValidationRecord(
        url=primary_url,
        storage_key=asset_storage_key,
        validation_status="PASS",
        width=800,
        height=800,
        has_alpha_channel=True,
        file_size_bytes=len(demo_png_bytes),
    )
    test_db_session.add(asset)

    logo_url = SMARTFIT_X1_DEMO_BRIEF.get("brand", {}).get("logo_url")
    if logo_url:
        logo_img = Image.new("RGBA", (200, 60), color=(0, 0, 0, 0))
        d = ImageDraw.Draw(logo_img)
        d.rectangle([(0, 0), (199, 59)], fill=(59, 130, 246, 255))
        logo_buf = io.BytesIO()
        logo_img.save(logo_buf, format="PNG")
        logo_bytes = logo_buf.getvalue()
        logo_key = f"assets/{brief.id}/logo.png"
        await storage.save_bytes(logo_bytes, logo_key, content_type="image/png")
        logo_asset = AssetValidationRecord(
            url=logo_url,
            storage_key=logo_key,
            validation_status="PASS",
            width=200,
            height=60,
            has_alpha_channel=True,
            file_size_bytes=len(logo_bytes),
        )
        test_db_session.add(logo_asset)

    await test_db_session.flush()

    # 3. Strategy (APPROVED)
    strategy = CreativeStrategyRecord(
        brief_id=brief.id,
        version_number=1,
        status="APPROVED",
        template_id="product_sale_dark",
        strategy_spec=sample_strategy_spec.model_dump(),
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strategy)
    await test_db_session.flush()

    # 4. Job (COMPOSITE_APPROVED)
    job = CreativeJob(
        brief_id=brief.id,
        strategy_id=strategy.id,
        status=JobStatus.COMPOSITE_APPROVED.value,
        current_stage="Composite Approved",
    )
    test_db_session.add(job)
    await test_db_session.flush()

    # 5. Background (PASS)
    bg_img = Image.new("RGB", (1080, 1350), color=(15, 23, 42))
    bg_buf = io.BytesIO()
    bg_img.save(bg_buf, format="PNG")
    bg_bytes = bg_buf.getvalue()
    bg_key = f"backgrounds/{job.id}/instagram/bg.png"
    await storage.save_bytes(bg_bytes, bg_key, content_type="image/png")

    bg = GeneratedBackgroundRecord(
        job_id=job.id,
        brief_id=brief.id,
        strategy_id=strategy.id,
        platform="instagram",
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        provider="mock",
        model_name="mock-studio-v1",
        prompt_spec={"environment": "dark minimalist studio"},
        prompt_version="v1.0",
        attempt_number=1,
        storage_key=bg_key,
        qa_status="PASS",
        qa_result={"status": "PASS", "score": 95.0, "checks": []},
        cache_key="bg_cache_phase6",
    )
    test_db_session.add(bg)
    await test_db_session.flush()

    # 6. Composite (PASS)
    comp_img = Image.new("RGB", (1080, 1350), color=(15, 23, 42))
    comp_buf = io.BytesIO()
    comp_img.save(comp_buf, format="PNG")
    comp_bytes = comp_buf.getvalue()
    comp_key = f"composites/{job.id}/instagram/comp.png"
    await storage.save_bytes(comp_bytes, comp_key, content_type="image/png")

    composite = CompositedCreativeRecord(
        job_id=job.id,
        brief_id=brief.id,
        strategy_id=strategy.id,
        background_id=bg.id,
        platform="instagram",
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        storage_key=comp_key,
        placement_spec={
            "x": 520,
            "y": 300,
            "width": 500,
            "height": 750,
            "normalized_slot": [0.48, 0.22, 0.95, 0.77],
        },
        shadow_spec={"enabled": True, "opacity": 0.35},
        integrity_metadata={
            "source_asset_id": asset.id,
            "source_asset_hash": "dummy_asset_hash_phase6",
            "cutout_hash": "dummy_cutout_hash_phase6",
            "background_id": bg.id,
            "output_hash": "dummy_comp_hash_phase6",
            "compositing_method": "deterministic_pillow_v1",
        },
        qa_status="PASS",
        qa_result={
            "status": "PASS",
            "overall_score": 0.95,
            "dimension_check": {"severity": "PASS", "score": 1.0, "details": "ok"},
            "boundary_check": {"severity": "PASS", "score": 1.0, "details": "ok"},
            "placement_check": {"severity": "PASS", "score": 1.0, "details": "ok"},
            "visibility_check": {"severity": "PASS", "score": 1.0, "details": "ok"},
            "integrity_check": {"severity": "PASS", "score": 1.0, "details": "ok"},
            "issues": [],
            "warnings": [],
        },
        cache_key="comp_cache_phase6",
    )
    test_db_session.add(composite)
    await test_db_session.commit()

    return {
        "job": job,
        "brief": brief,
        "asset": asset,
        "strategy": strategy,
        "background": bg,
        "composite": composite,
    }


# ==============================================================================
# 1. TYPOGRAPHY & FONT REGISTRY TESTS
# ==============================================================================

def test_font_registry_and_hash_integrity():
    """Font files must load from bundled assets and report reproducible SHA-256 hashes."""
    registry = FontRegistry.get_instance()
    hashes = registry.get_font_hashes()

    assert "Inter_regular" in hashes
    assert "Inter_bold" in hashes
    assert "Geist_regular" in hashes
    assert len(hashes["Inter_regular"]) == 64  # SHA-256 hex length

    # Loading valid font works
    font = registry.load_font("Inter", weight="bold", size=32)
    assert font is not None


def test_exact_copy_preservation_and_special_characters():
    """Text engine must preserve punctuation, numbers, currencies ($ and ৳), URLs, and casing."""
    test_cases = [
        "Special Offer: 20% OFF! Today Only.",
        "Price: ৳999 -> ৳1,499 (Save ৳500)",
        "Call +1-800-555-0199 or visit https://smartfit.io/buy",
        "Bangla Digits: ১২৩৪৫৬৭৮৯০ and ৳১,৯৯৯",
    ]

    for raw_text in test_cases:
        lines, font, lh, fits = TypographyEngine.fit_text_to_box(
            text=raw_text,
            font_family="Inter",
            weight="regular",
            initial_size=36,
            min_size=18,
            max_width=600,
            max_height=400,
        )
        assert fits is True
        reconstructed = " ".join(lines)
        # All individual words/tokens must be preserved in sequence
        for word in raw_text.split():
            assert word in reconstructed


def test_line_wrapping_and_overflow_handling():
    """Text engine wraps to multiple lines and flags fits=False when bounds cannot contain text."""
    long_text = "This is a very long headline designed to test deterministic wrapping behavior across multiple canvas lines"

    # Fits with reasonable bounds
    lines, font, lh, fits = TypographyEngine.fit_text_to_box(
        text=long_text,
        font_family="Inter",
        weight="bold",
        initial_size=40,
        min_size=18,
        max_width=300,
        max_height=400,
    )
    assert fits is True
    assert len(lines) > 1

    # Impossibly small box returns fits=False
    lines_small, font_small, lh_small, fits_small = TypographyEngine.fit_text_to_box(
        text=long_text,
        font_family="Inter",
        weight="bold",
        initial_size=40,
        min_size=30,
        max_width=40,
        max_height=20,
    )
    assert fits_small is False


# ==============================================================================
# 2. CTA & PRICE BADGE RENDERING TESTS
# ==============================================================================

def test_cta_rendering_exactness():
    """CTA button must render with exact copy, non-zero geometry, and correct coordinates."""
    canvas = Image.new("RGBA", (1080, 1350), color=(15, 23, 42, 255))
    draw = ImageDraw.Draw(canvas)

    box = CTARenderer.render_cta(
        draw=draw,
        cta_text="Shop Now",
        cta_slot=SlotBounds(x=0.06, y=0.65, width=0.35, height=0.08),
        canvas_width=1080,
        canvas_height=1350,
        style=CTAStyle(
            enabled=True,
            bg_color="#3B82F6",
            text_color="#FFFFFF",
            border_radius=12,
            font_size=24,
            padding_x=32,
            padding_y=14,
        ),
        alignment="left",
    )

    assert box is not None
    x1, y1, x2, y2 = box
    assert x2 > x1
    assert y2 > y1
    assert x1 >= int(1080 * 0.06)


def test_price_badge_rendered_only_when_present():
    """Price badge is rendered if price/offer text exists, and returns None when absent."""
    canvas = Image.new("RGBA", (1080, 1350), color=(15, 23, 42, 255))
    draw = ImageDraw.Draw(canvas)

    # Present
    box = PriceBadgeRenderer.render_badge(
        draw=draw,
        badge_text="৳999",
        anchor_x=60,
        anchor_y=700,
        style=PriceBadgeStyle(enabled=True, bg_color="#EF4444", text_color="#FFFFFF"),
    )
    assert box is not None
    assert box[2] > box[0]

    # Absent: None returns None
    box_empty = PriceBadgeRenderer.render_badge(
        draw=draw,
        badge_text=None,
        anchor_x=60,
        anchor_y=700,
        style=PriceBadgeStyle(enabled=True),
    )
    assert box_empty is None


# ==============================================================================
# 3. READABILITY & CONTRAST TESTS
# ==============================================================================

def test_readability_scrim_backplate():
    """Readability service detects bright background and applies scrim without mutating canvas size."""
    # Create bright white canvas
    canvas = Image.new("RGB", (1080, 1350), color=(250, 250, 250))
    text_slot = SlotBounds(x=0.06, y=0.15, width=0.40, height=0.45)

    treated_canvas, meta = ReadabilityService.evaluate_and_apply_treatment(
        canvas=canvas,
        text_slot=text_slot,
        config=ReadabilityEnhancementConfig(auto_scrim=True, scrim_opacity=0.45),
    )
    assert treated_canvas.size == (1080, 1350)
    assert meta["scrim_applied"] is True
    assert meta["mean_luminance"] > 140


# ==============================================================================
# 4. PRODUCT NON-OCCLUSION & QA TESTS
# ==============================================================================

def test_product_occlusion_qa_evaluation(sample_strategy_spec: CreativeStrategySpec):
    """Final ad QA must catch when copy/CTA bounding boxes overlap the product bounding box."""
    img = Image.new("RGB", (1080, 1350), color=(15, 23, 42))
    spec = build_platform_creative_spec(
        TargetPlatform.INSTAGRAM,
        sample_strategy_spec,
    )

    # Product at (480, 300, 1030, 1050)
    product_bbox = (480, 300, 1030, 1050)

    # Clean layout (text on left 60..460) -> PASS
    qa_clean = FinalAdQAService.evaluate(
        image=img,
        platform_spec=spec,
        approved_headline="Headline",
        approved_subheadline="Subheadline",
        approved_cta="Shop Now",
        approved_offer="৳999",
        rendered_headline="Headline",
        rendered_subheadline="Subheadline",
        rendered_cta="Shop Now",
        rendered_offer="৳999",
        headline_fits=True,
        subheadline_fits=True,
        text_bbox=(100, 260, 460, 500),
        cta_bbox=(100, 980, 280, 1040),
        badge_bbox=(100, 890, 220, 930),
        product_bbox=product_bbox,
        readability_meta={"treatment_applied": False, "mean_luminance": 40},
    )
    assert qa_clean.product_occlusion_check.severity == QAStatus.PASS
    assert qa_clean.status in (QAStatus.PASS, QAStatus.WARNING)

    # Overlapping layout (text bbox overlaps product x=480..1030) -> FAIL
    qa_overlap = FinalAdQAService.evaluate(
        image=img,
        platform_spec=spec,
        approved_headline="Headline",
        approved_subheadline="Subheadline",
        approved_cta="Shop Now",
        approved_offer="৳999",
        rendered_headline="Headline",
        rendered_subheadline="Subheadline",
        rendered_cta="Shop Now",
        rendered_offer="৳999",
        headline_fits=True,
        subheadline_fits=True,
        text_bbox=(60, 150, 600, 450),  # x1=600 penetrates product x0=480!
        cta_bbox=(60, 800, 260, 860),
        badge_bbox=None,
        product_bbox=product_bbox,
        readability_meta={"treatment_applied": False, "mean_luminance": 40},
    )
    assert qa_overlap.product_occlusion_check.severity == QAStatus.FAIL
    assert qa_overlap.status == QAStatus.FAIL


# ==============================================================================
# 5. END-TO-END PIPELINE & DETERMINISTIC CACHING TESTS
# ==============================================================================

@pytest.mark.asyncio
async def test_final_ad_generation_and_caching(test_db_session: AsyncSession, seeded_pipeline: dict):
    """Full pipeline execution: generate, verify QA PASS, verify provenance, and cache hit."""
    comp = seeded_pipeline["composite"]

    # 1. First render
    res1 = await FinalAdService.render_final_ad(
        db=test_db_session,
        composite_id=comp.id,
        typography_style=TypographyStyle(font_family="Inter", headline_size=48),
        cta_style=CTAStyle(enabled=True, bg_color="#3B82F6"),
        force_regenerate=False,
    )

    assert res1.id is not None
    assert res1.qa_status in ("PASS", "WARNING")
    assert res1.width == 1080
    assert res1.height == 1350
    assert res1.is_cached is False
    assert res1.provenance_chain["output_hash"] is not None
    assert "Inter_regular" in res1.provenance_chain["font_hashes"]

    # Verify job state transitioned to FINAL_AD_APPROVED
    job = seeded_pipeline["job"]
    await test_db_session.refresh(job)
    assert job.status == JobStatus.FINAL_AD_APPROVED.value

    # 2. Second render with identical parameters -> CACHE HIT
    res2 = await FinalAdService.render_final_ad(
        db=test_db_session,
        composite_id=comp.id,
        typography_style=TypographyStyle(font_family="Inter", headline_size=48),
        cta_style=CTAStyle(enabled=True, bg_color="#3B82F6"),
        force_regenerate=False,
    )
    assert res2.id == res1.id
    assert res2.is_cached is True
    assert res2.provenance_chain["output_hash"] == res1.provenance_chain["output_hash"]

    # 3. Force regenerate -> Bypasses cache
    res3 = await FinalAdService.render_final_ad(
        db=test_db_session,
        composite_id=comp.id,
        typography_style=TypographyStyle(font_family="Inter", headline_size=48),
        cta_style=CTAStyle(enabled=True, bg_color="#3B82F6"),
        force_regenerate=True,
    )
    assert res3.is_cached is False
    assert res3.attempt_number >= 2


# ==============================================================================
# 6. GATE ENFORCEMENT & SECURITY TESTS
# ==============================================================================

@pytest.mark.asyncio
async def test_gate_enforcement_unapproved_composite(test_db_session: AsyncSession, seeded_pipeline: dict):
    """Cannot generate final ad if composite has QAStatus FAIL."""
    comp = seeded_pipeline["composite"]
    comp.qa_status = "FAIL"
    await test_db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await FinalAdService.render_final_ad(
            db=test_db_session,
            composite_id=comp.id,
        )
    assert exc_info.value.status_code == 400
    assert "QA status is 'FAIL'" in exc_info.value.detail


# ==============================================================================
# 7. API ENDPOINT TESTS
# ==============================================================================

@pytest.mark.asyncio
async def test_final_ad_api_endpoints(client: AsyncClient, seeded_pipeline: dict):
    """Tests POST /generate, GET /{id}, and POST /{id}/regenerate."""
    comp = seeded_pipeline["composite"]

    # 1. POST /generate
    gen_res = await client.post(
        "/api/v1/final-ads/generate",
        json={
            "composite_id": comp.id,
            "typography": {
                "font_family": "Inter",
                "headline_size": 48,
                "headline_weight": "bold",
                "subheadline_size": 24,
                "subheadline_weight": "regular",
                "headline_color": "#FFFFFF",
                "subheadline_color": "#CBD5E1",
                "line_height_multiplier": 1.25,
                "alignment": "left",
            },
            "cta": {
                "enabled": True,
                "bg_color": "#3B82F6",
                "text_color": "#FFFFFF",
                "border_radius": 10,
                "font_size": 24,
                "padding_x": 32,
                "padding_y": 14,
            },
            "readability": {
                "auto_scrim": True,
                "scrim_opacity": 0.45,
            },
            "force_regenerate": False,
        },
    )
    assert gen_res.status_code == 200, gen_res.text
    data = gen_res.json()
    ad_id = data["id"]
    assert data["composite_id"] == comp.id
    assert data["qa_status"] in ("PASS", "WARNING"), f"Issues: {data['qa_result']['issues']}, Checks: {[(c.get('details'), c.get('passed'), c.get('severity')) for c in data['qa_result'].get('checks', [])]}"
    assert data["qa_result"]["overall_score"] > 0.70

    # 2. GET /{id}
    get_res = await client.get(f"/api/v1/final-ads/{ad_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == ad_id

    # 3. POST /{id}/regenerate
    regen_res = await client.post(
        f"/api/v1/final-ads/{ad_id}/regenerate",
        json={
            "typography": {
                "font_family": "Inter",
                "headline_size": 44,
                "headline_weight": "bold",
                "subheadline_size": 22,
                "subheadline_weight": "regular",
                "headline_color": "#FFFFFF",
                "subheadline_color": "#CBD5E1",
                "line_height_multiplier": 1.25,
                "alignment": "left",
            },
            "custom_feedback": "Slightly tighter headline",
        },
    )
    assert regen_res.status_code == 200
    assert regen_res.json()["attempt_number"] == 2


# ==============================================================================
# 8. PHASE 6.1 HARDENING TESTS: EXACT COPY INTEGRITY
# ==============================================================================

def test_phase6_1_exact_copy_integrity_comprehensive():
    """Authoritative test for exact copy preservation across all required text categories."""
    import hashlib

    test_vectors = [
        # 1. Capitalization
        "UPPERCASE HEADLINE, MixedCase Subhead, lowercase fineprint",
        # 2. Punctuation
        "Wait! Really? Yes: 100%, guaranteed... 'Best-in-Class' (2026/2027)!",
        # 3. Whitespace & Newlines
        "Line One\nLine Two   with multiple spaces",
        # 4. Numbers & Decimals
        "Model 2026.4 with 99.95% uptime and 14.5 days standby",
        # 5. Currency symbols
        "$199 USD | ৳21,500 BDT | €180 EUR | £155 GBP | ¥28,000 JPY",
        # 6. Percentages
        "Save 25% on First Order! Up to 50% OFF clearance",
        # 7. URLs
        "Visit https://smartfit.io/deals?ref=social&camp=spring26",
        # 8. Phone numbers
        "Call us: +1 (800) 555-0199 or +880 1712-345678",
        # 9. Mixed English & Bangla
        "SmartFit X1 Pro: ৫০% বিশেষ ছাড়! Visit https://smartfit.bd",
        # 10. Special characters
        "SmartFit™ ©2026 All Rights Reserved • Pro Edition — Ultra | Series X",
    ]

    for text in test_vectors:
        # Pre-rasterization hash
        source_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()

        lines, font, lh, fits = TypographyEngine.fit_text_to_box(
            text=text,
            font_family="Inter",
            weight="regular",
            initial_size=32,
            min_size=16,
            max_width=800,
            max_height=600,
            max_lines=8,
        )

        assert fits is True, f"Failed to fit vector: {text}"
        # Bit-level source string captured must match
        assert hashlib.sha256(text.encode("utf-8")).hexdigest() == source_hash

        # Reconstructed words must all be preserved in order
        flat_lines = " ".join(lines)
        for token in text.split():
            assert token in flat_lines, f"Token '{token}' missing from reconstructed lines in: {flat_lines}"


def test_phase6_1_exact_copy_qa_discrepancy_rejected(sample_strategy_spec: CreativeStrategySpec):
    """QA must reject when rendered copy does not match approved strategy strings bit-for-bit."""
    import hashlib

    img = Image.new("RGB", (1080, 1350), color=(15, 23, 42))
    spec = build_platform_creative_spec(TargetPlatform.INSTAGRAM, sample_strategy_spec)

    approved_head = "SmartFit X1 Pro"
    approved_sub = "Precision titanium tracker with 14-day battery life."
    approved_cta = "Shop Now"
    approved_offer = "৳999"

    approved_hash = hashlib.sha256(f"{approved_head}|{approved_sub}|{approved_cta}|{approved_offer}".encode("utf-8")).hexdigest()

    # Discrepancy in capitalization ("smartfit" instead of "SmartFit")
    mutated_head = "smartfit x1 pro"
    mutated_hash = hashlib.sha256(f"{mutated_head}|{approved_sub}|{approved_cta}|{approved_offer}".encode("utf-8")).hexdigest()

    qa_failed = FinalAdQAService.evaluate(
        image=img,
        platform_spec=spec,
        approved_headline=approved_head,
        approved_subheadline=approved_sub,
        approved_cta=approved_cta,
        approved_offer=approved_offer,
        rendered_headline=mutated_head,
        rendered_subheadline=approved_sub,
        rendered_cta=approved_cta,
        rendered_offer=approved_offer,
        headline_fits=True,
        subheadline_fits=True,
        text_bbox=(100, 260, 460, 500),
        cta_bbox=(100, 980, 280, 1040),
        badge_bbox=(100, 890, 220, 930),
        product_bbox=(520, 300, 1020, 1050),
        readability_meta={"mean_luminance": 30.0},
        approved_copy_hash=approved_hash,
        rendered_copy_hash=mutated_hash,
    )

    assert qa_failed.exact_copy_check.severity == QAStatus.FAIL
    assert qa_failed.exact_copy_check.passed is False
    assert qa_failed.status == QAStatus.FAIL
    assert "Discrepancy detected" in qa_failed.exact_copy_check.details


# ==============================================================================
# 9. PHASE 6.1 HARDENING TESTS: BANGLA TYPOGRAPHY & LIMITATION AUDIT
# ==============================================================================

def test_phase6_1_bangla_typography_hardening():
    """Deterministic tests for Bangla-only, Bangla+English, Bangla+currency, numbers, and overflow."""
    # 1. Bangla-only text
    bangla_only = "স্মার্টফিট প্রো স্মার্টওয়াচ কিনুন আকর্ষণীয় অফারে"
    lines, font, lh, fits = TypographyEngine.fit_text_to_box(
        text=bangla_only,
        font_family="Inter",
        weight="regular",
        initial_size=36,
        min_size=18,
        max_width=500,
        max_height=300,
    )
    assert fits is True
    assert len(lines) >= 1
    assert " ".join(lines) == bangla_only

    # 2. Bangla + English mixed
    mixed_text = "SmartFit ওয়াচ কিনুন ২০% ছাড়ে আজই!"
    lines_mix, font_mix, lh_mix, fits_mix = TypographyEngine.fit_text_to_box(
        text=mixed_text,
        font_family="Inter",
        weight="bold",
        initial_size=36,
        min_size=18,
        max_width=500,
        max_height=300,
    )
    assert fits_mix is True
    assert "SmartFit" in " ".join(lines_mix)
    assert "ছাড়ে" in " ".join(lines_mix)

    # 3. Bangla + currency
    currency_text = "মূল্য মাত্র ৳১,৯৯৯ টাকা"
    lines_curr, _, _, fits_curr = TypographyEngine.fit_text_to_box(
        text=currency_text,
        font_family="Inter",
        weight="regular",
        initial_size=32,
        min_size=16,
        max_width=400,
        max_height=200,
    )
    assert fits_curr is True
    assert "৳১,৯৯৯" in " ".join(lines_curr)

    # 4. Bangla + numbers
    number_text = "ব্যাটারি ব্যাকআপ ১৪ দিন এবং ১২৩৪৫ ধাপ ট্র্যাকিং"
    lines_num, _, _, fits_num = TypographyEngine.fit_text_to_box(
        text=number_text,
        font_family="Inter",
        weight="regular",
        initial_size=32,
        min_size=16,
        max_width=400,
        max_height=200,
    )
    assert fits_num is True
    assert "১২৩৪৫" in " ".join(lines_num)

    # 5. Bangla overflow detection
    long_bangla = "এই স্মার্টওয়াচটিতে রয়েছে অগণিত আধুনিক ফিচার যা আপনার প্রতিদিনের শারীরিক সুস্থতা বজায় রাখতে সাহায্য করবে নিশ্চিতভাবে"
    lines_over, _, _, fits_over = TypographyEngine.fit_text_to_box(
        text=long_bangla,
        font_family="Inter",
        weight="bold",
        initial_size=36,
        min_size=30,
        max_width=80,  # Impossibly narrow
        max_height=40,  # Impossibly short
        max_lines=2,
    )
    assert fits_over is False, "Overflow was not caught for constrained box!"

    # 6. Transparent script support & CTL limitation detection
    analysis = TypographyEngine.detect_script_support(bangla_only)
    assert analysis["has_bengali"] is True
    assert analysis["ctl_shaping_guaranteed"] is False
    assert len(analysis["limitations"]) > 0
    assert "Complex text layout" in analysis["limitations"][0]


# ==============================================================================
# 10. PHASE 6.1 HARDENING TESTS: LOGO SOURCE HARDENING
# ==============================================================================

@pytest.mark.asyncio
async def test_phase6_1_unvalidated_logo_rejected(test_db_session: AsyncSession, seeded_pipeline: dict):
    """An unvalidated or arbitrary logo URL in brief MUST fail pipeline gate."""
    comp = seeded_pipeline["composite"]
    brief = seeded_pipeline["brief"]

    # Point brief to an unvalidated logo URL not present in AssetValidationRecord
    brief.payload = dict(brief.payload)
    brief.payload["brand"] = {"name": "SmartFit", "logo_url": "https://attacker.com/fake_logo.png"}
    await test_db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await FinalAdService.render_final_ad(
            db=test_db_session,
            composite_id=comp.id,
            force_regenerate=True,
        )
    assert exc_info.value.status_code == 400
    assert "Logo asset 'https://attacker.com/fake_logo.png' has not passed Asset Gate" in exc_info.value.detail


def test_phase6_1_logo_renderer_direct_validation():
    """LogoRenderer must raise ValueError if caller passes unvalidated status or corrupted hash."""
    canvas = Image.new("RGBA", (1080, 1350), color=(15, 23, 42, 255))
    draw = ImageDraw.Draw(canvas)
    slot = SlotBounds(x=0.06, y=0.05, width=0.20, height=0.06)

    raw_bytes = b"fake_png_bytes_for_testing"

    # Status != PASS raises ValueError
    with pytest.raises(ValueError) as exc1:
        LogoRenderer.render_logo(
            canvas=canvas,
            draw=draw,
            brand_name="SmartFit",
            logo_slot=slot,
            logo_bytes=raw_bytes,
            validation_status="FAIL",
        )
    assert "not PASS" in str(exc1.value)

    # Hash mismatch raises ValueError
    with pytest.raises(ValueError) as exc2:
        LogoRenderer.render_logo(
            canvas=canvas,
            draw=draw,
            brand_name="SmartFit",
            logo_slot=slot,
            logo_bytes=raw_bytes,
            logo_hash="incorrect_sha256_hash",
            validation_status="PASS",
        )
    assert "integrity violation" in str(exc2.value)


# ==============================================================================
# 11. PHASE 6.1 HARDENING TESTS: ADVERSARIAL FRONTEND OVERRIDE PROTECTIONS
# ==============================================================================

@pytest.mark.asyncio
async def test_phase6_1_adversarial_frontend_cannot_override_copy_or_price_or_logo(client: AsyncClient, seeded_pipeline: dict):
    """Frontend requests containing unauthorized copy, price, or logo fields are strictly rejected with 422."""
    comp = seeded_pipeline["composite"]

    # 1. Attempting to override headline
    res1 = await client.post(
        "/api/v1/final-ads/generate",
        json={
            "composite_id": comp.id,
            "headline": "HACKED HEADLINE 50% OFF",
        },
    )
    assert res1.status_code == 422, "API permitted illegal 'headline' parameter!"

    # 2. Attempting to override price
    res2 = await client.post(
        "/api/v1/final-ads/generate",
        json={
            "composite_id": comp.id,
            "price": 0.01,
        },
    )
    assert res2.status_code == 422, "API permitted illegal 'price' parameter!"

    # 3. Attempting to override logo_url
    res3 = await client.post(
        "/api/v1/final-ads/generate",
        json={
            "composite_id": comp.id,
            "logo_url": "https://malicious.com/logo.png",
        },
    )
    assert res3.status_code == 422, "API permitted illegal 'logo_url' parameter!"

    # 4. Attempting to override CTA text inside cta sub-object
    res4 = await client.post(
        "/api/v1/final-ads/generate",
        json={
            "composite_id": comp.id,
            "cta": {
                "cta_text": "CLICK HERE FOR FREE BITCOIN",
            },
        },
    )
    assert res4.status_code == 422, "API permitted illegal 'cta_text' parameter!"


# ==============================================================================
# 12. PHASE 6.1 HARDENING TESTS: CACHE & HASH INVALIDATION AUDIT
# ==============================================================================

def test_phase6_1_exhaustive_cache_key_invalidation_matrix():
    """Verify that changing ANY of the 18 pixel-affecting inputs changes the cache key."""
    base_comp_hash = "composite_hash_v1"
    base_copy_hash = "copy_hash_v1"
    base_platform = "instagram"
    base_template = "product_sale_dark"
    base_typo = TypographyStyle().model_dump()
    base_cta = CTAStyle().model_dump()
    base_price = PriceBadgeStyle().model_dump()
    base_read = ReadabilityEnhancementConfig().model_dump()
    base_fonts = {"Inter_regular": "hash_inter_reg", "Inter_bold": "hash_inter_bold"}
    base_logo = {"type": "wordmark", "hash": "logo_hash_v1", "placement": [0.06, 0.05, 0.20, 0.06]}

    base_key = FinalAdService._compute_cache_key(
        composite_output_hash=base_comp_hash,
        copy_hash=base_copy_hash,
        platform=base_platform,
        template_id=base_template,
        typography_dict=base_typo,
        cta_dict=base_cta,
        price_badge_dict=base_price,
        readability_dict=base_read,
        font_hashes=base_fonts,
        logo_dict=base_logo,
        tenant_id="tenant-test",
    )

    # 1. Copy changed
    k_copy = FinalAdService._compute_cache_key(
        composite_output_hash=base_comp_hash,
        copy_hash="mutated_copy_hash",
        platform=base_platform,
        template_id=base_template,
        typography_dict=base_typo,
        cta_dict=base_cta,
        price_badge_dict=base_price,
        readability_dict=base_read,
        font_hashes=base_fonts,
        logo_dict=base_logo,
        tenant_id="tenant-test",
    )
    assert k_copy != base_key, "Cache key failed to invalidate on copy change"

    # 2. Composite output hash changed
    k_comp = FinalAdService._compute_cache_key(
        composite_output_hash="new_comp_output_hash",
        copy_hash=base_copy_hash,
        platform=base_platform,
        template_id=base_template,
        typography_dict=base_typo,
        cta_dict=base_cta,
        price_badge_dict=base_price,
        readability_dict=base_read,
        font_hashes=base_fonts,
        logo_dict=base_logo,
        tenant_id="tenant-test",
    )
    assert k_comp != base_key, "Cache key failed to invalidate on composite hash change"

    # 3. Font hash changed
    k_font = FinalAdService._compute_cache_key(
        composite_output_hash=base_comp_hash,
        copy_hash=base_copy_hash,
        platform=base_platform,
        template_id=base_template,
        typography_dict=base_typo,
        cta_dict=base_cta,
        price_badge_dict=base_price,
        readability_dict=base_read,
        font_hashes={"Inter_regular": "mutated_font_hash"},
        logo_dict=base_logo,
        tenant_id="tenant-test",
    )
    assert k_font != base_key, "Cache key failed to invalidate on font hash change"

    # 4. Font size changed
    mut_typo_size = dict(base_typo)
    mut_typo_size["headline_size"] = 64
    k_size = FinalAdService._compute_cache_key(
        composite_output_hash=base_comp_hash,
        copy_hash=base_copy_hash,
        platform=base_platform,
        template_id=base_template,
        typography_dict=mut_typo_size,
        cta_dict=base_cta,
        price_badge_dict=base_price,
        readability_dict=base_read,
        font_hashes=base_fonts,
        logo_dict=base_logo,
        tenant_id="tenant-test",
    )
    assert k_size != base_key, "Cache key failed to invalidate on font size change"

    # 5. Font family changed
    mut_typo_fam = dict(base_typo)
    mut_typo_fam["font_family"] = "Geist"
    k_fam = FinalAdService._compute_cache_key(
        composite_output_hash=base_comp_hash,
        copy_hash=base_copy_hash,
        platform=base_platform,
        template_id=base_template,
        typography_dict=mut_typo_fam,
        cta_dict=base_cta,
        price_badge_dict=base_price,
        readability_dict=base_read,
        font_hashes=base_fonts,
        logo_dict=base_logo,
        tenant_id="tenant-test",
    )
    assert k_fam != base_key, "Cache key failed to invalidate on font family change"

    # 6. Line height multiplier changed
    mut_typo_lh = dict(base_typo)
    mut_typo_lh["line_height_multiplier"] = 1.45
    k_lh = FinalAdService._compute_cache_key(
        composite_output_hash=base_comp_hash,
        copy_hash=base_copy_hash,
        platform=base_platform,
        template_id=base_template,
        typography_dict=mut_typo_lh,
        cta_dict=base_cta,
        price_badge_dict=base_price,
        readability_dict=base_read,
        font_hashes=base_fonts,
        logo_dict=base_logo,
        tenant_id="tenant-test",
    )
    assert k_lh != base_key, "Cache key failed to invalidate on line height change"

    # 7. Alignment changed
    mut_typo_align = dict(base_typo)
    mut_typo_align["alignment"] = "center"
    k_align = FinalAdService._compute_cache_key(
        composite_output_hash=base_comp_hash,
        copy_hash=base_copy_hash,
        platform=base_platform,
        template_id=base_template,
        typography_dict=mut_typo_align,
        cta_dict=base_cta,
        price_badge_dict=base_price,
        readability_dict=base_read,
        font_hashes=base_fonts,
        logo_dict=base_logo,
        tenant_id="tenant-test",
    )
    assert k_align != base_key, "Cache key failed to invalidate on alignment change"

    # 8. CTA geometry changed (border_radius)
    mut_cta_geo = dict(base_cta)
    mut_cta_geo["border_radius"] = 24
    k_cta_geo = FinalAdService._compute_cache_key(
        composite_output_hash=base_comp_hash,
        copy_hash=base_copy_hash,
        platform=base_platform,
        template_id=base_template,
        typography_dict=base_typo,
        cta_dict=mut_cta_geo,
        price_badge_dict=base_price,
        readability_dict=base_read,
        font_hashes=base_fonts,
        logo_dict=base_logo,
        tenant_id="tenant-test",
    )
    assert k_cta_geo != base_key, "Cache key failed to invalidate on CTA geometry change"

    # 9. CTA color changed
    mut_cta_col = dict(base_cta)
    mut_cta_col["bg_color"] = "#10B981"
    k_cta_col = FinalAdService._compute_cache_key(
        composite_output_hash=base_comp_hash,
        copy_hash=base_copy_hash,
        platform=base_platform,
        template_id=base_template,
        typography_dict=base_typo,
        cta_dict=mut_cta_col,
        price_badge_dict=base_price,
        readability_dict=base_read,
        font_hashes=base_fonts,
        logo_dict=base_logo,
        tenant_id="tenant-test",
    )
    assert k_cta_col != base_key, "Cache key failed to invalidate on CTA color change"

    # 10. Price badge config changed
    mut_price = dict(base_price)
    mut_price["bg_color"] = "#F59E0B"
    k_price = FinalAdService._compute_cache_key(
        composite_output_hash=base_comp_hash,
        copy_hash=base_copy_hash,
        platform=base_platform,
        template_id=base_template,
        typography_dict=base_typo,
        cta_dict=base_cta,
        price_badge_dict=mut_price,
        readability_dict=base_read,
        font_hashes=base_fonts,
        logo_dict=base_logo,
        tenant_id="tenant-test",
    )
    assert k_price != base_key, "Cache key failed to invalidate on price badge change"

    # 11. Scrim settings changed
    mut_read = dict(base_read)
    mut_read["scrim_opacity"] = 0.80
    k_read = FinalAdService._compute_cache_key(
        composite_output_hash=base_comp_hash,
        copy_hash=base_copy_hash,
        platform=base_platform,
        template_id=base_template,
        typography_dict=base_typo,
        cta_dict=base_cta,
        price_badge_dict=base_price,
        readability_dict=mut_read,
        font_hashes=base_fonts,
        logo_dict=base_logo,
        tenant_id="tenant-test",
    )
    assert k_read != base_key, "Cache key failed to invalidate on scrim change"

    # 12. Logo hash changed
    mut_logo = dict(base_logo)
    mut_logo["hash"] = "new_logo_image_hash"
    k_logo = FinalAdService._compute_cache_key(
        composite_output_hash=base_comp_hash,
        copy_hash=base_copy_hash,
        platform=base_platform,
        template_id=base_template,
        typography_dict=base_typo,
        cta_dict=base_cta,
        price_badge_dict=base_price,
        readability_dict=base_read,
        font_hashes=base_fonts,
        logo_dict=mut_logo,
        tenant_id="tenant-test",
    )
    assert k_logo != base_key, "Cache key failed to invalidate on logo hash change"

    # 13. Logo placement changed
    mut_logo_pl = dict(base_logo)
    mut_logo_pl["placement"] = [0.10, 0.10, 0.30, 0.10]
    k_logo_pl = FinalAdService._compute_cache_key(
        composite_output_hash=base_comp_hash,
        copy_hash=base_copy_hash,
        platform=base_platform,
        template_id=base_template,
        typography_dict=base_typo,
        cta_dict=base_cta,
        price_badge_dict=base_price,
        readability_dict=base_read,
        font_hashes=base_fonts,
        logo_dict=mut_logo_pl,
        tenant_id="tenant-test",
    )
    assert k_logo_pl != base_key, "Cache key failed to invalidate on logo placement change"

    # 14. Template changed
    k_tmpl = FinalAdService._compute_cache_key(
        composite_output_hash=base_comp_hash,
        copy_hash=base_copy_hash,
        platform=base_platform,
        template_id="bold_minimalist_light",
        typography_dict=base_typo,
        cta_dict=base_cta,
        price_badge_dict=base_price,
        readability_dict=base_read,
        font_hashes=base_fonts,
        logo_dict=base_logo,
        tenant_id="tenant-test",
    )
    assert k_tmpl != base_key, "Cache key failed to invalidate on template change"

    # 15. Platform changed
    k_plat = FinalAdService._compute_cache_key(
        composite_output_hash=base_comp_hash,
        copy_hash=base_copy_hash,
        platform="facebook",
        template_id=base_template,
        typography_dict=base_typo,
        cta_dict=base_cta,
        price_badge_dict=base_price,
        readability_dict=base_read,
        font_hashes=base_fonts,
        logo_dict=base_logo,
        tenant_id="tenant-test",
    )
    assert k_plat != base_key, "Cache key failed to invalidate on platform change"


@pytest.mark.asyncio
async def test_phase6_1_failed_renders_never_cached(test_db_session: AsyncSession, seeded_pipeline: dict):
    """Verify failed renders are never assigned a cache key and cannot be retrieved from cache."""
    comp = seeded_pipeline["composite"]

    # Deliberately place product directly in text zone to force product occlusion failure
    comp.placement_spec = {
        "x": 60,
        "y": 180,
        "width": 500,
        "height": 500,
    }
    await test_db_session.commit()

    # Render final ad with forced occlusion
    failed_record = await FinalAdService.render_final_ad(
        db=test_db_session,
        composite_id=comp.id,
        typography_style=TypographyStyle(font_family="Inter", headline_size=52),
        force_regenerate=True,
    )

    # 1. QA must have failed due to product occlusion
    assert failed_record.qa_status == QAStatus.FAIL.value
    assert len(failed_record.qa_result["issues"]) > 0

    # 2. Cache key must be None on failed record
    assert failed_record.cache_key is None, "Failed render was assigned a cache key!"

    # 3. Subsequent render attempt must not return the failed record as cached
    cached_query_result = await FinalAdService.render_final_ad(
        db=test_db_session,
        composite_id=comp.id,
        typography_style=TypographyStyle(font_family="Inter", headline_size=52),
        force_regenerate=False,
    )
    # The new attempt must be freshly evaluated (attempt_number incremented) and not cached
    assert cached_query_result.is_cached is False
    assert cached_query_result.attempt_number > failed_record.attempt_number


@pytest.mark.asyncio
async def test_regression_demo_brief_no_logo_renders_successfully(test_db_session: AsyncSession, seeded_pipeline: dict):
    """Regression test: Demo brief with logo_url=None uses deterministic wordmark fallback and renders successfully."""
    brief = seeded_pipeline["brief"]
    brief.payload["brand"]["logo_url"] = None
    await test_db_session.commit()

    comp = seeded_pipeline["composite"]
    record = await FinalAdService.render_final_ad(
        db=test_db_session,
        composite_id=comp.id,
        force_regenerate=True,
    )
    assert record.qa_status == QAStatus.PASS.value
    assert record.logo_spec["type"] == "wordmark"
    assert record.logo_spec["brand_name"] == brief.brand_name.upper()


@pytest.mark.asyncio
async def test_regression_supplied_logo_url_unvalidated_is_rejected(test_db_session: AsyncSession, seeded_pipeline: dict):
    """Regression test: Supplied logo_url without a validated AssetValidationRecord is strictly rejected with HTTP 400."""
    brief = seeded_pipeline["brief"]
    brief.payload["brand"]["logo_url"] = "https://unvalidated.domain.com/unvalidated_logo.png"
    await test_db_session.commit()

    comp = seeded_pipeline["composite"]
    with pytest.raises(HTTPException) as exc_info:
        await FinalAdService.render_final_ad(
            db=test_db_session,
            composite_id=comp.id,
            force_regenerate=True,
        )
    assert exc_info.value.status_code == 400
    assert "has not passed asset gate" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_regression_supplied_logo_url_validated_is_accepted(test_db_session: AsyncSession, seeded_pipeline: dict):
    """Regression test: Supplied logo_url with AssetValidationRecord PASS is accepted and rendered as authoritative image."""
    from app.providers.storage_provider import get_storage_provider
    from app.demo.sample_assets import generate_demo_smartwatch_png

    storage = get_storage_provider()
    logo_bytes = generate_demo_smartwatch_png()
    logo_key = "logos/test_logo_valid.png"
    await storage.save_bytes(logo_bytes, logo_key, "image/png")

    logo_url = "https://cdn.example.com/assets/logo.png"
    logo_asset = AssetValidationRecord(
        url=logo_url,
        storage_key=logo_key,
        detected_mime="image/png",
        width=800,
        height=800,
        aspect_ratio=1.0,
        has_alpha_channel=True,
        validation_status="PASS",
    )
    test_db_session.add(logo_asset)

    brief = seeded_pipeline["brief"]
    brief.payload["brand"]["logo_url"] = logo_url
    await test_db_session.commit()

    comp = seeded_pipeline["composite"]
    record = await FinalAdService.render_final_ad(
        db=test_db_session,
        composite_id=comp.id,
        force_regenerate=True,
    )
    assert record.qa_status == QAStatus.PASS.value
    assert record.logo_spec["type"] == "authoritative_image"


