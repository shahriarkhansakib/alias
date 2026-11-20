import pytest
from unittest.mock import patch, AsyncMock
from pydantic import ValidationError

from app.demo.sample_assets import SMARTFIT_X1_DEMO_BRIEF, generate_demo_smartwatch_png
from app.schemas.brief import (
    BrandInfo,
    ProductAssetInput,
    OfferInfo,
    ProductInfo,
    CopySpecification,
    CampaignInfo,
    FinalAdBriefPayload,
)
from app.templates.registry import (
    SlotBounds,
    AspectRatioSlots,
    CanvasSlotConfig,
    get_template_slots,
    is_template_registered,
    get_template,
)
from app.models.job import CreativeJob, JobStatus
from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.providers.mock_providers import MockLLMStrategyProvider
from app.services.strategy_service import strategy_service
from app.services.asset_gate import asset_gate_service, MAX_FILE_SIZE_BYTES


@pytest.fixture
def sample_brief():
    return FinalAdBriefPayload.model_validate(SMARTFIT_X1_DEMO_BRIEF)


# ==============================================================================
# FIX 6: HARDEN BRIEF SCHEMAS (extra="forbid")
# ==============================================================================

def test_fix6_extra_fields_forbidden_on_all_brief_models():
    # BrandInfo rejects unexpected fields
    with pytest.raises(ValidationError):
        BrandInfo(name="TestBrand", unexpected_field="malicious_payload")

    # ProductAssetInput rejects unexpected fields
    with pytest.raises(ValidationError):
        ProductAssetInput(url="https://example.com/a.png", unexpected_tag=123)

    # OfferInfo rejects unexpected fields
    with pytest.raises(ValidationError):
        OfferInfo(price=99.0, discount_code_secret="xyz")

    # ProductInfo rejects unexpected fields
    with pytest.raises(ValidationError):
        ProductInfo(name="Test", offer=OfferInfo(price=50.0), extra_metadata={})

    # CopySpecification rejects unexpected fields
    with pytest.raises(ValidationError):
        CopySpecification(headline="Valid", extra_notes="injected")

    # CampaignInfo rejects unexpected fields
    with pytest.raises(ValidationError):
        CampaignInfo(platforms=["instagram"], tracker_code="foo")

    # FinalAdBriefPayload rejects unexpected top-level fields
    brief_data = dict(SMARTFIT_X1_DEMO_BRIEF)
    brief_data["hacked_injection"] = "DROP TABLE users;"
    with pytest.raises(ValidationError) as exc:
        FinalAdBriefPayload.model_validate(brief_data)
    assert "extra fields not permitted" in str(exc.value).lower() or "extra_forbidden" in str(exc.value).lower()


# ==============================================================================
# FIX 2: TEMPLATE CANVAS SLOTS
# ==============================================================================

def test_fix2_canvas_slot_config_valid_and_retrievable():
    slots_1_1 = get_template_slots("product_sale_dark", "1:1")
    assert slots_1_1 is not None
    assert 0.0 <= slots_1_1.product_slot.x <= 1.0
    assert 0.0 <= slots_1_1.product_slot.y <= 1.0
    assert slots_1_1.product_slot.width > 0.0
    assert slots_1_1.product_slot.height > 0.0
    assert slots_1_1.product_slot.x + slots_1_1.product_slot.width <= 1.0001
    assert slots_1_1.product_slot.y + slots_1_1.product_slot.height <= 1.0001

    # Verify 9:16 and 16:9 exist for all registered templates
    for tid in ("product_sale_dark", "product_launch", "minimal_feature"):
        assert is_template_registered(tid)
        for ratio in ("1:1", "9:16", "16:9"):
            slots = get_template_slots(tid, ratio)
            assert slots is not None, f"Missing {ratio} for template {tid}"
            assert slots.product_slot is not None
            assert slots.text_safe_slot is not None
            assert slots.cta_safe_slot is not None


