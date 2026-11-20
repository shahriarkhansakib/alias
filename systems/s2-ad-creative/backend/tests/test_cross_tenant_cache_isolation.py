"""Comprehensive Multi-Tenant Adversarial Cache Isolation Tests.

Verifies:
1. Cache key generation is strictly tenant-scoped across Background, Composite, and Final Ad services.
2. Identical inputs from two different tenants NEVER result in cross-tenant cache reuse.
3. Each tenant generates independent database records owned exclusively by its tenant_id.
4. Same-tenant identical inputs continue to achieve legitimate deterministic cache hits.
5. Cross-tenant retrieval, approval, and mutation operations are rejected with HTTP 404 / access denied.
"""

import io
import uuid
import pytest
import pytest_asyncio
from PIL import Image, ImageDraw
from httpx import AsyncClient, ASGITransport
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.main import app
from app.core.database import get_db
from app.core.auth import create_access_token
from app.models.auth import User, Tenant, Membership
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
from app.services.background_service import BackgroundService
from app.services.composite_service import CompositeService
from app.services.final_ad_service import FinalAdService
from app.providers.storage_provider import get_storage_provider
from app.demo.sample_assets import SMARTFIT_X1_DEMO_BRIEF, generate_demo_smartwatch_png


TENANT_A_ID = "tenant-alpha-1111-1111-1111-111111111111"
TENANT_B_ID = "tenant-bravo-2222-2222-2222-222222222222"
USER_A_ID = "user-alpha-1111-1111-1111-111111111111"
USER_B_ID = "user-bravo-2222-2222-2222-222222222222"


@pytest_asyncio.fixture
async def setup_two_tenants(test_db_session: AsyncSession):
    """Seed two distinct tenants, users, and memberships in the database."""
    tenant_a = Tenant(id=TENANT_A_ID, name="Tenant Alpha", slug="tenant-alpha")
    tenant_b = Tenant(id=TENANT_B_ID, name="Tenant Bravo", slug="tenant-bravo")

    user_a = User(id=USER_A_ID, email="alpha@example.com", full_name="Alpha User", is_active=True)
    user_b = User(id=USER_B_ID, email="bravo@example.com", full_name="Bravo User", is_active=True)

    membership_a = Membership(id=str(uuid.uuid4()), user_id=USER_A_ID, tenant_id=TENANT_A_ID, role="OWNER")
    membership_b = Membership(id=str(uuid.uuid4()), user_id=USER_B_ID, tenant_id=TENANT_B_ID, role="OWNER")

    test_db_session.add_all([tenant_a, tenant_b, user_a, user_b, membership_a, membership_b])
    await test_db_session.commit()
    return {"tenant_a": tenant_a, "tenant_b": tenant_b}


def get_tenant_client(test_db_session: AsyncSession, user_id: str, email: str, tenant_id: str) -> AsyncClient:
    async def override_get_db():
        yield test_db_session

    app.dependency_overrides[get_db] = override_get_db
    token = create_access_token({"sub": user_id, "email": email, "tenant_id": tenant_id})
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Tenant-ID": tenant_id,
    }
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test", headers=headers)


