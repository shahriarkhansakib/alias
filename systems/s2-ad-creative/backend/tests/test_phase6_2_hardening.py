"""Phase 6.2: Pipeline Integrity & Security Hardening Regression Tests.

Verifies:
1. Storage Path Containment: LocalStorageProvider._resolve_path rejects POSIX, Windows,
   mixed separator, absolute, and encoded path traversal attempts across all operations.
2. Job State Transition Matrix: Formal ALLOWED_TRANSITIONS prohibits illegal shortcuts
   (BACKGROUND_GENERATION -> COMPOSITING, COMPOSITE_APPROVED -> COMPLETED).
3. Elimination of Manual State Overrides: State machine transitions strictly govern all stage progression;
   illegal transitions reject with HTTP 400 without manual status mutation.
4. Cross-Job Isolation & Strict Graph Invariants:
   A. Background belonging to Job A used for Job B -> REJECT
   B. Composite/background relationship mismatch -> REJECT
   C. Background with wrong brief -> REJECT
   D. Background with wrong strategy -> REJECT
   E. Composite with wrong job/brief graph -> REJECT
   F. Final-ad request referencing a resource from another job -> REJECT
"""

import io
import tempfile
from pathlib import Path
import pytest
import pytest_asyncio
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.models.strategy import CreativeStrategyRecord
from app.models.background import GeneratedBackgroundRecord
from app.models.composite import CompositedCreativeRecord
from app.models.final_ad import FinalRenderedCreativeRecord
from app.models.job import CreativeJob, JobStatus, ALLOWED_TRANSITIONS
from app.providers.storage_provider import LocalStorageProvider, get_storage_provider
from app.services.background_service import BackgroundService
from app.services.composite_service import CompositeService
from app.services.final_ad_service import FinalAdService
from app.schemas.platform import TargetPlatform
from app.demo.sample_assets import SMARTFIT_X1_DEMO_BRIEF


# ==============================================================================
# 1. STORAGE PATH CONTAINMENT TESTS
# ==============================================================================

