import io
import pytest
from unittest.mock import patch
from PIL import Image

from app.schemas.platform import TargetPlatform, PlatformCreativeSpec
from app.platforms.registry import (
    get_platform_definition,
    list_supported_platforms,
    build_platform_creative_spec,
    SUPPORTED_PLATFORMS,
)
from app.schemas.strategy import (
    CreativeStrategySpec,
    ConceptSpec,
    VisualDirectionSpec,
    CopySpec,
    CopyPolicyType,
    PlacementDirection,
)
from app.schemas.background import (
    QAStatus,
    BackgroundQAResult,
    BackgroundGenerationPrompt,
    BackgroundGenerateRequest,
)
from app.services.background_prompt_builder import BackgroundPromptBuilder
from app.services.background_qa import BackgroundQAService
from app.services.background_service import BackgroundService
from app.providers.image_provider import (
    MockBackgroundImageProvider,
    get_background_image_provider,
)
from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.models.strategy import CreativeStrategyRecord
from app.models.job import CreativeJob, JobStatus
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
            offer_mention="$4,999",
            headline_policy=CopyPolicyType.AI_GENERATED_CREATIVE,
            subheadline_policy=CopyPolicyType.FACTUAL,
            cta_policy=CopyPolicyType.USER_PROVIDED,
        ),
        template_id="product_sale_dark",
    )


# ==============================================================================
# 1. PLATFORM SPECIFICATIONS TESTS
# ==============================================================================

def test_platform_definitions_registered():
    platforms = list_supported_platforms()
    assert len(platforms) == 3
    platform_keys = {p.platform for p in platforms}
    assert platform_keys == {
        TargetPlatform.INSTAGRAM,
        TargetPlatform.FACEBOOK,
        TargetPlatform.LINKEDIN,
    }


def test_platform_exact_dimensions():
    # Instagram: 1080 x 1350 (4:5)
    ig = get_platform_definition("instagram")
    assert ig.target_width == 1080
    assert ig.target_height == 1350
    assert ig.aspect_ratio == "4:5"
    assert "strong visual hierarchy" in ig.creative_characteristics
    assert "product-focused composition" in ig.creative_characteristics

    # Facebook: 1080 x 1080 (1:1)
    fb = get_platform_definition("facebook")
    assert fb.target_width == 1080
    assert fb.target_height == 1080
    assert fb.aspect_ratio == "1:1"
    assert "balanced composition" in fb.creative_characteristics

    # LinkedIn: 1200 x 628 (~1.91:1)
    li = get_platform_definition("linkedin")
    assert li.target_width == 1200
    assert li.target_height == 628
    assert li.aspect_ratio == "1.91:1"
    assert "professional visual language" in li.creative_characteristics


def test_platform_rejection_of_invalid_platform():
    with pytest.raises(ValueError) as exc:
        get_platform_definition("tiktok")
    assert "unsupported platform" in str(exc.value).lower()


def test_build_platform_creative_spec_deterministic(sample_strategy_spec):
    spec = build_platform_creative_spec("instagram", sample_strategy_spec)
    assert spec.platform == TargetPlatform.INSTAGRAM
    assert spec.target_width == 1080
    assert spec.target_height == 1350
    assert spec.aspect_ratio == "4:5"

    # Normalized coordinates must be between 0.0 and 1.0
    for slot in (spec.product_safe_region, spec.text_safe_region):
        assert 0.0 <= slot.x <= 1.0
        assert 0.0 <= slot.y <= 1.0
        assert 0.0 < slot.width <= 1.0
        assert 0.0 < slot.height <= 1.0
        assert slot.x + slot.width <= 1.0001
        assert slot.y + slot.height <= 1.0001

    assert "NO text" in spec.background_constraints[0]
    assert "NO products" in spec.background_constraints[1]


# ==============================================================================
# 2. BACKGROUND PROMPT BUILDER TESTS
# ==============================================================================