def test_cache_key_strict_tenant_scoping():
    """Verify SHA-256 cache keys are strictly distinct when tenant_id differs."""
    # Background
    bg_key_a = BackgroundService._compute_cache_key(
        strategy_id="strat-1",
        strategy_version=1,
        platform="facebook_feed",
        template_id="bold_01",
        prompt_version="v1",
        provider_name="demo",
        model_name="m1",
        width=1080,
        height=1080,
        tenant_id="tenant-a",
    )
    bg_key_b = BackgroundService._compute_cache_key(
        strategy_id="strat-1",
        strategy_version=1,
        platform="facebook_feed",
        template_id="bold_01",
        prompt_version="v1",
        provider_name="demo",
        model_name="m1",
        width=1080,
        height=1080,
        tenant_id="tenant-b",
    )
    bg_key_a2 = BackgroundService._compute_cache_key(
        strategy_id="strat-1",
        strategy_version=1,
        platform="facebook_feed",
        template_id="bold_01",
        prompt_version="v1",
        provider_name="demo",
        model_name="m1",
        width=1080,
        height=1080,
        tenant_id="tenant-a",
    )
    assert bg_key_a != bg_key_b, "Background cache keys for different tenants must not match!"
    assert bg_key_a == bg_key_a2, "Identical inputs for same tenant must produce identical cache keys."

    # Composite
    comp_key_a = CompositeService._compute_cache_key(
        source_asset_hash="src_hash",
        cutout_hash="cut_hash",
        background_id="bg_123",
        platform="facebook_feed",
        template_id="bold_01",
        placement_dict={"x": 0.5, "y": 0.5},
        shadow_dict={"blur": 5},
        tenant_id="tenant-a",
    )
    comp_key_b = CompositeService._compute_cache_key(
        source_asset_hash="src_hash",
        cutout_hash="cut_hash",
        background_id="bg_123",
        platform="facebook_feed",
        template_id="bold_01",
        placement_dict={"x": 0.5, "y": 0.5},
        shadow_dict={"blur": 5},
        tenant_id="tenant-b",
    )
    assert comp_key_a != comp_key_b, "Composite cache keys for different tenants must not match!"

    # Final Ad
    empty_dict = {}
    ad_key_a = FinalAdService._compute_cache_key(
        composite_output_hash="comp_hash",
        copy_hash="copy_hash",
        platform="facebook_feed",
        template_id="bold_01",
        typography_dict=empty_dict,
        cta_dict=empty_dict,
        price_badge_dict=empty_dict,
        readability_dict=empty_dict,
        font_hashes=empty_dict,
        tenant_id="tenant-a",
    )
    ad_key_b = FinalAdService._compute_cache_key(
        composite_output_hash="comp_hash",
        copy_hash="copy_hash",
        platform="facebook_feed",
        template_id="bold_01",
        typography_dict=empty_dict,
        cta_dict=empty_dict,
        price_badge_dict=empty_dict,
        readability_dict=empty_dict,
        font_hashes=empty_dict,
        tenant_id="tenant-b",
    )
    assert ad_key_a != ad_key_b, "Final Ad cache keys for different tenants must not match!"