def test_fix2_slot_bounds_negative_coordinates_rejected():
    with pytest.raises(ValidationError):
        SlotBounds(x=-0.05, y=0.1, width=0.5, height=0.5)

    with pytest.raises(ValidationError):
        SlotBounds(x=0.1, y=-0.1, width=0.5, height=0.5)


def test_fix2_slot_bounds_greater_than_one_rejected():
    with pytest.raises(ValidationError):
        SlotBounds(x=1.2, y=0.1, width=0.5, height=0.5)

    with pytest.raises(ValidationError):
        SlotBounds(x=0.1, y=1.5, width=0.5, height=0.5)


def test_fix2_slot_bounds_zero_or_negative_dimensions_rejected():
    with pytest.raises(ValidationError):
        SlotBounds(x=0.1, y=0.1, width=0.0, height=0.5)

    with pytest.raises(ValidationError):
        SlotBounds(x=0.1, y=0.1, width=0.5, height=-0.2)


def test_fix2_slot_bounds_exceeding_canvas_rejected():
    # x + width = 0.8 + 0.4 = 1.2 > 1.0
    with pytest.raises(ValidationError) as exc:
        SlotBounds(x=0.8, y=0.1, width=0.4, height=0.5)
    assert "outside canvas horizontally" in str(exc.value)

    # y + height = 0.3 + 0.8 = 1.1 > 1.0
    with pytest.raises(ValidationError) as exc:
        SlotBounds(x=0.1, y=0.3, width=0.4, height=0.8)
    assert "outside canvas vertically" in str(exc.value)


def test_fix2_canvas_slot_missing_required_ratio_rejected():
    # Only providing 1:1, missing 9:16 and 16:9
    with pytest.raises(ValidationError) as exc:
        CanvasSlotConfig(
            slots={
                "1:1": AspectRatioSlots(
                    product_slot=SlotBounds(x=0.5, y=0.1, width=0.4, height=0.8),
                    text_safe_slot=SlotBounds(x=0.1, y=0.1, width=0.4, height=0.5),
                    cta_safe_slot=SlotBounds(x=0.1, y=0.7, width=0.3, height=0.1),
                )
            }
        )
    assert "required aspect ratios" in str(exc.value)


# ==============================================================================
# FIX 3: CREATIVE JOB STATE MACHINE
# ==============================================================================

def test_fix3_creative_job_valid_state_transitions():
    job = CreativeJob(status=JobStatus.RECEIVED.value)
    assert job.status == "RECEIVED"

    # RECEIVED -> VALIDATING
    job.transition_to(JobStatus.VALIDATING, stage_name="Validating Brief", progress_pct=10)
    assert job.status == "VALIDATING"
    assert job.progress_pct == 10

    # VALIDATING -> ASSET_CHECK
    job.transition_to(JobStatus.ASSET_CHECK, stage_name="Checking Assets", progress_pct=25)
    assert job.status == "ASSET_CHECK"

    # ASSET_CHECK -> STRATEGY_GENERATING
    job.transition_to(JobStatus.STRATEGY_GENERATING, stage_name="Generating Strategy", progress_pct=30)
    assert job.status == "STRATEGY_GENERATING"

    # STRATEGY_GENERATING -> STRATEGY_GENERATED
    job.transition_to(JobStatus.STRATEGY_GENERATED, stage_name="Strategy Generated", progress_pct=35)
    assert job.status == "STRATEGY_GENERATED"

    # STRATEGY_GENERATED -> STRATEGY_VALIDATED
    job.transition_to(JobStatus.STRATEGY_VALIDATED, stage_name="Strategy Approved", progress_pct=40)
    assert job.status == "STRATEGY_VALIDATED"


def test_fix3_creative_job_invalid_transitions_rejected():
    job = CreativeJob(status=JobStatus.RECEIVED.value)

    # Cannot jump from RECEIVED directly to STRATEGY_VALIDATED
    with pytest.raises(ValueError) as exc:
        job.transition_to(JobStatus.STRATEGY_VALIDATED)
    assert "Invalid state transition" in str(exc.value)

    # Cannot jump from STRATEGY_VALIDATED directly to COMPLETED (bypassing rendering/QA)
    valid_job = CreativeJob(status=JobStatus.STRATEGY_VALIDATED.value)
    with pytest.raises(ValueError) as exc:
        valid_job.transition_to(JobStatus.COMPLETED)
    assert "Invalid state transition" in str(exc.value)