def test_prompt_builder_includes_visual_style_and_negative_constraints(sample_strategy_spec):
    p_spec = build_platform_creative_spec("instagram", sample_strategy_spec)
    prompt = BackgroundPromptBuilder.build_prompt(sample_strategy_spec, p_spec)

    # Positive prompt must contain environment & mood
    assert "dark minimalist studio" in prompt.positive_prompt
    assert "dramatic blue rim light" in prompt.positive_prompt
    assert "Instagram" in prompt.positive_prompt

    # Safe space instructions
    assert "stage area" in prompt.positive_prompt.lower()
    assert "negative space" in prompt.positive_prompt.lower()

    # Negative prompt must strictly prohibit text, products, logos, and UI
    for prohibited in ("text", "typography", "watermark", "logo", "product", "human"):
        assert prohibited in prompt.negative_prompt.lower()

    # UNTRUSTED DATA BOUNDARY: No copy, prices, or claims in background prompt
    assert "SmartFit" not in prompt.positive_prompt
    assert "$4,999" not in prompt.positive_prompt
    assert "battery life" not in prompt.positive_prompt.lower()
    assert "Shop Now" not in prompt.positive_prompt


def test_prompt_builder_diagnostic_feedback_incorporation(sample_strategy_spec):
    p_spec = build_platform_creative_spec("facebook", sample_strategy_spec)
    retry_feedback = "Remove all typography-like shapes, letters, numbers; Increase visual simplicity in left region"

    prompt = BackgroundPromptBuilder.build_prompt(
        sample_strategy_spec,
        p_spec,
        attempt=2,
        retry_feedback=retry_feedback,
    )

    assert "TARGETED CORRECTION DIRECTIVE" in prompt.positive_prompt
    assert "Remove all typography-like shapes" in prompt.positive_prompt
    assert "letters" in prompt.negative_prompt.lower()
    assert prompt.metadata["attempt"] == 2
    assert prompt.metadata["has_retry_feedback"] is True


# ==============================================================================
# 3. BACKGROUND QA ENGINE TESTS
# ==============================================================================

@pytest.mark.asyncio
async def test_background_qa_pass_on_clean_mock(sample_strategy_spec):
    p_spec = build_platform_creative_spec("instagram", sample_strategy_spec)
    prompt = BackgroundPromptBuilder.build_prompt(sample_strategy_spec, p_spec)

    provider = MockBackgroundImageProvider()
    image_bytes = await provider.generate_background(prompt)

    qa_result = BackgroundQAService.evaluate(image_bytes, p_spec)
    assert qa_result.status == QAStatus.PASS
    assert qa_result.overall_score >= 0.88
    assert len(qa_result.issues) == 0
    assert qa_result.dimension_check.passed is True
    assert qa_result.text_artifact_check.passed is True
    assert qa_result.watermark_check.passed is True
    assert qa_result.extra_object_check.passed is True
    assert qa_result.negative_space_check.passed is True
    assert qa_result.product_safe_zone_check.passed is True
    assert qa_result.brightness_check.passed is True


@pytest.mark.asyncio
async def test_background_qa_fails_on_wrong_dimensions(sample_strategy_spec):
    p_spec = build_platform_creative_spec("instagram", sample_strategy_spec)
    prompt = BackgroundPromptBuilder.build_prompt(sample_strategy_spec, p_spec)

    provider = MockBackgroundImageProvider(simulate_bad_dimensions=True)
    image_bytes = await provider.generate_background(prompt)

    qa = BackgroundQAService.evaluate(image_bytes, p_spec)
    assert qa.status == QAStatus.FAIL
    assert qa.dimension_check.passed is False
    assert any("dimension" in issue.lower() for issue in qa.issues)


def test_background_qa_fails_on_corrupted_image(sample_strategy_spec):
    p_spec = build_platform_creative_spec("instagram", sample_strategy_spec)
    corrupted_bytes = b"NOT_A_VALID_IMAGE_DATA_STREAM"

    qa = BackgroundQAService.evaluate(corrupted_bytes, p_spec)
    assert qa.status == QAStatus.FAIL
    assert qa.dimension_check.passed is False
    assert "corrupted" in qa.dimension_check.details.lower() or "invalid" in qa.dimension_check.details.lower()


