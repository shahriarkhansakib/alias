import io
import pytest
from PIL import Image, ImageDraw
from unittest.mock import patch
from fastapi import HTTPException

from app.schemas.platform import TargetPlatform
from app.platforms.registry import build_platform_creative_spec
from app.schemas.strategy import (
    CreativeStrategySpec,
    ConceptSpec,
    VisualDirectionSpec,
    CopySpec,
    CopyPolicyType,
    PlacementDirection,
)
from app.schemas.background import QAStatus, BackgroundQAResult
from app.services.background_qa import BackgroundQAService
from app.services.background_service import BackgroundService
from app.providers.image_provider import MockBackgroundImageProvider
from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.models.strategy import CreativeStrategyRecord
from app.models.job import CreativeJob, JobStatus
from app.demo.sample_assets import SMARTFIT_X1_DEMO_BRIEF


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
            offer_mention="$4,999",
            headline_policy=CopyPolicyType.AI_GENERATED_CREATIVE,
            subheadline_policy=CopyPolicyType.FACTUAL,
            cta_policy=CopyPolicyType.USER_PROVIDED,
        ),
        template_id="product_sale_dark",
    )


# ==============================================================================
# TASK 1: CACHE KEY CORRECTNESS & DETERMINISM REGRESSION TESTS
# ==============================================================================

def test_cache_key_determinism_identical_inputs():
    """Proves same inputs + same generation parameters yield identical cache key."""
    key1 = BackgroundService._compute_cache_key(
        strategy_id="strat-1",
        strategy_version=1,
        platform="instagram",
        template_id="product_sale_dark",
        prompt_version="v1.0",
        provider_name="mock",
        model_name="mock-studio-v1",
        width=1080,
        height=1350,
        generation_params={"seed": 42, "steps": 30, "guidance_scale": 7.5},
        prompt_hash="prompt_hash_123",
        tenant_id="tenant-test",
    )
    key2 = BackgroundService._compute_cache_key(
        strategy_id="strat-1",
        strategy_version=1,
        platform="instagram",
        template_id="product_sale_dark",
        prompt_version="v1.0",
        provider_name="mock",
        model_name="mock-studio-v1",
        width=1080,
        height=1350,
        generation_params={"seed": 42, "steps": 30, "guidance_scale": 7.5},
        prompt_hash="prompt_hash_123",
        tenant_id="tenant-test",
    )
    assert key1 == key2
    assert len(key1) == 64  # SHA-256 hex digest


def test_cache_key_changes_on_generation_param_change():
    """Proves altering any generation parameter produces a completely different cache key."""
    base_kwargs = dict(
        strategy_id="strat-1",
        strategy_version=1,
        platform="instagram",
        template_id="product_sale_dark",
        prompt_version="v1.0",
        provider_name="mock",
        model_name="mock-studio-v1",
        width=1080,
        height=1350,
        prompt_hash="prompt_hash_123",
        tenant_id="tenant-test",
    )

    base_key = BackgroundService._compute_cache_key(
        **base_kwargs,
        generation_params={"seed": 42, "steps": 30, "guidance_scale": 7.5},
    )

    # Changed seed
    key_seed = BackgroundService._compute_cache_key(
        **base_kwargs,
        generation_params={"seed": 99, "steps": 30, "guidance_scale": 7.5},
    )
    assert base_key != key_seed

    # Changed steps
    key_steps = BackgroundService._compute_cache_key(
        **base_kwargs,
        generation_params={"seed": 42, "steps": 50, "guidance_scale": 7.5},
    )
    assert base_key != key_steps

    # Changed guidance scale
    key_cfg = BackgroundService._compute_cache_key(
        **base_kwargs,
        generation_params={"seed": 42, "steps": 30, "guidance_scale": 9.0},
    )
    assert base_key != key_cfg

    # Changed sampler
    key_sampler = BackgroundService._compute_cache_key(
        **base_kwargs,
        generation_params={"seed": 42, "steps": 30, "guidance_scale": 7.5, "sampler": "dpm++_2m"},
    )
    assert base_key != key_sampler


