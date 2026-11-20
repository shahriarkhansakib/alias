"""Phase 5: Product Cutout Extraction & Compositing Tests.

Verifies:
1. Gate enforcement (Brief PASS, Asset PASS, Strategy APPROVED, Background APPROVED/WARNING).
2. Cutout extraction & alpha validation (QA scorecard, non-transparency, bounding box).
3. Deterministic product positioning (aspect ratio preservation, safe region clamping).
4. Deterministic alpha compositing & shadow generation.
5. Pixel integrity tracking (source asset hash, cutout hash, output hash).
6. Deterministic caching (canonical serialization, invalidation on parameter change, no caching on failure).
7. Job state machine transitions (BACKGROUND_APPROVED -> PRODUCT_CUTOUT -> PRODUCT_QA -> COMPOSITING -> COMPOSITE_QA -> COMPOSITE_APPROVED).
8. End-to-end compositing pipeline and API endpoints.
"""

import io
import pytest
import pytest_asyncio
from PIL import Image
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.models.strategy import CreativeStrategyRecord
from app.models.background import GeneratedBackgroundRecord
from app.models.composite import CompositedCreativeRecord
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
from app.schemas.composite import (
    ProductPlacementConfig,
    ShadowConfig,
    PlacementAlignment,
)
from app.templates.registry import SlotBounds
from app.platforms.registry import build_platform_creative_spec
from app.providers.cutout_provider import DeterministicCutoutProvider
from app.providers.storage_provider import get_storage_provider
from app.services.cutout_qa import CutoutQAService
from app.services.product_positioner import ProductPositioner
from app.services.compositing_engine import CompositingEngine
from app.services.composite_qa import CompositeQAService
from app.services.composite_service import CompositeService
from app.demo.sample_assets import SMARTFIT_X1_DEMO_BRIEF, generate_demo_smartwatch_png


@pytest.fixture
def sample_strategy_spec() -> CreativeStrategySpec:
    return CreativeStrategySpec(
        concept=ConceptSpec(
            name="Athletic Focus",
            creative_angle="High performance fitness elegance",
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
            subheadline="7-day battery life with biometric fitness monitoring.",
            cta="Shop Now",
            offer_mention="$199",
            headline_policy=CopyPolicyType.AI_GENERATED_CREATIVE,
            subheadline_policy=CopyPolicyType.FACTUAL,
            cta_policy=CopyPolicyType.USER_PROVIDED,
        ),
        template_id="product_sale_dark",
    )


@pytest_asyncio.fixture
async def setup_pipeline(test_db_session: AsyncSession, sample_strategy_spec: CreativeStrategySpec):
    """Sets up a complete Phase 1-4 pipeline: AdBrief (PASS), Asset (PASS), Strategy (APPROVED), Background (PASS)."""
    # 1. Brief (PASS)
    brief = AdBrief(
        brand_name="SmartFit",
        product_name="SmartFit X1",
        price=199.99,
        currency="USD",
        platforms=["instagram"],
        validation_status="PASS",
        payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief)
    await test_db_session.flush()

    # 2. Asset (PASS)
    primary_url = SMARTFIT_X1_DEMO_BRIEF["images"][0]["url"]
    asset = AssetValidationRecord(
        url=primary_url,
        validation_status="PASS",
        width=800,
        height=800,
        has_alpha_channel=True,
        file_size_bytes=10240,
    )
    test_db_session.add(asset)
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

    # 4. Job
    job = CreativeJob(
        brief_id=brief.id,
        strategy_id=strategy.id,
        status=JobStatus.BACKGROUND_APPROVED.value,
        current_stage="Background Approved",
    )
    test_db_session.add(job)
    await test_db_session.flush()

    # 5. Background (PASS)
    bg_img = Image.new("RGB", (1080, 1350), color=(15, 23, 42))
    bg_buf = io.BytesIO()
    bg_img.save(bg_buf, format="PNG")
    bg_bytes = bg_buf.getvalue()

    storage = get_storage_provider()
    bg_storage_key = f"backgrounds/{job.id}/instagram/test_bg.png"
    await storage.save_bytes(bg_bytes, bg_storage_key, content_type="image/png")

    background = GeneratedBackgroundRecord(
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
        storage_key=bg_storage_key,
        qa_status="PASS",
        qa_result={"status": "PASS", "score": 95.0, "checks": []},
        cache_key="mock_bg_cache_key_p5",
        is_cached=False,
    )
    test_db_session.add(background)
    await test_db_session.commit()

    return {
        "job": job,
        "brief": brief,
        "asset": asset,
        "strategy": strategy,
        "background": background,
    }