# ==============================================================================
# FIX 4: STRATEGY RETRY DIAGNOSTICS FEEDBACK
# ==============================================================================

@pytest.mark.asyncio
async def test_fix4_retry_diagnostics_feedback_propagation(sample_brief):
    mock_provider = MockLLMStrategyProvider()
    received_feedbacks = []

    async def dynamic_generate(brief, attempt: int = 1, feedback: str = None):
        received_feedbacks.append({"attempt": attempt, "feedback": feedback})
        strat = await MockLLMStrategyProvider().generate_creative_strategy(brief, attempt=attempt, feedback=feedback)
        if attempt == 1:
            # Hallucinate a price on attempt 1
            strat.copy_spec.offer_mention = "Only $100!"
        elif attempt == 2:
            # Hallucinate an unknown template on attempt 2
            strat.template_id = "unknown_pirate_theme"
        elif attempt == 3:
            # Clean valid spec on attempt 3
            pass
        return strat

    mock_provider.generate_creative_strategy = dynamic_generate

    status, spec, report, retries = await strategy_service.generate_and_validate_strategy(
        brief=sample_brief,
        provider=mock_provider,
        max_retries=3,
    )

    assert status == "APPROVED"
    assert retries == 3
    assert len(received_feedbacks) == 3

    # Attempt 1 must have NO feedback
    assert received_feedbacks[0]["attempt"] == 1
    assert received_feedbacks[0]["feedback"] is None

    # Attempt 2 must have Attempt 1's price rejection diagnostics
    assert received_feedbacks[1]["attempt"] == 2
    assert received_feedbacks[1]["feedback"] is not None
    assert "Claim Gate rejection" in received_feedbacks[1]["feedback"]
    assert "price" in received_feedbacks[1]["feedback"].lower()

    # Attempt 3 must have Attempt 2's template rejection diagnostics
    assert received_feedbacks[2]["attempt"] == 3
    assert received_feedbacks[2]["feedback"] is not None
    assert "template error" in received_feedbacks[2]["feedback"]
    assert "unknown_pirate_theme" in received_feedbacks[2]["feedback"]


@pytest.mark.asyncio
async def test_fix4_retry_exhaustion_single_strategy_persisted(sample_brief):
    mock_provider = MockLLMStrategyProvider()

    # Always produces an unsupported claim
    async def always_bad(brief, attempt: int = 1, feedback: str = None):
        strat = await MockLLMStrategyProvider().generate_creative_strategy(brief, attempt=attempt, feedback=feedback)
        strat.copy_spec.headline = "100% NASA Space Certified"
        return strat

    mock_provider.generate_creative_strategy = always_bad

    status, spec, report, retries = await strategy_service.generate_and_validate_strategy(
        brief=sample_brief,
        provider=mock_provider,
        max_retries=3,
    )
    assert status == "REJECTED"
    assert retries == 3
    assert report.passed is False


# ==============================================================================
# FIX 5: SECURE STREAMING ASSET DOWNLOAD
# ==============================================================================

@pytest.mark.asyncio
async def test_fix5_streaming_download_immediate_abort_on_oversized_stream():
    # Simulate a remote server sending infinite chunks without Content-Length
    class MockStreamResponse:
        status_code = 200
        is_redirect = False
        headers = {"content-type": "image/png"}  # No content-length

        async def aiter_bytes(self, chunk_size=65536):
            # Send 300 chunks of 64KB = 19.2 MB (exceeds 15MB limit)
            for _ in range(300):
                yield b"X" * chunk_size

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

    class MockAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

        def stream(self, method, url, **kwargs):
            return MockStreamResponse()

    with patch("httpx.AsyncClient", MockAsyncClient), patch(
        "app.services.asset_gate.validate_url_safety",
        return_value=(True, None, None),
    ):
        result, err = await asset_gate_service._secure_download("https://example.com/oversized.png")
        assert result is None
        assert err is not None
        assert "exceeds maximum permitted limit" in err


