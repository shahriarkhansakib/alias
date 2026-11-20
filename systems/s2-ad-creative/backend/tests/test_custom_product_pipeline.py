import pytest
import io
import hashlib
from PIL import Image
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.models.composite import CompositedCreativeRecord
from app.models.final_ad import FinalRenderedCreativeRecord
from app.providers.storage_provider import get_storage_provider


@pytest.mark.asyncio
async def test_end_to_end_custom_product_pipeline(client: AsyncClient, test_db_session: AsyncSession):
    """
    Validates that a custom product image (demo/iphone.png) flows through
    the entire pipeline (Brief -> Asset Gate -> Strategy -> Background -> Composite -> Final Ad)
    and that the composited creative and final ad incorporate the custom product,
    rather than defaulting to the watch.
    """
    storage = get_storage_provider()

    # Ensure demo/iphone.png exists in storage
    iphone_bytes = await storage.get_bytes("demo/iphone.png")
    assert len(iphone_bytes) > 0
    iphone_hash = hashlib.sha256(iphone_bytes).hexdigest()

    # Ensure watch bytes exist for distinct hash comparison
    watch_bytes = await storage.get_bytes("demo/smartfit_x1.png")
    watch_hash = hashlib.sha256(watch_bytes).hexdigest()
    assert iphone_hash != watch_hash

    # Dev login to obtain JWT and tenant
    login_res = await client.post("/api/v1/auth/dev-login", json={"email": "developer@example.com"})
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Save Brief with iphone.png
    brief_payload = {
        "brand": {
            "name": "Apple",
            "colors": ["#1D1D1F", "#0071E3"],
            "font_family": "Inter",
        },
        "product": {
            "name": "iPhone 16 Pro",
            "category": "Smartphones",
            "offer": {
                "price": 999.0,
                "currency": "USD",
            },
            "features": ["Titanium design", "A18 Pro chip"],
        },
        "images": [
            {
                "url": "http://127.0.0.1:8000/api/v1/storage/demo/iphone.png",
                "asset_type": "primary_product",
                "description": "iPhone 16 Pro cutout",
            }
        ],
        "campaign": {
            "name": "iPhone Launch",
            "objective": "product_sales",
            "platforms": ["instagram"],
        },
        "approved_claims": ["Titanium design", "A18 Pro chip"],
        "copy": {
            "headline": "Titanium. So strong. So light. So Pro.",
            "subheadline": "Experience the next generation.",
            "cta": "Buy Now",
        },
    }

    brief_res = await client.post(
        "/api/v1/briefs?validate_asset_now=true&require_transparency=true",
        json=brief_payload,
        headers=headers,
    )
    assert brief_res.status_code == 201, brief_res.text
    brief_data = brief_res.json()
    brief_id = brief_data["id"]
    assert brief_data["validation_status"] == "PASS"

    # Verify asset validation record was persisted with storage_key demo/iphone.png
    stmt_asset = select(AssetValidationRecord).where(
        AssetValidationRecord.url == "http://127.0.0.1:8000/api/v1/storage/demo/iphone.png"
    )
    asset_rec = (await test_db_session.execute(stmt_asset)).scalars().first()
    assert asset_rec is not None
    assert asset_rec.validation_status in ("PASS", "WARNING")
    assert asset_rec.storage_key == "demo/iphone.png"

    # 2. Generate Strategy
    strat_res = await client.post(
        "/api/v1/strategies/generate",
        json={"brief_id": brief_id},
        headers=headers,
    )
    assert strat_res.status_code == 200, strat_res.text
    strat_data = strat_res.json()
    strat_id = strat_data["strategy_id"]

    # 3. Generate Background
    bg_res = await client.post(
        "/api/v1/backgrounds/generate",
        json={"strategy_id": strat_id, "platform": "instagram"},
        headers=headers,
    )
    assert bg_res.status_code == 200, bg_res.text
    bg_data = bg_res.json()
    bg_id = bg_data["id"]

    # 4. Generate Composite with force_regenerate=True
    comp_res = await client.post(
        "/api/v1/composites/generate",
        json={
            "background_id": bg_id,
            "placement": {"scale": 0.85, "alignment": "center"},
            "shadow": {"enabled": True, "opacity": 0.3},
            "force_regenerate": True,
        },
        headers=headers,
    )
    assert comp_res.status_code == 200, comp_res.text
    comp_data = comp_res.json()
    comp_id = comp_data["id"]

    # Verify composite record cutouts and storage key
    stmt_comp = select(CompositedCreativeRecord).where(CompositedCreativeRecord.id == comp_id)
    comp_rec = (await test_db_session.execute(stmt_comp)).scalars().first()
    assert comp_rec is not None

    # Verify the cutout saved matches the iphone cutout, not the watch
    cutout_bytes = await storage.get_bytes(comp_rec.cutout_storage_key)
    assert hashlib.sha256(cutout_bytes).hexdigest() != watch_hash

    # 5. Generate Final Ad with force_regenerate=True
    ad_res = await client.post(
        "/api/v1/final-ads/generate",
        json={
            "composite_id": comp_id,
            "typography": {"font_family": "Inter", "headline_size": 48},
            "cta": {"bg_color": "#0071E3", "text_color": "#FFFFFF"},
            "force_regenerate": True,
        },
        headers=headers,
    )
    assert ad_res.status_code == 200, ad_res.text
    ad_data = ad_res.json()
    ad_id = ad_data["id"]

    # Verify final ad record
    stmt_ad = select(FinalRenderedCreativeRecord).where(FinalRenderedCreativeRecord.id == ad_id)
    ad_rec = (await test_db_session.execute(stmt_ad)).scalars().first()
    assert ad_rec is not None
    assert ad_rec.composite_id == comp_id

    # Verify the rendered final ad image is generated and non-empty
    ad_img_bytes = await storage.get_bytes(ad_rec.storage_key)
    assert len(ad_img_bytes) > 1000
    ad_img = Image.open(io.BytesIO(ad_img_bytes))
    assert ad_img.size == (1080, 1350)