# ==============================================================================
# 1. Product Asset Gate Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_gate_rejects_missing_background(test_db_session: AsyncSession):
    with pytest.raises(HTTPException) as exc_info:
        await CompositeService.composite_product(
            db=test_db_session,
            background_id="non_existent_bg_id",
        )
    assert exc_info.value.status_code == 404
    assert "not found" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_gate_rejects_failed_background(test_db_session: AsyncSession, setup_pipeline):
    bg = setup_pipeline["background"]
    bg.qa_status = "FAIL"
    test_db_session.add(bg)
    await test_db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await CompositeService.composite_product(
            db=test_db_session,
            background_id=bg.id,
        )
    assert exc_info.value.status_code == 400
    assert "qa status is 'fail'" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_gate_rejects_unapproved_strategy(test_db_session: AsyncSession, setup_pipeline):
    strat = setup_pipeline["strategy"]
    strat.status = "DRAFT"
    test_db_session.add(strat)
    await test_db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await CompositeService.composite_product(
            db=test_db_session,
            background_id=setup_pipeline["background"].id,
        )
    assert exc_info.value.status_code == 400
    assert "only 'approved' strategies can proceed" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_gate_rejects_unvalidated_brief(test_db_session: AsyncSession, setup_pipeline):
    brief = setup_pipeline["brief"]
    brief.validation_status = "FAIL"
    test_db_session.add(brief)
    await test_db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await CompositeService.composite_product(
            db=test_db_session,
            background_id=setup_pipeline["background"].id,
        )
    assert exc_info.value.status_code == 400
    assert "brief has not passed payload validation" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_gate_rejects_unvalidated_asset(test_db_session: AsyncSession, setup_pipeline):
    asset = setup_pipeline["asset"]
    asset.validation_status = "FAIL"
    test_db_session.add(asset)
    await test_db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await CompositeService.composite_product(
            db=test_db_session,
            background_id=setup_pipeline["background"].id,
        )
    assert exc_info.value.status_code == 400
    assert "asset gate validation" in exc_info.value.detail.lower()


# ==============================================================================
# 2. Cutout Extraction & Alpha Validation Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_cutout_provider_preserves_existing_alpha():
    provider = DeterministicCutoutProvider()
    valid_png = generate_demo_smartwatch_png()
    cutout_bytes, meta = await provider.extract_cutout(valid_png)

    assert meta.provider == "deterministic_cutout"
    assert tuple(meta.output_dimensions) == (800, 800)
    assert meta.alpha_coverage > 0.05
    assert meta.bounding_box is not None

    # Validate with CutoutQAService
    qa_result = CutoutQAService.evaluate(cutout_bytes)
    assert qa_result.status in ["PASS", "WARNING"]
    assert qa_result.alpha_coverage > 0.05
    assert qa_result.bounding_box is not None


@pytest.mark.asyncio
async def test_cutout_qa_detects_fully_transparent():
    img = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    bad_bytes = buf.getvalue()

    provider = DeterministicCutoutProvider()
    cutout_bytes, meta = await provider.extract_cutout(bad_bytes)

    qa_result = CutoutQAService.evaluate(cutout_bytes)
    assert qa_result.status == "FAIL"
    assert any("completely transparent" in r.lower() for r in qa_result.issues)