@pytest.mark.asyncio
async def test_cross_tenant_pipeline_cache_isolation(setup_two_tenants, test_db_session: AsyncSession):
    """End-to-end test verifying multi-tenant cache isolation through background, composite, and final ad."""
    storage = get_storage_provider()
    demo_png_bytes = generate_demo_smartwatch_png()

    strategy_spec = CreativeStrategySpec(
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

    # -------------------------------------------------------------
    # Step 1: Create Brief, Asset, Strategy, Job for Tenant A
    # -------------------------------------------------------------
    brief_a = AdBrief(
        tenant_id=TENANT_A_ID,
        brand_name="SmartFit",
        product_name="SmartFit X1 Pro",
        price=999.0,
        currency="BDT",
        platforms=["facebook"],
        validation_status="PASS",
        payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief_a)
    await test_db_session.flush()

    asset_key_a = f"assets/{brief_a.id}/product.png"
    await storage.save_bytes(demo_png_bytes, asset_key_a, content_type="image/png")
    asset_a = AssetValidationRecord(
        tenant_id=TENANT_A_ID,
        url=SMARTFIT_X1_DEMO_BRIEF["images"][0]["url"],
        storage_key=asset_key_a,
        validation_status="PASS",
        width=800,
        height=800,
        has_alpha_channel=True,
        file_size_bytes=len(demo_png_bytes),
    )
    test_db_session.add(asset_a)
    await test_db_session.flush()

    strat_a = CreativeStrategyRecord(
        tenant_id=TENANT_A_ID,
        brief_id=brief_a.id,
        version_number=1,
        status="APPROVED",
        template_id="product_sale_dark",
        strategy_spec=strategy_spec.model_dump(),
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strat_a)
    await test_db_session.flush()

    job_a = CreativeJob(
        tenant_id=TENANT_A_ID,
        brief_id=brief_a.id,
        strategy_id=strat_a.id,
        status=JobStatus.STRATEGY_VALIDATED.value,
    )
    test_db_session.add(job_a)

    # -------------------------------------------------------------
    # Step 2: Create Identical Brief, Asset, Strategy, Job for Tenant B
    # -------------------------------------------------------------
    brief_b = AdBrief(
        tenant_id=TENANT_B_ID,
        brand_name="SmartFit",
        product_name="SmartFit X1 Pro",
        price=999.0,
        currency="BDT",
        platforms=["facebook"],
        validation_status="PASS",
        payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief_b)
    await test_db_session.flush()

    asset_key_b = f"assets/{brief_b.id}/product.png"
    await storage.save_bytes(demo_png_bytes, asset_key_b, content_type="image/png")
    asset_b = AssetValidationRecord(
        tenant_id=TENANT_B_ID,
        url=SMARTFIT_X1_DEMO_BRIEF["images"][0]["url"],
        storage_key=asset_key_b,
        validation_status="PASS",
        width=800,
        height=800,
        has_alpha_channel=True,
        file_size_bytes=len(demo_png_bytes),
    )
    test_db_session.add(asset_b)
    await test_db_session.flush()

    strat_b = CreativeStrategyRecord(
        tenant_id=TENANT_B_ID,
        brief_id=brief_b.id,
        version_number=1,
        status="APPROVED",
        template_id="product_sale_dark",
        strategy_spec=strategy_spec.model_dump(),
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strat_b)
    await test_db_session.flush()

    job_b = CreativeJob(
        tenant_id=TENANT_B_ID,
        brief_id=brief_b.id,
        strategy_id=strat_b.id,
        status=JobStatus.STRATEGY_VALIDATED.value,
    )
    test_db_session.add(job_b)
    await test_db_session.commit()

    # -------------------------------------------------------------
    # Step 3: Background Generation & Cache Isolation
    # -------------------------------------------------------------
    bg_a1 = await BackgroundService.generate_background(
        db=test_db_session,
        strategy_id=strat_a.id,
        platform=TargetPlatform.FACEBOOK,
    )
    assert bg_a1.tenant_id == TENANT_A_ID
    assert bg_a1.is_cached is False

    # Tenant B runs identical generation request
    bg_b1 = await BackgroundService.generate_background(
        db=test_db_session,
        strategy_id=strat_b.id,
        platform=TargetPlatform.FACEBOOK,
    )
    # Tenant B MUST NOT get Tenant A's background!
    assert bg_b1.tenant_id == TENANT_B_ID, "Tenant B must own its background!"
    assert bg_b1.id != bg_a1.id, "Tenant B must NOT receive Tenant A's background record!"
    assert bg_b1.is_cached is False, "Tenant B must NOT achieve cross-tenant cache hit!"
    assert bg_b1.cache_key != bg_a1.cache_key, "Tenant A and Tenant B must have distinct cache keys!"

    # Tenant A generates again -> legitimately hits its OWN cache
    bg_a2 = await BackgroundService.generate_background(
        db=test_db_session,
        strategy_id=strat_a.id,
        platform=TargetPlatform.FACEBOOK,
    )
    assert bg_a2.id == bg_a1.id
    assert bg_a2.is_cached is True
    assert bg_a2.tenant_id == TENANT_A_ID

    # Approve backgrounds
    job_a.status = JobStatus.BACKGROUND_APPROVED.value
    job_b.status = JobStatus.BACKGROUND_APPROVED.value
    await test_db_session.commit()

    # -------------------------------------------------------------
    # Step 4: Composite Generation & Cache Isolation
    # -------------------------------------------------------------
    comp_a1 = await CompositeService.composite_product(
        db=test_db_session,
        background_id=bg_a1.id,
    )
    assert comp_a1.tenant_id == TENANT_A_ID
    assert comp_a1.is_cached is False

    # Tenant B creates composite with identical placement and scale
    comp_b1 = await CompositeService.composite_product(
        db=test_db_session,
        background_id=bg_b1.id,
    )
    assert comp_b1.tenant_id == TENANT_B_ID, "Tenant B must own its composite!"
    assert comp_b1.id != comp_a1.id, "Tenant B must NOT receive Tenant A's composite!"
    assert comp_b1.is_cached is False, "Tenant B must NOT achieve cross-tenant cache hit!"
    assert comp_b1.cache_key != comp_a1.cache_key

    # Tenant A creates composite again -> legitimate cache hit on its OWN composite
    comp_a2 = await CompositeService.composite_product(
        db=test_db_session,
        background_id=bg_a1.id,
    )
    assert comp_a2.id == comp_a1.id
    assert comp_a2.is_cached is True

    # Approve composites
    job_a.status = JobStatus.COMPOSITE_APPROVED.value
    job_b.status = JobStatus.COMPOSITE_APPROVED.value
    await test_db_session.commit()

    # -------------------------------------------------------------
    # Step 5: Final Ad Rendering & Cache Isolation
    # -------------------------------------------------------------
    final_a1 = await FinalAdService.render_final_ad(
        db=test_db_session,
        composite_id=comp_a1.id,
    )
    assert final_a1.tenant_id == TENANT_A_ID
    assert final_a1.is_cached is False

    # Tenant B renders final ad with identical copy/strategy
    final_b1 = await FinalAdService.render_final_ad(
        db=test_db_session,
        composite_id=comp_b1.id,
    )
    assert final_b1.tenant_id == TENANT_B_ID, "Tenant B must own its final ad!"
    assert final_b1.id != final_a1.id, "Tenant B must NOT receive Tenant A's final ad!"
    assert final_b1.is_cached is False, "Tenant B must NOT achieve cross-tenant cache hit!"
    assert final_b1.cache_key != final_a1.cache_key

    # Tenant A renders again -> legitimate cache hit
    final_a2 = await FinalAdService.render_final_ad(
        db=test_db_session,
        composite_id=comp_a1.id,
    )
    assert final_a2.id == final_a1.id
    assert final_a2.is_cached is True
    assert final_a2.tenant_id == TENANT_A_ID

    # -------------------------------------------------------------
    # Step 6: Multi-Tenant REST API Access Enforcement (tenant-scoped GET and approve)
    # -------------------------------------------------------------
    async with get_tenant_client(test_db_session, USER_A_ID, "alpha@example.com", TENANT_A_ID) as client_a:
        async with get_tenant_client(test_db_session, USER_B_ID, "bravo@example.com", TENANT_B_ID) as client_b:
            # 1. Tenant A fetches its own final ad (must succeed)
            resp_a_get_a = await client_a.get(f"/api/v1/final-ads/{final_a1.id}")
            assert resp_a_get_a.status_code == 200, f"Tenant A fetching its own final ad failed: {resp_a_get_a.text}"
            data_a = resp_a_get_a.json()
            assert data_a["id"] == final_a1.id
            # tenant_id is not in FinalAdResponse schema; we already verified it at service level above

            # 2. Tenant B fetches its own final ad (must succeed)
            resp_b_get_b = await client_b.get(f"/api/v1/final-ads/{final_b1.id}")
            assert resp_b_get_b.status_code == 200, f"Tenant B fetching its own final ad failed: {resp_b_get_b.text}"
            data_b = resp_b_get_b.json()
            assert data_b["id"] == final_b1.id
            # tenant_id is not in FinalAdResponse schema; isolation is verified at service level above

            # 3. Adversarial: Tenant B attempts to fetch Tenant A's final ad (must be rejected)
            resp_b_get_a = await client_b.get(f"/api/v1/final-ads/{final_a1.id}")
            assert resp_b_get_a.status_code in (404, 403), "Tenant B must NOT access Tenant A's final ad!"

            # 4. Adversarial: Tenant A attempts to fetch Tenant B's final ad (must be rejected)
            resp_a_get_b = await client_a.get(f"/api/v1/final-ads/{final_b1.id}")
            assert resp_a_get_b.status_code in (404, 403), "Tenant A must NOT access Tenant B's final ad!"

            # 5. Adversarial: Tenant B attempts to approve Tenant A's final ad (must be rejected)
            resp_b_approve_a = await client_b.post(f"/api/v1/final-ads/{final_a1.id}/approve")
            assert resp_b_approve_a.status_code in (404, 403), "Tenant B must NOT approve Tenant A's final ad!"

            # 6. Adversarial: Tenant A attempts to approve Tenant B's final ad (must be rejected)
            resp_a_approve_b = await client_a.post(f"/api/v1/final-ads/{final_b1.id}/approve")
            assert resp_a_approve_b.status_code in (404, 403), "Tenant A must NOT approve Tenant B's final ad!"

            # 7. Tenant B approves its OWN final ad (must succeed)
            resp_b_approve_b = await client_b.post(f"/api/v1/final-ads/{final_b1.id}/approve")
            assert resp_b_approve_b.status_code == 200, f"Tenant B approving its own ad failed: {resp_b_approve_b.text}"

            # 8. Tenant A approves its OWN final ad (must succeed)
            resp_a_approve_a = await client_a.post(f"/api/v1/final-ads/{final_a1.id}/approve")
            assert resp_a_approve_a.status_code == 200, f"Tenant A approving its own ad failed: {resp_a_approve_a.text}"


def test_mandatory_tenant_id_rejection_all_services():
    """Verify all three cache-key helpers strictly require non-empty tenant_id."""
    invalid_tenants = [None, "", "   ", "\t\n"]

    for invalid in invalid_tenants:
        # Background
        with pytest.raises(ValueError, match="tenant_id is required"):
            BackgroundService._compute_cache_key(
                strategy_id="strat-1",
                strategy_version=1,
                platform="facebook_feed",
                template_id="bold_01",
                prompt_version="v1",
                provider_name="demo",
                model_name="m1",
                width=1080,
                height=1080,
                tenant_id=invalid,  # type: ignore
            )

        # Composite
        with pytest.raises(ValueError, match="tenant_id is required"):
            CompositeService._compute_cache_key(
                source_asset_hash="src_hash",
                cutout_hash="cut_hash",
                background_id="bg_123",
                platform="facebook_feed",
                template_id="bold_01",
                placement_dict={"x": 0.5, "y": 0.5},
                shadow_dict={"blur": 5},
                tenant_id=invalid,  # type: ignore
            )

        # Final Ad
        with pytest.raises(ValueError, match="tenant_id is required"):
            FinalAdService._compute_cache_key(
                composite_output_hash="comp_hash",
                copy_hash="copy_hash",
                platform="facebook_feed",
                template_id="bold_01",
                typography_dict={},
                cta_dict={},
                price_badge_dict={},
                readability_dict={},
                font_hashes={},
                tenant_id=invalid,  # type: ignore
            )

    # Calling without tenant_id argument raises TypeError
    with pytest.raises(TypeError):
        BackgroundService._compute_cache_key(  # type: ignore
            strategy_id="strat-1",
            strategy_version=1,
            platform="facebook_feed",
            template_id="bold_01",
            prompt_version="v1",
            provider_name="demo",
            model_name="m1",
            width=1080,
            height=1080,
        )

    with pytest.raises(TypeError):
        CompositeService._compute_cache_key(  # type: ignore
            source_asset_hash="src_hash",
            cutout_hash="cut_hash",
            background_id="bg_123",
            platform="facebook_feed",
            template_id="bold_01",
            placement_dict={},
            shadow_dict={},
        )

    with pytest.raises(TypeError):
        FinalAdService._compute_cache_key(  # type: ignore
            composite_output_hash="comp_hash",
            copy_hash="copy_hash",
            platform="facebook_feed",
            template_id="bold_01",
            typography_dict={},
            cta_dict={},
            price_badge_dict={},
            readability_dict={},
            font_hashes={},
        )

    # Valid tenant_id produces deterministic, distinct keys
    bg_key1 = BackgroundService._compute_cache_key(
        strategy_id="strat-1",
        strategy_version=1,
        platform="facebook_feed",
        template_id="bold_01",
        prompt_version="v1",
        provider_name="demo",
        model_name="m1",
        width=1080,
        height=1080,
        tenant_id="tenant-alpha",
    )
    bg_key_trimmed = BackgroundService._compute_cache_key(
        strategy_id="strat-1",
        strategy_version=1,
        platform="facebook_feed",
        template_id="bold_01",
        prompt_version="v1",
        provider_name="demo",
        model_name="m1",
        width=1080,
        height=1080,
        tenant_id="  tenant-alpha  ",
    )
    bg_key_beta = BackgroundService._compute_cache_key(
        strategy_id="strat-1",
        strategy_version=1,
        platform="facebook_feed",
        template_id="bold_01",
        prompt_version="v1",
        provider_name="demo",
        model_name="m1",
        width=1080,
        height=1080,
        tenant_id="tenant-beta",
    )
    assert bg_key1 == bg_key_trimmed, "Whitespace trimming should produce identical tenant cache key"
    assert bg_key1 != bg_key_beta, "Different tenants must produce distinct cache keys"


@pytest.mark.asyncio
async def test_service_layer_rejects_job_missing_tenant_id(setup_two_tenants, test_db_session: AsyncSession):
    """Verify services reject execution with HTTP 400 when CreativeJob lacks tenant_id."""
    storage = get_storage_provider()
    demo_png_bytes = generate_demo_smartwatch_png()

    strategy_spec = CreativeStrategySpec(
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

    brief = AdBrief(
        tenant_id=TENANT_A_ID,
        brand_name="SmartFit",
        product_name="SmartFit X1 Pro",
        price=999.0,
        currency="BDT",
        platforms=["facebook"],
        validation_status="PASS",
        payload=SMARTFIT_X1_DEMO_BRIEF,
    )
    test_db_session.add(brief)
    await test_db_session.flush()

    asset_key = f"assets/{brief.id}/product.png"
    await storage.save_bytes(demo_png_bytes, asset_key, content_type="image/png")
    asset = AssetValidationRecord(
        tenant_id=TENANT_A_ID,
        url=SMARTFIT_X1_DEMO_BRIEF["images"][0]["url"],
        storage_key=asset_key,
        validation_status="PASS",
        width=800,
        height=800,
        has_alpha_channel=True,
        file_size_bytes=len(demo_png_bytes),
    )
    test_db_session.add(asset)
    await test_db_session.flush()

    strat = CreativeStrategyRecord(
        tenant_id=TENANT_A_ID,
        brief_id=brief.id,
        version_number=1,
        status="APPROVED",
        template_id="product_sale_dark",
        strategy_spec=strategy_spec.model_dump(),
        claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
    )
    test_db_session.add(strat)
    await test_db_session.flush()

    # Job with empty tenant_id
    job_unscoped = CreativeJob(
        tenant_id="",
        brief_id=brief.id,
        strategy_id=strat.id,
        status=JobStatus.STRATEGY_VALIDATED.value,
    )
    test_db_session.add(job_unscoped)
    await test_db_session.commit()

    # 1. Background generation rejects job without tenant_id
    with pytest.raises(HTTPException) as exc_info:
        await BackgroundService.generate_background(
            db=test_db_session,
            strategy_id=strat.id,
            platform=TargetPlatform.FACEBOOK,
        )
    assert exc_info.value.status_code == 400
    assert "tenant_id" in exc_info.value.detail.lower()

    # Create legitimate background for subsequent stage tests
    job_unscoped.tenant_id = TENANT_A_ID
    await test_db_session.commit()

    bg_rec = await BackgroundService.generate_background(
        db=test_db_session,
        strategy_id=strat.id,
        platform=TargetPlatform.FACEBOOK,
    )
    assert bg_rec.tenant_id == TENANT_A_ID

    # Reset job to empty tenant_id
    job_unscoped.tenant_id = ""
    await test_db_session.commit()

    # 2. Compositing rejects job without tenant_id
    with pytest.raises(HTTPException) as exc_info_comp:
        await CompositeService.composite_product(
            db=test_db_session,
            background_id=bg_rec.id,
        )
    assert exc_info_comp.value.status_code == 400
    assert "tenant_id" in exc_info_comp.value.detail.lower()

    # Legitimate composite for final ad test
    job_unscoped.tenant_id = TENANT_A_ID
    await test_db_session.commit()

    comp_rec = await CompositeService.composite_product(
        db=test_db_session,
        background_id=bg_rec.id,
    )
    assert comp_rec.tenant_id == TENANT_A_ID

    # Reset job to empty tenant_id
    job_unscoped.tenant_id = "   "
    await test_db_session.commit()

    # 3. Final ad rendering rejects job without tenant_id
    with pytest.raises(HTTPException) as exc_info_ad:
        await FinalAdService.render_final_ad(
            db=test_db_session,
            composite_id=comp_rec.id,
        )
    assert exc_info_ad.value.status_code == 400
    assert "tenant_id" in exc_info_ad.value.detail.lower()