@pytest.mark.asyncio
async def test_end_to_end_green_product_pipeline(client: AsyncClient, test_db_session: AsyncSession):
    """
    Validates that green.png (opaque background) successfully flows through the pipeline
    when require_transparency=False.
    """
    storage = get_storage_provider()
    green_bytes = await storage.get_bytes("demo/green.png")
    assert len(green_bytes) > 0

    login_res = await client.post("/api/v1/auth/dev-login", json={"email": "developer@example.com"})
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    brief_payload = {
        "brand": {"name": "Botanical Studio", "colors": ["#15803D", "#166534"]},
        "product": {
            "name": "Green Plant Decor",
            "offer": {"price": 29.0, "currency": "USD"},
            "features": ["Handcrafted ceramic vase", "Natural organic leaves"],
        },
        "images": [
            {
                "url": "http://127.0.0.1:8000/api/v1/storage/demo/green.png",
                "asset_type": "primary_product",
            }
        ],
        "approved_claims": ["Handcrafted ceramic vase", "Natural organic leaves"],
        "copy": {
            "headline": "Breathe Life Into Your Space",
            "subheadline": "Handcrafted ceramic vase with natural organic leaves.",
            "cta": "Shop Collection",
        },
        "campaign": {"platforms": ["instagram"]},
    }

    brief_res = await client.post(
        "/api/v1/briefs?validate_asset_now=true&require_transparency=false",
        json=brief_payload,
        headers=headers,
    )
    assert brief_res.status_code == 201, brief_res.text
    brief_data = brief_res.json()
    brief_id = brief_data["id"]

    # Generate Strategy
    strat_res = await client.post("/api/v1/strategies/generate", json={"brief_id": brief_id}, headers=headers)
    assert strat_res.status_code == 200, strat_res.text
    strat_data = strat_res.json()
    strat_id = strat_data.get("strategy_id") or strat_data.get("id")
    assert strat_id is not None, f"Strategy generation returned no ID: {strat_data}"

    # Generate Background
    bg_res = await client.post("/api/v1/backgrounds/generate", json={"strategy_id": strat_id, "platform": "instagram"}, headers=headers)
    assert bg_res.status_code == 200, bg_res.text
    bg_id = bg_res.json()["id"]

    # Generate Composite
    comp_res = await client.post(
        "/api/v1/composites/generate",
        json={"background_id": bg_id, "force_regenerate": True},
        headers=headers,
    )
    assert comp_res.status_code == 200
    comp_id = comp_res.json()["id"]

    # Generate Final Ad
    ad_res = await client.post(
        "/api/v1/final-ads/generate",
        json={"composite_id": comp_id, "force_regenerate": True},
        headers=headers,
    )
    assert ad_res.status_code == 200
    assert ad_res.json()["composite_id"] == comp_id