def test_cache_key_dict_key_ordering_invariance():
    """Proves dictionary key insertion order does not affect the computed cache key."""
    dict_a = {"seed": 42, "steps": 30, "guidance_scale": 7.5, "sampler": "euler_a"}
    dict_b = {"sampler": "euler_a", "guidance_scale": 7.5, "seed": 42, "steps": 30}

    key_a = BackgroundService._compute_cache_key(
        strategy_id="strat-1",
        strategy_version=1,
        platform="instagram",
        template_id="product_sale_dark",
        prompt_version="v1.0",
        provider_name="mock",
        model_name="mock-studio-v1",
        width=1080,
        height=1350,
        generation_params=dict_a,
        tenant_id="tenant-test",
    )
    key_b = BackgroundService._compute_cache_key(
        strategy_id="strat-1",
        strategy_version=1,
        platform="instagram",
        template_id="product_sale_dark",
        prompt_version="v1.0",
        provider_name="mock",
        model_name="mock-studio-v1",
        width=1080,
        height=1350,
        generation_params=dict_b,
        tenant_id="tenant-test",
    )
    assert key_a == key_b


def test_cache_key_ignores_irrelevant_metadata():
    """Proves non-generation metadata (e.g. request_id, timestamp) does not invalidate cache."""
    params_clean = {"seed": 42, "steps": 30}
    params_with_meta1 = {"seed": 42, "steps": 30, "request_id": "req-001", "timestamp": "2026-09-26T10:00:00"}
    params_with_meta2 = {"seed": 42, "steps": 30, "request_id": "req-999", "timestamp": "2026-09-26T12:00:00"}

    key_clean = BackgroundService._compute_cache_key(
        strategy_id="strat-1",
        strategy_version=1,
        platform="instagram",
        template_id="product_sale_dark",
        prompt_version="v1.0",
        provider_name="mock",
        model_name="mock-studio-v1",
        width=1080,
        height=1350,
        generation_params=params_clean,
        tenant_id="tenant-test",
    )
    key_meta1 = BackgroundService._compute_cache_key(
        strategy_id="strat-1",
        strategy_version=1,
        platform="instagram",
        template_id="product_sale_dark",
        prompt_version="v1.0",
        provider_name="mock",
        model_name="mock-studio-v1",
        width=1080,
        height=1350,
        generation_params=params_with_meta1,
        tenant_id="tenant-test",
    )
    key_meta2 = BackgroundService._compute_cache_key(
        strategy_id="strat-1",
        strategy_version=1,
        platform="instagram",
        template_id="product_sale_dark",
        prompt_version="v1.0",
        provider_name="mock",
        model_name="mock-studio-v1",
        width=1080,
        height=1350,
        generation_params=params_with_meta2,
        tenant_id="tenant-test",
    )

    assert key_clean == key_meta1
    assert key_clean == key_meta2


# ==============================================================================
# TASK 2: PASS / WARNING / FAIL SEMANTICS REGRESSION TESTS
# ==============================================================================

@pytest.mark.asyncio
async def test_clean_pass_semantics(test_db_session, sample_strategy_spec):
    """Proves clean PASS transitions job to Background Approved with high score and empty warnings."""
    brief = AdBrief(
        brand_name="Brand", product_name="P", price=10.0, currency="USD",
        platforms=["instagram"], validation_status="PASS", payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief)
    await test_db_session.flush()

    strategy_record = CreativeStrategyRecord(
        brief_id=brief.id, version_number=1, status="APPROVED", template_id="product_sale_dark",
        strategy_spec=sample_strategy_spec.model_dump(),
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strategy_record)
    await test_db_session.flush()

    job = CreativeJob(
        brief_id=brief.id, strategy_id=strategy_record.id,
        status=JobStatus.STRATEGY_VALIDATED.value, current_stage="Strategy Approved",
    )
    test_db_session.add(job)
    await test_db_session.commit()

    record = await BackgroundService.generate_background(
        db=test_db_session, strategy_id=strategy_record.id,
        platform=TargetPlatform.INSTAGRAM,
        provider=MockBackgroundImageProvider(),
    )

    assert record.qa_status == "PASS"
    assert record.qa_result["status"] == "PASS"
    assert record.qa_result["overall_score"] >= 0.88
    assert len(record.qa_result["warnings"]) == 0
    assert record.cache_key is not None
    assert job.status == JobStatus.BACKGROUND_APPROVED.value
    assert job.current_stage == "Background Approved"