@pytest.mark.asyncio
async def test_background_qa_fails_on_text_artifacts(sample_strategy_spec):
    p_spec = build_platform_creative_spec("instagram", sample_strategy_spec)
    prompt = BackgroundPromptBuilder.build_prompt(sample_strategy_spec, p_spec)

    provider = MockBackgroundImageProvider(simulate_text_artifact=True)
    image_bytes = await provider.generate_background(prompt)

    qa = BackgroundQAService.evaluate(image_bytes, p_spec)
    assert qa.status == QAStatus.FAIL
    assert qa.text_artifact_check.passed is False
    assert any("text artifact" in issue.lower() for issue in qa.issues)
    assert "typography-like shapes" in qa.retry_guidance


@pytest.mark.asyncio
async def test_background_qa_fails_on_watermark(sample_strategy_spec):
    p_spec = build_platform_creative_spec("instagram", sample_strategy_spec)
    prompt = BackgroundPromptBuilder.build_prompt(sample_strategy_spec, p_spec)

    provider = MockBackgroundImageProvider(simulate_watermark=True)
    image_bytes = await provider.generate_background(prompt)

    qa = BackgroundQAService.evaluate(image_bytes, p_spec)
    assert qa.status == QAStatus.FAIL
    assert qa.watermark_check.passed is False
    assert any("watermark" in issue.lower() for issue in qa.issues)
    assert "watermark" in qa.retry_guidance.lower()


@pytest.mark.asyncio
async def test_background_qa_fails_on_excessive_clutter_in_text_zone(sample_strategy_spec):
    p_spec = build_platform_creative_spec("instagram", sample_strategy_spec)
    prompt = BackgroundPromptBuilder.build_prompt(sample_strategy_spec, p_spec)

    provider = MockBackgroundImageProvider(simulate_text_clutter=True)
    image_bytes = await provider.generate_background(prompt)

    qa = BackgroundQAService.evaluate(image_bytes, p_spec)
    assert qa.status == QAStatus.FAIL
    assert qa.negative_space_check.passed is False
    assert any("negative space" in issue.lower() for issue in qa.issues)
    assert "visual simplicity" in qa.retry_guidance.lower()


@pytest.mark.asyncio
async def test_background_qa_fails_on_product_obstruction(sample_strategy_spec):
    p_spec = build_platform_creative_spec("instagram", sample_strategy_spec)
    prompt = BackgroundPromptBuilder.build_prompt(sample_strategy_spec, p_spec)

    provider = MockBackgroundImageProvider(simulate_product_obstruction=True)
    image_bytes = await provider.generate_background(prompt)

    qa = BackgroundQAService.evaluate(image_bytes, p_spec)
    assert qa.status == QAStatus.FAIL
    assert qa.extra_object_check.passed is False
    assert any("extra object" in issue.lower() for issue in qa.issues)
    assert "product-safe area" in qa.retry_guidance.lower()


# ==============================================================================
# 4. TARGETED REGENERATION & RETRY LOOP TESTS
# ==============================================================================

@pytest.mark.asyncio
async def test_targeted_regeneration_recovers_on_retry(test_db_session, sample_strategy_spec):
    # Setup persisted brief, job, and approved strategy
    brief = AdBrief(
        brand_name="TestBrand",
        product_name="SmartFit X1",
        price=4999.0,
        currency="USD",
        platforms=["instagram"],
        validation_status="PASS",
        payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief)
    await test_db_session.flush()

    strategy_record = CreativeStrategyRecord(
        brief_id=brief.id,
        version_number=1,
        status="APPROVED",
        template_id="product_sale_dark",
        strategy_spec=sample_strategy_spec.model_dump(),
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strategy_record)
    await test_db_session.flush()

    job = CreativeJob(
        brief_id=brief.id,
        strategy_id=strategy_record.id,
        status=JobStatus.STRATEGY_VALIDATED.value,
        current_stage="Strategy Approved",
    )
    test_db_session.add(job)
    await test_db_session.commit()

    # Provider that fails on attempt 1 with text clutter, then passes on attempt 2
    class FlakyProvider(MockBackgroundImageProvider):
        def __init__(self):
            super().__init__()
            self.call_count = 0

        async def generate_background(self, prompt, generation_params=None):
            self.call_count += 1
            if self.call_count == 1:
                return await MockBackgroundImageProvider(simulate_text_clutter=True).generate_background(prompt)
            return await MockBackgroundImageProvider().generate_background(prompt)

    flaky_provider = FlakyProvider()
    record = await BackgroundService.generate_background(
        db=test_db_session,
        strategy_id=strategy_record.id,
        platform=TargetPlatform.INSTAGRAM,
        provider=flaky_provider,
        max_attempts=3,
    )

    assert flaky_provider.call_count == 2
    assert record.attempt_number == 2
    assert record.qa_status in ("PASS", "WARNING")
    assert job.status == JobStatus.BACKGROUND_APPROVED.value
    # Strategy was NOT changed
    assert record.strategy_id == strategy_record.id