@pytest.mark.asyncio
async def test_composite_product_image_url_override(client: AsyncClient, test_db_session: AsyncSession):
    """
    Validates that passing product_image_url to /api/v1/composites/generate
    and /api/v1/composites/{id}/regenerate correctly overrides the product cutout
    with the requested asset (e.g. iphone.png) even when the background was created for smartfit.
    """
    storage = get_storage_provider()
    watch_bytes = await storage.get_bytes("demo/smartfit_x1.png")
    watch_hash = hashlib.sha256(watch_bytes).hexdigest()

    login_res = await client.post("/api/v1/auth/dev-login", json={"email": "developer@example.com"})
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Use the default SmartFit demo brief
    demo_res = await client.get("/api/v1/briefs/demo", headers=headers)
    assert demo_res.status_code == 200
    brief_res = await client.post("/api/v1/briefs?validate_asset_now=true", json=demo_res.json(), headers=headers)
    assert brief_res.status_code == 201
    brief_id = brief_res.json()["id"]

    strat_res = await client.post("/api/v1/strategies/generate", json={"brief_id": brief_id}, headers=headers)
    assert strat_res.status_code == 200
    strat_id = strat_res.json()["strategy_id"]

    bg_res = await client.post("/api/v1/backgrounds/generate", json={"strategy_id": strat_id, "platform": "instagram"}, headers=headers)
    assert bg_res.status_code == 200
    bg_id = bg_res.json()["id"]

    # 2. Generate composite with product_image_url override pointing to iphone.png
    comp_res = await client.post(
        "/api/v1/composites/generate",
        json={
            "background_id": bg_id,
            "product_image_url": "http://127.0.0.1:8000/api/v1/storage/demo/iphone.png",
            "force_regenerate": True,
        },
        headers=headers,
    )
    assert comp_res.status_code == 200, comp_res.text
    comp_data = comp_res.json()
    comp_id = comp_data["id"]

    stmt_comp = select(CompositedCreativeRecord).where(CompositedCreativeRecord.id == comp_id)
    comp_rec = (await test_db_session.execute(stmt_comp)).scalars().first()
    assert comp_rec is not None

    cutout_bytes = await storage.get_bytes(comp_rec.cutout_storage_key)
    # Must NOT be the watch!
    assert hashlib.sha256(cutout_bytes).hexdigest() != watch_hash

    # 3. Recomposite with product_image_url override
    recomp_res = await client.post(
        f"/api/v1/composites/{comp_id}/regenerate",
        json={
            "product_image_url": "http://127.0.0.1:8000/api/v1/storage/demo/iphone.png",
            "placement": {"scale": 0.8, "alignment": "center"},
        },
        headers=headers,
    )
    assert recomp_res.status_code == 200, recomp_res.text
    recomp_data = recomp_res.json()

    stmt_recomp = select(CompositedCreativeRecord).where(CompositedCreativeRecord.id == recomp_data["id"])
    recomp_rec = (await test_db_session.execute(stmt_recomp)).scalars().first()
    assert recomp_rec is not None

    recomp_cutout_bytes = await storage.get_bytes(recomp_rec.cutout_storage_key)
    assert hashlib.sha256(recomp_cutout_bytes).hexdigest() != watch_hash
