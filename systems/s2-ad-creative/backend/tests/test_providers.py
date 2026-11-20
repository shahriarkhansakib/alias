import pytest
from app.providers.mock_providers import (
    MockLLMStrategyProvider,
    MockImageGenProvider,
    MockVisionQAProvider,
)
from app.services.worker_interface import AsyncLocalJobWorker


@pytest.mark.asyncio
async def test_mock_llm_strategy_provider():
    provider = MockLLMStrategyProvider()
    brief_data = {
        "product": {"name": "SmartFit X1", "price": 4999},
        "campaign": {"objective": "sales"},
    }
    strategy = await provider.generate_creative_strategy(brief_data)
    assert strategy.concept is not None
    assert "SmartFit X1" in strategy.concept.name
    assert strategy.visual_direction is not None
    assert strategy.copy_spec is not None
    assert strategy.visual_direction.text_placement == "left"


@pytest.mark.asyncio
async def test_mock_image_gen_provider():
    provider = MockImageGenProvider()
    bg_bytes = await provider.generate_background(
        visual_prompt="clean modern gym atmosphere",
        width=400,
        height=500,
    )
    assert len(bg_bytes) > 0
    # PNG signature check
    assert bg_bytes.startswith(b"\x89PNG\r\n\x1a\n")


@pytest.mark.asyncio
async def test_mock_vision_qa_provider():
    provider = MockVisionQAProvider()
    result = await provider.evaluate_creative(
        image_bytes=b"dummy",
        spec={"template_id": "product_sale_dark"},
    )
    assert result["advisory_passed"] is True
    assert "visual_dominance_score" in result
    assert result["visual_dominance_score"] >= 0.8
    assert "notes" in result


@pytest.mark.asyncio
async def test_async_job_worker():
    worker = AsyncLocalJobWorker()
    job_id = "test-job-123"
    await worker.enqueue_job(job_id, {"test": True})
    assert job_id in worker._tasks
    # Wait for the task to complete
    await worker._tasks[job_id]
    assert worker._tasks[job_id].done()