@pytest.mark.asyncio
async def test_retry_exhaustion_marks_job_failed(test_db_session, sample_strategy_spec):
    # Setup persisted brief, job, and approved strategy
    brief = AdBrief(
        brand_name="TestBrand",
        product_name="SmartFit X1",
        price=4999.0,
        currency="USD",
        platforms=["instagram"],
        validation_status="PASS",
        payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief)
    await test_db_session.flush()

    strategy_record = CreativeStrategyRecord(
        brief_id=brief.id,
        version_number=1,
        status="APPROVED",
        template_id="product_sale_dark",
        strategy_spec=sample_strategy_spec.model_dump(),
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strategy_record)
    await test_db_session.flush()

    job = CreativeJob(
        brief_id=brief.id,
        strategy_id=strategy_record.id,
        status=JobStatus.STRATEGY_VALIDATED.value,
        current_stage="Strategy Approved",
    )
    test_db_session.add(job)
    await test_db_session.commit()

    # Provider that always fails with text artifact
    always_bad_provider = MockBackgroundImageProvider(simulate_text_artifact=True)

    record = await BackgroundService.generate_background(
        db=test_db_session,
        strategy_id=strategy_record.id,
        platform=TargetPlatform.INSTAGRAM,
        provider=always_bad_provider,
        max_attempts=3,
    )

    assert record.attempt_number == 3
    assert record.qa_status == "FAIL"
    assert job.status == JobStatus.FAILED.value
    # Failed background must NOT have a cache key
    assert record.cache_key is None


# ==============================================================================
# 5. CACHING BEHAVIOR TESTS
# ==============================================================================

@pytest.mark.asyncio
async def test_background_caching_returns_cached_record_on_identical_request(test_db_session, sample_strategy_spec):
    brief = AdBrief(
        brand_name="TestBrand",
        product_name="SmartFit X1",
        price=4999.0,
        currency="USD",
        platforms=["instagram"],
        validation_status="PASS",
        payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief)
    await test_db_session.flush()

    strategy_record = CreativeStrategyRecord(
        brief_id=brief.id,
        version_number=1,
        status="APPROVED",
        template_id="product_sale_dark",
        strategy_spec=sample_strategy_spec.model_dump(),
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strategy_record)
    await test_db_session.flush()

    job = CreativeJob(
        brief_id=brief.id,
        strategy_id=strategy_record.id,
        status=JobStatus.STRATEGY_VALIDATED.value,
        current_stage="Strategy Approved",
    )
    test_db_session.add(job)
    await test_db_session.commit()

    # 1. First generation (cache miss)
    record1 = await BackgroundService.generate_background(
        db=test_db_session,
        strategy_id=strategy_record.id,
        platform=TargetPlatform.INSTAGRAM,
        force_regenerate=False,
    )
    assert record1.is_cached is False
    assert record1.qa_status == "PASS"

    # 2. Second generation (cache hit)
    record2 = await BackgroundService.generate_background(
        db=test_db_session,
        strategy_id=strategy_record.id,
        platform=TargetPlatform.INSTAGRAM,
        force_regenerate=False,
    )
    assert record2.is_cached is True
    assert record2.id == record1.id

    # 3. Third generation with force_regenerate=True (bypasses cache)
    record3 = await BackgroundService.generate_background(
        db=test_db_session,
        strategy_id=strategy_record.id,
        platform=TargetPlatform.INSTAGRAM,
        force_regenerate=True,
    )
    assert record3.is_cached is False
    assert record3.id != record1.id