# ==============================================================================
# FIX 1: STRATEGY SECURITY GATE INTEGRATION TESTS
# ==============================================================================

@pytest.mark.asyncio
async def test_fix1_strategy_endpoint_rejects_raw_brief_payload(client):
    # Old contract sent raw brief_payload instead of brief_id
    response = await client.post(
        "/api/v1/strategies/generate",
        json={"brief_payload": SMARTFIT_X1_DEMO_BRIEF},
    )
    # Must be rejected because brief_id is required and extra brief_payload is forbidden
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_fix1_strategy_endpoint_rejects_nonexistent_brief_id(client):
    response = await client.post(
        "/api/v1/strategies/generate",
        json={"brief_id": "nonexistent-brief-uuid-1234"},
    )
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_fix1_strategy_endpoint_rejects_unvalidated_brief(client, test_db_session):
    # Persist brief with validation_status == 'FAIL'
    failed_brief = AdBrief(
        brand_name="Test",
        product_name="Broken Product",
        price=10.0,
        currency="USD",
        platforms=["instagram"],
        validation_status="FAIL",
        payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(failed_brief)
    await test_db_session.commit()
    await test_db_session.refresh(failed_brief)

    response = await client.post(
        "/api/v1/strategies/generate",
        json={"brief_id": failed_brief.id},
    )
    assert response.status_code == 400
    assert "has not passed payload validation" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_fix1_strategy_endpoint_rejects_missing_asset_record(client, test_db_session):
    # Persist brief with validation_status == 'PASS' but NO corresponding AssetValidationRecord
    valid_brief = AdBrief(
        brand_name="Test",
        product_name="SmartFit X1",
        price=4999.0,
        currency="USD",
        platforms=["instagram"],
        validation_status="PASS",
        payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(valid_brief)
    await test_db_session.commit()
    await test_db_session.refresh(valid_brief)

    response = await client.post(
        "/api/v1/strategies/generate",
        json={"brief_id": valid_brief.id},
    )
    assert response.status_code == 400
    assert "has not been validated by asset gate" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_fix1_strategy_endpoint_rejects_failed_asset_validation(client, test_db_session):
    # Persist brief with validation_status == 'PASS'
    valid_brief = AdBrief(
        brand_name="Test",
        product_name="SmartFit X1",
        price=4999.0,
        currency="USD",
        platforms=["instagram"],
        validation_status="PASS",
        payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(valid_brief)
    await test_db_session.commit()
    await test_db_session.refresh(valid_brief)

    primary_url = SMARTFIT_X1_DEMO_BRIEF["images"][0]["url"]

    # Persist AssetValidationRecord with validation_status == 'FAIL'
    failed_asset = AssetValidationRecord(
        url=primary_url,
        validation_status="FAIL",
        has_alpha_channel=False,
    )
    test_db_session.add(failed_asset)
    await test_db_session.commit()

    response = await client.post(
        "/api/v1/strategies/generate",
        json={"brief_id": valid_brief.id},
    )
    assert response.status_code == 400
    assert "failed asset gate validation" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_fix1_strategy_endpoint_accepts_valid_persisted_brief_and_records_job(client, test_db_session):
    # 1. Create a fully validated brief via POST /api/v1/briefs
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

    # 2. Call POST /api/v1/strategies/generate with valid brief_id
    gen_res = await client.post(
        "/api/v1/strategies/generate",
        json={"brief_id": brief_id},
    )
    assert gen_res.status_code == 200
    data = gen_res.json()

    assert data["status"] == "APPROVED"
    assert data["strategy_id"] is not None
    assert data["job_id"] is not None
    assert data["claim_report"]["passed"] is True
    assert data["strategy"]["template_id"] in ("product_sale_dark", "product_launch", "minimal_feature")