@pytest.mark.asyncio
async def test_warning_semantics_preserved_and_visible(test_db_session, sample_strategy_spec):
    """Proves WARNING is preserved, exposed in record/job, and distinct from clean PASS."""
    brief = AdBrief(
        brand_name="Brand", product_name="P", price=10.0, currency="USD",
        platforms=["instagram"], validation_status="PASS", payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief)
    await test_db_session.flush()

    strategy_record = CreativeStrategyRecord(
        brief_id=brief.id, version_number=1, status="APPROVED", template_id="product_sale_dark",
        strategy_spec=sample_strategy_spec.model_dump(),
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strategy_record)
    await test_db_session.flush()

    job = CreativeJob(
        brief_id=brief.id, strategy_id=strategy_record.id,
        status=JobStatus.STRATEGY_VALIDATED.value, current_stage="Strategy Approved",
    )
    test_db_session.add(job)
    await test_db_session.commit()

    # Provider that generates a background with moderate texture in the text safe area, triggering WARNING
    class WarningProvider(MockBackgroundImageProvider):
        async def generate_background(self, prompt, generation_params=None):
            # Clean dark background but with moderate texture
            img = Image.new("RGB", (prompt.width, prompt.height), color=(14, 18, 28))
            draw = ImageDraw.Draw(img)
            # Draw subtle texture in text-safe region to trigger 15 < edge_density <= 35
            for y in range(int(prompt.height * 0.2), int(prompt.height * 0.5), 18):
                draw.line([(int(prompt.width * 0.08), y), (int(prompt.width * 0.40), y)], fill=(60, 75, 95), width=1)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return buf.getvalue()

    record = await BackgroundService.generate_background(
        db=test_db_session, strategy_id=strategy_record.id,
        platform=TargetPlatform.INSTAGRAM,
        provider=WarningProvider(),
    )

    assert record.qa_status == "WARNING"
    assert record.qa_result["status"] == "WARNING"
    assert len(record.qa_result["warnings"]) > 0
    assert record.qa_result["overall_score"] <= 0.84
    # Ensure WARNING is not converted into clean PASS
    assert record.qa_status != "PASS"
    # Ensure WARNING has preserved diagnostics in job stage_data
    assert job.status == JobStatus.BACKGROUND_APPROVED.value
    assert "Warnings" in job.current_stage
    assert job.stage_data.get("qa_status") == "WARNING"
    assert len(job.stage_data.get("warnings", [])) > 0


# ==============================================================================
# TASK 3: DETERMINISTIC ADVERSARIAL QA TEST COVERAGE
# ==============================================================================

def test_adversarial_incorrect_dimensions(sample_strategy_spec):
    """Adversarial check: Wrong width and height must fail dimension check."""
    spec = build_platform_creative_spec(TargetPlatform.INSTAGRAM, sample_strategy_spec)
    # Expected: 1080 x 1350
    bad_img = Image.new("RGB", (800, 600), color=(20, 20, 20))
    buf = io.BytesIO()
    bad_img.save(buf, format="PNG")

    qa = BackgroundQAService.evaluate(buf.getvalue(), spec)
    assert qa.status == QAStatus.FAIL
    assert qa.dimension_check.passed is False
    assert "Dimension mismatch" in qa.dimension_check.details
    assert "1080x1350" in qa.retry_guidance


def test_adversarial_corrupt_decompression_failure(sample_strategy_spec):
    """Adversarial check: Corrupt/truncated byte stream must fail gracefully with zero score."""
    spec = build_platform_creative_spec(TargetPlatform.INSTAGRAM, sample_strategy_spec)
    corrupt_bytes = b"NOT_A_VALID_IMAGE_PNG_CORRUPTED_STREAM_12345"

    qa = BackgroundQAService.evaluate(corrupt_bytes, spec)
    assert qa.status == QAStatus.FAIL
    assert qa.overall_score == 0.0
    assert qa.dimension_check.passed is False
    assert "Corrupted or invalid" in qa.dimension_check.details
    assert qa.retry_guidance is not None