# ==============================================================================
# 6. API ENDPOINT & SECURITY GATE INTEGRATION TESTS
# ==============================================================================

@pytest.mark.asyncio
async def test_api_rejects_missing_strategy(client):
    res = await client.post(
        "/api/v1/backgrounds/generate",
        json={"strategy_id": "nonexistent-id", "platform": "instagram"},
    )
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_api_rejects_unapproved_strategy(client, test_db_session, sample_strategy_spec):
    brief = AdBrief(
        brand_name="Test",
        product_name="Product",
        price=10.0,
        currency="USD",
        platforms=["instagram"],
        validation_status="PASS",
        payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief)
    await test_db_session.flush()

    strategy_record = CreativeStrategyRecord(
        brief_id=brief.id,
        version_number=1,
        status="REJECTED",  # NOT APPROVED
        template_id="product_sale_dark",
        strategy_spec=sample_strategy_spec.model_dump(),
        claim_validation_report={"passed": False, "unsupported_claims": ["claim"], "summary": "FAIL"},
    )
    test_db_session.add(strategy_record)
    await test_db_session.commit()

    res = await client.post(
        "/api/v1/backgrounds/generate",
        json={"strategy_id": strategy_record.id, "platform": "instagram"},
    )
    assert res.status_code == 400
    assert "only 'approved' strategies can proceed" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_api_full_flow_approved_strategy_to_background_pass(client, test_db_session, sample_strategy_spec):
    # 1. Create a validated brief via POST /api/v1/briefs
    valid_bytes = generate_demo_smartwatch_png()
    primary_url = SMARTFIT_X1_DEMO_BRIEF["images"][0]["url"]

    with patch(
        "app.services.asset_gate.asset_gate_service._secure_download",
        return_value=((valid_bytes, primary_url, "image/png"), None),
    ), patch("app.services.asset_gate.validate_url_safety", return_value=(True, None, None)):
        create_res = await client.post(
            "/api/v1/briefs",
            json=SMARTFIT_X1_DEMO_BRIEF,
            params={"validate_asset_now": True},
        )
        assert create_res.status_code == 201
        brief_id = create_res.json()["id"]

    # 2. Generate approved strategy via POST /api/v1/strategies/generate
    strat_res = await client.post(
        "/api/v1/strategies/generate",
        json={"brief_id": brief_id},
    )
    assert strat_res.status_code == 200
    strategy_id = strat_res.json()["strategy_id"]
    job_id = strat_res.json()["job_id"]
    assert strategy_id is not None

    # 3. Generate background via POST /api/v1/backgrounds/generate
    bg_res = await client.post(
        "/api/v1/backgrounds/generate",
        json={"strategy_id": strategy_id, "platform": "instagram"},
    )
    assert bg_res.status_code == 200
    bg_data = bg_res.json()

    assert bg_data["qa_status"] == "PASS"
    assert bg_data["width"] == 1080
    assert bg_data["height"] == 1350
    assert bg_data["aspect_ratio"] == "4:5"
    assert bg_data["image_url"].startswith("/api/v1/storage/")
    assert bg_data["qa_result"]["overall_score"] >= 0.88
    assert bg_data["job_id"] == job_id

    # 4. GET background by ID
    get_res = await client.get(f"/api/v1/backgrounds/{bg_data['id']}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == bg_data["id"]

    # 5. POST regenerate background
    regen_res = await client.post(
        f"/api/v1/backgrounds/{bg_data['id']}/regenerate",
        json={"custom_feedback": "Ensure ultra crisp lighting"},
    )
    assert regen_res.status_code == 200
    assert regen_res.json()["qa_status"] in ("PASS", "WARNING")