@pytest.mark.asyncio
async def test_cutout_qa_detects_corrupt_bytes():
    provider = DeterministicCutoutProvider(simulate_corrupt=True)
    cutout_bytes, meta = await provider.extract_cutout(b"corrupt")

    qa_result = CutoutQAService.evaluate(cutout_bytes)
    assert qa_result.status == "FAIL"
    assert any("corrupt" in r.lower() or "decod" in r.lower() for r in qa_result.issues)


@pytest.mark.asyncio
async def test_cutout_qa_detects_extreme_cropping():
    # 500x500 image with only 2x2 non-transparent pixels
    img = Image.new("RGBA", (500, 500), (0, 0, 0, 0))
    img.putpixel((250, 250), (255, 0, 0, 255))
    img.putpixel((251, 250), (255, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    provider = DeterministicCutoutProvider()
    cutout_bytes, meta = await provider.extract_cutout(buf.getvalue())

    qa_result = CutoutQAService.evaluate(cutout_bytes)
    assert qa_result.status == "FAIL"
    assert any("tiny" in r.lower() or "coverage" in r.lower() for r in qa_result.issues)


# ==============================================================================
# 3. Product Positioning Tests
# ==============================================================================

def test_positioner_preserves_aspect_ratio_and_safe_bounds():
    # 800x800 square product onto Instagram (1080x1350)
    slot_bounds = SlotBounds(x=0.50, y=0.25, width=0.45, height=0.50)
    config = ProductPlacementConfig(scale=1.0, alignment=PlacementAlignment.CENTER, padding_pct=0.05)

    pos_result = ProductPositioner.calculate_placement(
        canvas_width=1080,
        canvas_height=1350,
        cutout_width=800,
        cutout_height=800,
        safe_region=slot_bounds,
        config=config,
    )

    # Verify scaling is square (aspect ratio 1:1 preserved)
    assert pos_result.width == pos_result.height
    assert pos_result.x >= 0
    assert pos_result.y >= 0
    assert pos_result.x + pos_result.width <= 1080
    assert pos_result.y + pos_result.height <= 1350


def test_positioner_rescaling_with_lanczos():
    img = Image.new("RGBA", (800, 400), (255, 0, 0, 255))
    resized = ProductPositioner.transform_product(img, target_width=400, target_height=200)
    assert resized.size == (400, 200)
    assert resized.mode == "RGBA"


# ==============================================================================
# 4. Compositing & Shadow Tests
# ==============================================================================

def test_compositor_blends_product_and_generates_shadow():
    bg_img = Image.new("RGB", (1080, 1350), color=(30, 41, 59))
    bg_buf = io.BytesIO()
    bg_img.save(bg_buf, format="PNG")
    bg_bytes = bg_buf.getvalue()

    product_img = Image.new("RGBA", (400, 400), color=(255, 100, 50, 255))
    product_buf = io.BytesIO()
    product_img.save(product_buf, format="PNG")
    product_bytes = product_buf.getvalue()

    slot_bounds = SlotBounds(x=0.4, y=0.2, width=0.5, height=0.6)
    pos_res = ProductPositioner.calculate_placement(
        canvas_width=1080,
        canvas_height=1350,
        cutout_width=400,
        cutout_height=400,
        safe_region=slot_bounds,
        config=ProductPlacementConfig(),
    )

    shadow_cfg = ShadowConfig(enabled=True, opacity=0.4, blur_radius=15.0)

    composite_bytes, integrity = CompositingEngine.composite(
        background_bytes=bg_bytes,
        cutout_bytes=product_bytes,
        placement=pos_res,
        shadow_config=shadow_cfg,
        source_asset_id="asset_test_123",
        background_id="bg_test_123",
    )

    comp_img = Image.open(io.BytesIO(composite_bytes))
    assert comp_img.size == (1080, 1350)
    assert integrity.source_asset_id == "asset_test_123"
    assert integrity.source_asset_hash != ""
    assert integrity.cutout_hash != ""
    assert integrity.output_hash != ""

    # Verify shadow did not alter product color directly
    center_x = pos_res.x + pos_res.width // 2
    center_y = pos_res.y + pos_res.height // 2
    pixel = comp_img.getpixel((center_x, center_y))
    assert pixel[0] == 255 and pixel[1] == 100 and pixel[2] == 50


# ==============================================================================
# 5. Composite QA Scorecard Tests
# ==============================================================================

def test_composite_qa_scorecard_passes_valid_composite(sample_strategy_spec):
    bg_img = Image.new("RGB", (1080, 1350), color=(20, 20, 20))
    bg_buf = io.BytesIO()
    bg_img.save(bg_buf, format="PNG")

    product_bytes = generate_demo_smartwatch_png()

    spec = build_platform_creative_spec("instagram", sample_strategy_spec)
    pos_res = ProductPositioner.calculate_placement(
        canvas_width=1080,
        canvas_height=1350,
        cutout_width=800,
        cutout_height=800,
        safe_region=spec.product_safe_region,
        config=ProductPlacementConfig(),
    )

    comp_bytes, _ = CompositingEngine.composite(
        background_bytes=bg_buf.getvalue(),
        cutout_bytes=product_bytes,
        placement=pos_res,
        shadow_config=ShadowConfig(enabled=False),
        source_asset_id="a1",
        background_id="bg1",
    )

    qa_res = CompositeQAService.evaluate(comp_bytes, spec, pos_res)
    assert qa_res.status in (QAStatus.PASS, "PASS")
    assert qa_res.overall_score >= 0.80
    assert qa_res.dimension_check.passed is True
    assert qa_res.boundary_check.passed is True


def test_composite_qa_scorecard_detects_wrong_dimensions(sample_strategy_spec):
    wrong_img = Image.new("RGB", (800, 800), color=(0, 0, 0))
    wrong_buf = io.BytesIO()
    wrong_img.save(wrong_buf, format="PNG")

    spec = build_platform_creative_spec("instagram", sample_strategy_spec)
    pos_res = ProductPositioner.calculate_placement(
        canvas_width=800,
        canvas_height=800,
        cutout_width=200,
        cutout_height=200,
        safe_region=spec.product_safe_region,
        config=ProductPlacementConfig(),
    )
    qa_res = CompositeQAService.evaluate(wrong_buf.getvalue(), spec, pos_res)
    assert qa_res.status == "FAIL"
    assert qa_res.dimension_check.passed is False


# ==============================================================================
# 6. Cache Determinism Tests
# ==============================================================================

def test_composite_cache_key_determinism():
    base_kwargs = dict(
        source_asset_hash="sha256_product_123",
        cutout_hash="sha256_cutout_456",
        background_id="bg_abc",
        platform="instagram",
        template_id="bold_commercial",
        placement_dict={"scale": 0.9, "alignment": "center", "padding": 0.05},
        shadow_dict={"enabled": True, "opacity": 0.35, "blur_radius": 18.0},
        tenant_id="tenant-test",
    )

    key1 = CompositeService._compute_cache_key(**base_kwargs)
    key2 = CompositeService._compute_cache_key(**base_kwargs)
    assert key1 == key2

    # Varying placement scale changes key
    p_changed = dict(base_kwargs, placement_dict={"scale": 0.8, "alignment": "center", "padding": 0.05})
    assert CompositeService._compute_cache_key(**p_changed) != key1

    # Varying shadow changes key
    s_changed = dict(base_kwargs, shadow_dict={"enabled": False, "opacity": 0.35, "blur_radius": 18.0})
    assert CompositeService._compute_cache_key(**s_changed) != key1

    # Varying platform changes key
    plat_changed = dict(base_kwargs, platform="facebook")
    assert CompositeService._compute_cache_key(**plat_changed) != key1

    # Dictionary key reordering does not change canonical key
    reordered_placement = {"padding": 0.05, "scale": 0.9, "alignment": "center"}
    reordered = dict(base_kwargs, placement_dict=reordered_placement)
    assert CompositeService._compute_cache_key(**reordered) == key1


# ==============================================================================
# 7. End-to-End Pipeline & Service Caching Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_full_compositing_pipeline(test_db_session: AsyncSession, setup_pipeline):
    """Executes full Phase 5 compositing: retrieve assets, cutout extraction, QA, placement, compositing, storage."""
    bg = setup_pipeline["background"]

    # 1. First execution (cache miss)
    record1 = await CompositeService.composite_product(
        db=test_db_session,
        background_id=bg.id,
        placement_config=ProductPlacementConfig(scale=0.9, alignment=PlacementAlignment.CENTER),
        shadow_config=ShadowConfig(enabled=True, opacity=0.35),
        force_regenerate=False,
    )

    assert record1.id is not None
    assert record1.job_id == setup_pipeline["job"].id
    assert record1.background_id == bg.id
    assert record1.platform == "instagram"
    assert record1.width == 1080
    assert record1.height == 1350
    assert record1.qa_status in ["PASS", "WARNING"]
    assert "composites/" in record1.storage_key
    assert "cutouts/" in record1.cutout_storage_key
    assert record1.integrity_metadata["source_asset_id"] == setup_pipeline["asset"].id
    assert record1.is_cached is False

    # Verify Job Status transition
    await test_db_session.refresh(setup_pipeline["job"])
    assert setup_pipeline["job"].status == JobStatus.COMPOSITE_APPROVED.value

    # 2. Second execution with identical parameters (cache hit)
    record2 = await CompositeService.composite_product(
        db=test_db_session,
        background_id=bg.id,
        placement_config=ProductPlacementConfig(scale=0.9, alignment=PlacementAlignment.CENTER),
        shadow_config=ShadowConfig(enabled=True, opacity=0.35),
        force_regenerate=False,
    )
    assert record2.is_cached is True
    assert record2.id == record1.id

    # 3. Third execution with force_regenerate=True (bypasses cache)
    record3 = await CompositeService.composite_product(
        db=test_db_session,
        background_id=bg.id,
        placement_config=ProductPlacementConfig(scale=0.9, alignment=PlacementAlignment.CENTER),
        shadow_config=ShadowConfig(enabled=True, opacity=0.35),
        force_regenerate=True,
    )
    assert record3.is_cached is False
    assert record3.attempt_number == 2


# ==============================================================================
# 8. API Endpoint Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_api_generate_get_and_regenerate_composite(client: AsyncClient, setup_pipeline):
    """Tests POST /api/v1/composites/generate, GET /api/v1/composites/{id}, and POST /api/v1/composites/{id}/regenerate."""
    bg_id = setup_pipeline["background"].id

    payload = {
        "background_id": bg_id,
        "placement": {
            "scale": 0.85,
            "alignment": "center",
            "padding_pct": 0.05,
        },
        "shadow": {
            "enabled": True,
            "opacity": 0.4,
            "blur_radius": 15.0,
        },
        "force_regenerate": False,
    }

    # 1. Generate composite
    gen_res = await client.post("/api/v1/composites/generate", json=payload)
    assert gen_res.status_code == 200
    data = gen_res.json()
    assert data["background_id"] == bg_id
    assert data["width"] == 1080
    assert data["height"] == 1350
    assert data["qa_status"] in ["PASS", "WARNING"]
    composite_id = data["id"]

    # 2. Get composite by ID
    get_res = await client.get(f"/api/v1/composites/{composite_id}")
    assert get_res.status_code == 200
    get_data = get_res.json()
    assert get_data["id"] == composite_id
    assert get_data["qa_result"]["overall_score"] == data["qa_result"]["overall_score"]

    # 3. Regenerate composite with adjusted parameters
    regen_payload = {
        "placement": {
            "scale": 0.95,
            "alignment": "bottom",
            "padding_pct": 0.02,
        },
        "shadow": {
            "enabled": False,
        },
        "custom_feedback": "Nudge downward for bottom composition",
    }
    regen_res = await client.post(f"/api/v1/composites/{composite_id}/regenerate", json=regen_payload)
    assert regen_res.status_code == 200
    regen_data = regen_res.json()
    assert regen_data["attempt_number"] == 2
    assert regen_data["placement_spec"]["width"] > 0
    assert regen_data["placement_spec"]["height"] > 0
    assert regen_data["shadow_spec"]["enabled"] is False