def test_adversarial_text_like_artifacts(sample_strategy_spec):
    """Adversarial check: Obvious rendered letters/text in scene must fail text check."""
    spec = build_platform_creative_spec(TargetPlatform.INSTAGRAM, sample_strategy_spec)
    provider = MockBackgroundImageProvider(simulate_text_artifact=True)

    img = Image.new("RGB", (1080, 1350), color=(14, 18, 28))
    draw = ImageDraw.Draw(img)
    draw.rectangle([100, 350, 450, 420], fill=(255, 255, 255))
    draw.text((120, 370), "BIG SALE 70% OFF", fill=(0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    qa = BackgroundQAService.evaluate(buf.getvalue(), spec)
    assert qa.status == QAStatus.FAIL
    assert qa.text_artifact_check.passed is False
    assert qa.text_artifact_check.severity == QAStatus.FAIL
    assert "text-like artifacts" in qa.text_artifact_check.details.lower()


def test_adversarial_watermark_corner_artifacts(sample_strategy_spec):
    """Adversarial check: Watermark in bottom corner must fail watermark check."""
    spec = build_platform_creative_spec(TargetPlatform.INSTAGRAM, sample_strategy_spec)
    img = Image.new("RGB", (1080, 1350), color=(14, 18, 28))
    draw = ImageDraw.Draw(img)
    # High contrast logo mark in bottom right corner
    draw.rectangle([980, 1260, 1070, 1330], fill=(255, 255, 255))
    draw.text((990, 1280), "WATERMARK", fill=(0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    qa = BackgroundQAService.evaluate(buf.getvalue(), spec)
    assert qa.status == QAStatus.FAIL
    assert qa.watermark_check.passed is False
    assert qa.watermark_check.severity == QAStatus.FAIL
    assert "watermark or logo" in qa.watermark_check.details.lower()


def test_adversarial_extra_objects_in_product_stage(sample_strategy_spec):
    """Adversarial check: Commercial replica/object in product-safe stage must fail extra object check."""
    spec = build_platform_creative_spec(TargetPlatform.INSTAGRAM, sample_strategy_spec)
    img = Image.new("RGB", (1080, 1350), color=(14, 18, 28))
    draw = ImageDraw.Draw(img)
    # Large object drawn on product safe stage (right side ~70% x, 50% y)
    draw.rectangle([600, 450, 950, 850], fill=(220, 80, 50))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    qa = BackgroundQAService.evaluate(buf.getvalue(), spec)
    assert qa.status == QAStatus.FAIL
    assert qa.extra_object_check.passed is False
    assert "product-safe area" in qa.extra_object_check.details.lower()


def test_adversarial_excessive_clutter_negative_space(sample_strategy_spec):
    """Adversarial check: Dense high-frequency grid in text-safe region must fail negative space check."""
    spec = build_platform_creative_spec(TargetPlatform.INSTAGRAM, sample_strategy_spec)
    img = Image.new("RGB", (1080, 1350), color=(14, 18, 28))
    draw = ImageDraw.Draw(img)
    # Dense pattern in text safe area
    for y in range(200, 800, 6):
        for x in range(80, 480, 6):
            draw.rectangle([x, y, x + 3, y + 3], fill=(200, 200, 200))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    qa = BackgroundQAService.evaluate(buf.getvalue(), spec)
    assert qa.status == QAStatus.FAIL
    assert qa.negative_space_check.passed is False
    assert "edge density" in qa.negative_space_check.details.lower()


def test_adversarial_excessive_brightness_glare(sample_strategy_spec):
    """Adversarial check: Blinding brightness (>235 mean) in text zone must fail brightness check."""
    spec = build_platform_creative_spec(TargetPlatform.INSTAGRAM, sample_strategy_spec)
    img = Image.new("RGB", (1080, 1350), color=(14, 18, 28))
    draw = ImageDraw.Draw(img)
    # Bright white blowout in text-safe area
    draw.rectangle([50, 200, 500, 900], fill=(250, 250, 250))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    qa = BackgroundQAService.evaluate(buf.getvalue(), spec)
    assert qa.status == QAStatus.FAIL
    assert qa.brightness_check.passed is False
    assert "brightness/glare" in qa.brightness_check.details.lower()


# ==============================================================================
# TASK 5 & 6: RETRY, COST SAFETY & GATE PRESERVATION REGRESSION TESTS
# ==============================================================================

@pytest.mark.asyncio
async def test_attempt_count_never_exceeds_three(test_db_session, sample_strategy_spec):
    """Proves max_attempts is clamped to 3 even if a caller specifies higher value."""
    brief = AdBrief(
        brand_name="Brand", product_name="P", price=10.0, currency="USD",
        platforms=["instagram"], validation_status="PASS", payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief)
    await test_db_session.flush()

    strategy_record = CreativeStrategyRecord(
        brief_id=brief.id, version_number=1, status="APPROVED", template_id="product_sale_dark",
        strategy_spec=sample_strategy_spec.model_dump(),
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strategy_record)
    await test_db_session.flush()

    job = CreativeJob(
        brief_id=brief.id, strategy_id=strategy_record.id,
        status=JobStatus.STRATEGY_VALIDATED.value, current_stage="Strategy Approved",
    )
    test_db_session.add(job)
    await test_db_session.commit()

    always_bad = MockBackgroundImageProvider(simulate_text_artifact=True)

    record = await BackgroundService.generate_background(
        db=test_db_session, strategy_id=strategy_record.id,
        platform=TargetPlatform.INSTAGRAM,
        provider=always_bad,
        max_attempts=10,  # Intentionally attempt to violate max 3
    )

    # Exactly 3 attempts must be recorded
    assert record.attempt_number == 3
    assert record.qa_status == "FAIL"
    assert record.cache_key is None
    assert job.status == JobStatus.FAILED.value


@pytest.mark.asyncio
async def test_regeneration_preserves_immutable_strategy_and_facts(test_db_session, sample_strategy_spec):
    """Proves targeted regeneration does NOT modify strategy, facts, brief, or create new strategy."""
    brief = AdBrief(
        brand_name="TestBrand", product_name="SmartFit X1", price=4999.0, currency="USD",
        platforms=["instagram"], validation_status="PASS", payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief)
    await test_db_session.flush()

    original_strategy_id = "strat-fixed-uuid"
    strategy_record = CreativeStrategyRecord(
        id=original_strategy_id,
        brief_id=brief.id, version_number=1, status="APPROVED", template_id="product_sale_dark",
        strategy_spec=sample_strategy_spec.model_dump(),
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strategy_record)
    await test_db_session.flush()

    job = CreativeJob(
        brief_id=brief.id, strategy_id=strategy_record.id,
        status=JobStatus.STRATEGY_VALIDATED.value, current_stage="Strategy Approved",
    )
    test_db_session.add(job)
    await test_db_session.commit()

    record1 = await BackgroundService.generate_background(
        db=test_db_session, strategy_id=strategy_record.id,
        platform=TargetPlatform.INSTAGRAM,
        force_regenerate=True,
    )

    # Trigger regeneration
    record2 = await BackgroundService.regenerate_background(
        db=test_db_session, background_id=record1.id,
        custom_feedback="Ensure extra dark negative space",
    )

    # Assert strategy identity and facts remain completely unchanged
    assert record2.strategy_id == original_strategy_id
    assert record2.brief_id == brief.id
    reloaded_strategy = await test_db_session.get(CreativeStrategyRecord, original_strategy_id)
    assert reloaded_strategy.version_number == 1
    assert reloaded_strategy.strategy_spec["copy_spec"]["offer_mention"] == "$4,999"
    assert reloaded_strategy.strategy_spec["copy_spec"]["headline"] == "SmartFit X1 Pro"


@pytest.mark.asyncio
async def test_generation_rejects_unvalidated_brief(test_db_session, sample_strategy_spec):
    """Proves gate enforcement: brief with validation_status != PASS is rejected."""
    brief = AdBrief(
        brand_name="TestBrand", product_name="Product", price=10.0, currency="USD",
        platforms=["instagram"], validation_status="FAIL", payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief)
    await test_db_session.flush()

    strategy_record = CreativeStrategyRecord(
        brief_id=brief.id, version_number=1, status="APPROVED", template_id="product_sale_dark",
        strategy_spec=sample_strategy_spec.model_dump(),
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strategy_record)
    await test_db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await BackgroundService.generate_background(
            db=test_db_session, strategy_id=strategy_record.id,
            platform=TargetPlatform.INSTAGRAM,
        )
    assert exc_info.value.status_code == 400
    assert "Payload validation" in exc_info.value.detail


@pytest.mark.asyncio
async def test_generation_rejects_failed_asset_gate(test_db_session, sample_strategy_spec):
    """Proves gate enforcement: AssetValidationRecord with FAIL status is rejected."""
    primary_url = SMARTFIT_X1_DEMO_BRIEF["images"][0]["url"]
    brief = AdBrief(
        brand_name="TestBrand", product_name="Product", price=10.0, currency="USD",
        platforms=["instagram"], validation_status="PASS", payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief)
    await test_db_session.flush()

    # Asset record marked as failed
    asset_record = AssetValidationRecord(
        url=primary_url,
        validation_status="FAIL",
        validation_report={"passed": False, "errors": ["Asset download exceeded 15MB limit"]},
    )
    test_db_session.add(asset_record)

    strategy_record = CreativeStrategyRecord(
        brief_id=brief.id, version_number=1, status="APPROVED", template_id="product_sale_dark",
        strategy_spec=sample_strategy_spec.model_dump(),
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strategy_record)
    await test_db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await BackgroundService.generate_background(
            db=test_db_session, strategy_id=strategy_record.id,
            platform=TargetPlatform.INSTAGRAM,
        )
    assert exc_info.value.status_code == 400
    assert "Asset Gate validation" in exc_info.value.detail