def test_storage_path_traversal_rejection():
    """Harden LocalStorageProvider._resolve_path against all traversal attempts."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = LocalStorageProvider(base_dir=tmp_dir)

        # Test cases for path traversal attacks
        traversal_attempts = [
            # POSIX style
            "../../etc/passwd",
            "../../../secret.txt",
            "/etc/passwd",
            "/root/data.png",
            "dir/../../../passwd",
            # Windows style
            r"..\..\etc\passwd",
            r"..\..\Windows\System32\cmd.exe",
            r"C:\Windows\System32",
            r"D:\data\leak.png",
            r"dir\..\..\..\boot.ini",
            # Mixed separators
            r"dir/..\..\etc/shadow",
            r"foo/../../bar/../../secret",
            # Encoded traversal
            "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
            "%2e%2e%5c%2e%2e%5csecret.txt",
        ]

        for payload in traversal_attempts:
            # 1. Direct resolution
            with pytest.raises(ValueError, match="(outside base directory|Absolute storage paths|escapes storage root)"):
                storage._resolve_path(payload)

            # 2. save_bytes
            with pytest.raises(ValueError):
                import asyncio
                asyncio.run(storage.save_bytes(b"data", payload))

            # 3. get_bytes
            with pytest.raises(ValueError):
                import asyncio
                asyncio.run(storage.get_bytes(payload))

            # 4. get_public_url
            with pytest.raises(ValueError):
                import asyncio
                asyncio.run(storage.get_public_url(payload))

            # 5. exists
            with pytest.raises(ValueError):
                import asyncio
                asyncio.run(storage.exists(payload))

        # Legitimate keys must succeed
        valid_keys = [
            "demo/image.png",
            "backgrounds/job_123/bg.png",
            "composites/nested/subfolder/file.png",
            "final_ad_1.png",
        ]
        for key in valid_keys:
            resolved = storage._resolve_path(key)
            assert resolved.is_relative_to(Path(tmp_dir).resolve())


# ==============================================================================
# 2. JOB STATE TRANSITION MATRIX TESTS
# ==============================================================================

def test_transition_matrix_shortcuts_removed():
    """Verify that state machine formal transitions prohibit invalid shortcuts."""
    # BACKGROUND_GENERATION -> COMPOSITING must be prohibited
    assert JobStatus.COMPOSITING not in ALLOWED_TRANSITIONS[JobStatus.BACKGROUND_GENERATION]
    assert JobStatus.COMPOSITING not in ALLOWED_TRANSITIONS[JobStatus.BACKGROUND_QA]
    assert JobStatus.COMPOSITING not in ALLOWED_TRANSITIONS[JobStatus.BACKGROUND_APPROVED]

    # COMPOSITE_APPROVED -> COMPLETED must be prohibited
    assert JobStatus.COMPLETED not in ALLOWED_TRANSITIONS[JobStatus.COMPOSITE_APPROVED]
    assert JobStatus.COMPLETED not in ALLOWED_TRANSITIONS[JobStatus.BACKGROUND_APPROVED]

    # COMPOSITING -> FINAL_RENDERING must be prohibited (must go through COMPOSITE_QA)
    assert JobStatus.FINAL_RENDERING not in ALLOWED_TRANSITIONS[JobStatus.COMPOSITING]

    # Verify that attempting illegal direct transition raises ValueError
    job = CreativeJob(status=JobStatus.BACKGROUND_GENERATION.value)
    with pytest.raises(ValueError, match="Invalid state transition"):
        job.transition_to(JobStatus.COMPOSITING)

    job_comp = CreativeJob(status=JobStatus.COMPOSITE_APPROVED.value)
    with pytest.raises(ValueError, match="Invalid state transition"):
        job_comp.transition_to(JobStatus.COMPLETED)


def test_transition_matrix_full_canonical_pipeline():
    """Verify that canonical linear pipeline transitions succeed smoothly."""
    job = CreativeJob(status=JobStatus.STRATEGY_VALIDATED.value)

    # 1. Background Generation
    job.transition_to(JobStatus.BACKGROUND_GENERATION)
    assert job.status == JobStatus.BACKGROUND_GENERATION.value

    # 2. Background QA
    job.transition_to(JobStatus.BACKGROUND_QA)
    assert job.status == JobStatus.BACKGROUND_QA.value

    # 3. Background Approved
    job.transition_to(JobStatus.BACKGROUND_APPROVED)
    assert job.status == JobStatus.BACKGROUND_APPROVED.value

    # 4. Product Cutout
    job.transition_to(JobStatus.PRODUCT_CUTOUT)
    assert job.status == JobStatus.PRODUCT_CUTOUT.value

    # 5. Product QA
    job.transition_to(JobStatus.PRODUCT_QA)
    assert job.status == JobStatus.PRODUCT_QA.value

    # 6. Compositing
    job.transition_to(JobStatus.COMPOSITING)
    assert job.status == JobStatus.COMPOSITING.value

    # 7. Composite QA
    job.transition_to(JobStatus.COMPOSITE_QA)
    assert job.status == JobStatus.COMPOSITE_QA.value

    # 8. Composite Approved
    job.transition_to(JobStatus.COMPOSITE_APPROVED)
    assert job.status == JobStatus.COMPOSITE_APPROVED.value

    # 9. Final Rendering
    job.transition_to(JobStatus.FINAL_RENDERING)
    assert job.status == JobStatus.FINAL_RENDERING.value

    # 10. Final QA
    job.transition_to(JobStatus.FINAL_QA)
    assert job.status == JobStatus.FINAL_QA.value

    # 11. Final Ad Approved
    job.transition_to(JobStatus.FINAL_AD_APPROVED)
    assert job.status == JobStatus.FINAL_AD_APPROVED.value

    # 12. Completed
    job.transition_to(JobStatus.COMPLETED)
    assert job.status == JobStatus.COMPLETED.value


# ==============================================================================
# 3. FIXTURE FOR CROSS-JOB ISOLATION TESTS
# ==============================================================================

@pytest_asyncio.fixture
async def seeded_cross_job_pipeline(test_db_session: AsyncSession):
    storage = get_storage_provider()

    # Asset
    asset = AssetValidationRecord(
        url="http://127.0.0.1:8000/api/v1/storage/demo/smartfit_x1.png",
        storage_key="demo/smartfit_x1.png",
        detected_mime="image/png",
        width=800,
        height=800,
        aspect_ratio=1.0,
        has_alpha_channel=True,
        validation_status="PASS",
    )
    test_db_session.add(asset)

    # Job A Pipeline
    brief_a = AdBrief(
        brand_name="SmartFit",
        product_name="SmartFit Watch A",
        price=199.0,
        currency="USD",
        platforms=["instagram"],
        validation_status="PASS",
        payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief_a)
    await test_db_session.flush()

    strat_a = CreativeStrategyRecord(
        brief_id=brief_a.id,
        version_number=1,
        status="APPROVED",
        template_id="product_sale_dark",
        strategy_spec={
            "template_id": "product_sale_dark",
            "concept": {"angle": "Fitness"},
            "visual_direction": {"lighting": "studio", "background_description": "dark minimalist studio"},
            "copy_spec": {"headline": "Track Your Run", "subheadline": "Precision sensors", "cta": "Buy Now", "offer_mention": "$199"},
        },
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strat_a)
    await test_db_session.flush()

    job_a = CreativeJob(
        brief_id=brief_a.id,
        strategy_id=strat_a.id,
        status=JobStatus.BACKGROUND_APPROVED.value,
        current_stage="Background Approved",
    )
    test_db_session.add(job_a)
    await test_db_session.flush()

    bg_img = Image.new("RGB", (1080, 1350), color=(15, 23, 42))
    buf_a = io.BytesIO()
    bg_img.save(buf_a, format="PNG")
    bg_bytes_a = buf_a.getvalue()
    bg_key_a = f"backgrounds/{job_a.id}/instagram/bg.png"
    await storage.save_bytes(bg_bytes_a, bg_key_a, content_type="image/png")

    bg_a = GeneratedBackgroundRecord(
        job_id=job_a.id,
        brief_id=brief_a.id,
        strategy_id=strat_a.id,
        platform="instagram",
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        provider="mock",
        model_name="mock-studio-v1",
        prompt_spec={"environment": "dark minimalist studio"},
        prompt_version="v1.0",
        attempt_number=1,
        storage_key=bg_key_a,
        qa_status="PASS",
        qa_result={"status": "PASS", "score": 95.0, "checks": []},
        cache_key="bg_cache_a",
    )
    test_db_session.add(bg_a)
    await test_db_session.flush()

    comp_img = Image.new("RGB", (1080, 1350), color=(20, 30, 50))
    c_buf_a = io.BytesIO()
    comp_img.save(c_buf_a, format="PNG")
    comp_key_a = f"composites/{job_a.id}/instagram/comp.png"
    await storage.save_bytes(c_buf_a.getvalue(), comp_key_a, content_type="image/png")

    comp_a = CompositedCreativeRecord(
        job_id=job_a.id,
        brief_id=brief_a.id,
        strategy_id=strat_a.id,
        background_id=bg_a.id,
        platform="instagram",
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        storage_key=comp_key_a,
        cutout_storage_key=None,
        placement_spec={"x": 540, "y": 675, "width": 400, "height": 400},
        shadow_spec={"enabled": True},
        integrity_metadata={"source_asset_hash": "hash_a", "cutout_hash": "cutout_a", "output_hash": "comp_out_a"},
        qa_status="PASS",
        qa_result={"status": "PASS", "score": 98.0, "checks": []},
        cache_key="comp_cache_a",
        attempt_number=1,
    )
    test_db_session.add(comp_a)

    # Job B Pipeline
    brief_b = AdBrief(
        brand_name="OtherBrand",
        product_name="Product B",
        price=299.0,
        currency="USD",
        platforms=["instagram"],
        validation_status="PASS",
        payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief_b)
    await test_db_session.flush()

    strat_b = CreativeStrategyRecord(
        brief_id=brief_b.id,
        version_number=1,
        status="APPROVED",
        template_id="product_sale_dark",
        strategy_spec={
            "template_id": "product_sale_dark",
            "concept": {"angle": "Other"},
            "visual_direction": {"lighting": "studio", "background_description": "other studio"},
            "copy_spec": {"headline": "Other Headline", "subheadline": "Other Sub", "cta": "Order", "offer_mention": "$299"},
        },
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strat_b)
    await test_db_session.flush()

    job_b = CreativeJob(
        brief_id=brief_b.id,
        strategy_id=strat_b.id,
        status=JobStatus.STRATEGY_VALIDATED.value,
        current_stage="Strategy Approved",
    )
    test_db_session.add(job_b)
    await test_db_session.commit()

    return {
        "job_a": job_a,
        "brief_a": brief_a,
        "strat_a": strat_a,
        "bg_a": bg_a,
        "comp_a": comp_a,
        "job_b": job_b,
        "brief_b": brief_b,
        "strat_b": strat_b,
    }


# ==============================================================================
# 4. CROSS-JOB ISOLATION & GRAPH INTEGRITY TESTS
# ==============================================================================

@pytest.mark.asyncio
async def test_background_belonging_to_job_a_used_for_job_b_rejected(test_db_session: AsyncSession, seeded_cross_job_pipeline: dict):
    """A. Background belonging to Job A used for Job B -> REJECT"""
    pipe = seeded_cross_job_pipeline
    bg_a = pipe["bg_a"]

    # Inadvertently or maliciously tamper bg_a.job_id to job_b.id while strategy_id still points to strat_a
    bg_a.job_id = pipe["job_b"].id
    await test_db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await CompositeService.composite_product(
            db=test_db_session,
            background_id=bg_a.id,
            force_regenerate=True,
        )
    assert exc_info.value.status_code == 400
    assert "Relationship mismatch" in exc_info.value.detail or "does not match" in exc_info.value.detail


@pytest.mark.asyncio
async def test_composite_background_relationship_mismatch_rejected(test_db_session: AsyncSession, seeded_cross_job_pipeline: dict):
    """B. Composite/background relationship mismatch -> REJECT"""
    pipe = seeded_cross_job_pipeline
    comp_a = pipe["comp_a"]

    # Tamper composite's background_id to a nonexistent or mismatched ID
    comp_a.background_id = "nonexistent-bg-uuid-12345"
    await test_db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await FinalAdService.render_final_ad(
            db=test_db_session,
            composite_id=comp_a.id,
            force_regenerate=True,
        )
    assert exc_info.value.status_code == 400
    assert "Referenced GeneratedBackgroundRecord" in exc_info.value.detail


@pytest.mark.asyncio
async def test_background_with_wrong_brief_rejected(test_db_session: AsyncSession, seeded_cross_job_pipeline: dict):
    """C. Background with wrong brief -> REJECT"""
    pipe = seeded_cross_job_pipeline
    bg_a = pipe["bg_a"]

    # Tamper bg_a.brief_id to brief_b.id
    bg_a.brief_id = pipe["brief_b"].id
    await test_db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await CompositeService.composite_product(
            db=test_db_session,
            background_id=bg_a.id,
            force_regenerate=True,
        )
    assert exc_info.value.status_code == 400
    assert "brief_id" in exc_info.value.detail.lower()
    assert "mismatch" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_background_with_wrong_strategy_rejected(test_db_session: AsyncSession, seeded_cross_job_pipeline: dict):
    """D. Background with wrong strategy -> REJECT"""
    pipe = seeded_cross_job_pipeline
    bg_a = pipe["bg_a"]

    # Tamper bg_a.strategy_id to strat_b.id while brief_id is still brief_a
    bg_a.strategy_id = pipe["strat_b"].id
    await test_db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await CompositeService.composite_product(
            db=test_db_session,
            background_id=bg_a.id,
            force_regenerate=True,
        )
    assert exc_info.value.status_code == 400
    assert "strategy_id" in exc_info.value.detail.lower() or "strategy" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_composite_with_wrong_job_brief_graph_rejected(test_db_session: AsyncSession, seeded_cross_job_pipeline: dict):
    """E. Composite with wrong job/brief graph -> REJECT"""
    pipe = seeded_cross_job_pipeline
    comp_a = pipe["comp_a"]

    # Tamper composite's job_id to point to Job B
    comp_a.job_id = pipe["job_b"].id
    await test_db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await CompositeService.recomposite_product(
            db=test_db_session,
            composite_id=comp_a.id,
        )
    assert exc_info.value.status_code == 400
    assert "Cross-job access prohibited" in exc_info.value.detail or "inconsistent" in exc_info.value.detail


@pytest.mark.asyncio
async def test_final_ad_referencing_resource_from_another_job_rejected(test_db_session: AsyncSession, seeded_cross_job_pipeline: dict):
    """F. Final-ad request referencing a resource from another job -> REJECT"""
    pipe = seeded_cross_job_pipeline
    comp_a = pipe["comp_a"]

    # Mismatch: composite job_id is changed to Job B, but background is still from Job A
    comp_a.job_id = pipe["job_b"].id
    await test_db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await FinalAdService.render_final_ad(
            db=test_db_session,
            composite_id=comp_a.id,
            force_regenerate=True,
        )
    assert exc_info.value.status_code == 400
    assert "Cross-job resource access prohibited" in exc_info.value.detail
