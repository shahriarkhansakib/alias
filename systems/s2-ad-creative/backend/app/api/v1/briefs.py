from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.core.database import get_db
from app.core.auth import get_current_tenant
from app.models.auth import Tenant
from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.schemas.validation import BriefValidationResponse, AssetValidationResponse
from app.services.payload_gate import payload_gate_service
from app.services.asset_gate import asset_gate_service
from app.demo.sample_assets import SMARTFIT_X1_DEMO_BRIEF

router = APIRouter(prefix="/briefs", tags=["Ad Briefs & Payload Gate"])


@router.post("/validate", response_model=BriefValidationResponse)
async def validate_ad_brief(payload: Dict[str, Any]):
    """
    Validates a Final Ad Brief payload against strict schema and business rules
    without creating or saving any pipeline jobs.
    """
    return payload_gate_service.validate_brief(payload)


@router.get("/demo", response_model=Dict[str, Any])
async def get_demo_brief():
    """
    Returns the canonical SmartFit X1 demo brief for local demonstration and testing.
    """
    return SMARTFIT_X1_DEMO_BRIEF


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_and_validate_brief(
    payload: Dict[str, Any],
    validate_asset_now: bool = True,
    require_transparency: bool = True,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """
    Validates brief with Payload Gate, optionally validates product asset with Asset Gate,
    and persists the validated record into the database.
    """
    brief_res = payload_gate_service.validate_brief(payload)
    if not brief_res.is_valid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "message": "Brief rejected by Payload Gate.",
                "gate_name": "Payload Gate",
                "report": brief_res.report.model_dump(mode="json"),
            },
        )

    validated_dict = brief_res.validated_payload or payload
    asset_res: Optional[AssetValidationResponse] = None

    if validate_asset_now:
        images = validated_dict.get("images", [])
        if images:
            primary_url = images[0].get("url")
            if primary_url:
                asset_res = await asset_gate_service.validate_url_and_asset(
                    url=primary_url,
                    require_transparency=require_transparency,
                    allow_local_demo=True,
                )
                if not asset_res.is_valid:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail={
                            "message": "Product asset rejected by Asset Gate.",
                            "gate_name": "Asset Gate",
                            "report": asset_res.report.model_dump(mode="json"),
                        },
                    )

                # Persist asset validation record
                meta = asset_res.asset_metadata or {}
                storage_key = meta.get("storage_key")
                if not storage_key and primary_url and "/storage/" in primary_url:
                    storage_key = primary_url.split("/storage/", 1)[-1].split("?")[0].strip("/")
                    meta["storage_key"] = storage_key

                asset_record = AssetValidationRecord(
                    tenant_id=tenant.id,
                    url=primary_url,
                    storage_key=storage_key,
                    detected_mime=meta.get("detected_mime"),
                    width=meta.get("width"),
                    height=meta.get("height"),
                    aspect_ratio=meta.get("aspect_ratio"),
                    has_alpha_channel=meta.get("has_alpha_channel", False),
                    transparency_percent=meta.get("transparency_percent"),
                    file_size_bytes=meta.get("file_size_bytes"),
                    validation_status=asset_res.status.value,
                    validation_report=asset_res.report.model_dump(mode="json"),
                )
                db.add(asset_record)

        # Validate logo asset if provided in brand
        brand_data = validated_dict.get("brand", {})
        logo_url = brand_data.get("logo_url")
        if logo_url:
            stmt_logo = select(AssetValidationRecord).where(
                AssetValidationRecord.url == logo_url,
                (AssetValidationRecord.tenant_id == tenant.id) | (AssetValidationRecord.tenant_id == None),
            )
            existing_logo = (await db.execute(stmt_logo)).scalars().first()
            if not existing_logo:
                logo_res = await asset_gate_service.validate_url_and_asset(
                    url=logo_url,
                    require_transparency=False,
                    allow_local_demo=True,
                )
                if logo_res.is_valid:
                    meta_l = logo_res.asset_metadata or {}
                    logo_record = AssetValidationRecord(
                        tenant_id=tenant.id,
                        url=logo_url,
                        storage_key=meta_l.get("storage_key"),
                        detected_mime=meta_l.get("detected_mime"),
                        width=meta_l.get("width"),
                        height=meta_l.get("height"),
                        aspect_ratio=meta_l.get("aspect_ratio"),
                        has_alpha_channel=meta_l.get("has_alpha_channel", False),
                        transparency_percent=meta_l.get("transparency_percent"),
                        file_size_bytes=meta_l.get("file_size_bytes"),
                        validation_status=logo_res.status.value,
                        validation_report=logo_res.report.model_dump(mode="json"),
                    )
                    db.add(logo_record)

    # Persist validated brief
    product = validated_dict.get("product", {})
    offer = product.get("offer", {})
    brand = validated_dict.get("brand", {})
    campaign = validated_dict.get("campaign", {})

    ad_brief = AdBrief(
        tenant_id=tenant.id,
        brand_name=brand.get("name", "Unknown"),
        product_name=product.get("name", "Unknown"),
        campaign_name=campaign.get("name"),
        price=float(offer.get("price", 0.0)),
        currency=offer.get("currency", "USD"),
        platforms=campaign.get("platforms", []),
        validation_status="PASS" if brief_res.is_valid else brief_res.status.value,
        payload=validated_dict,
        validation_report=brief_res.report.model_dump(mode="json"),
    )
    db.add(ad_brief)
    await db.commit()
    await db.refresh(ad_brief)

    return {
        "id": ad_brief.id,
        "tenant_id": ad_brief.tenant_id,
        "validation_status": ad_brief.validation_status,
        "brand_name": ad_brief.brand_name,
        "product_name": ad_brief.product_name,
        "platforms": ad_brief.platforms,
        "brief_report": brief_res.report.model_dump(mode="json"),
        "asset_report": asset_res.report.model_dump(mode="json") if asset_res else None,
        "asset_result": asset_res.model_dump(mode="json") if asset_res else None,
        "created_at": ad_brief.created_at.isoformat() if ad_brief.created_at else None,
    }


@router.get("")
async def list_briefs(
    limit: int = 50,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Lists saved ad briefs scoped to the authenticated tenant."""
    stmt = (
        select(AdBrief)
        .where(AdBrief.tenant_id == tenant.id)
        .order_by(desc(AdBrief.created_at))
        .limit(limit)
    )
    result = await db.execute(stmt)
    briefs = result.scalars().all()
    return [
        {
            "id": b.id,
            "tenant_id": b.tenant_id,
            "brand_name": b.brand_name,
            "product_name": b.product_name,
            "campaign_name": b.campaign_name,
            "price": b.price,
            "currency": b.currency,
            "platforms": b.platforms,
            "validation_status": b.validation_status,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        }
        for b in briefs
    ]


@router.get("/{brief_id}")
async def get_brief(
    brief_id: str,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Fetches details of a specific ad brief scoped to the authenticated tenant."""
    stmt = select(AdBrief).where(AdBrief.id == brief_id, AdBrief.tenant_id == tenant.id)
    result = await db.execute(stmt)
    brief = result.scalar_one_or_none()
    if not brief:
        raise HTTPException(status_code=404, detail="Ad brief not found")
    return {
        "id": brief.id,
        "brand_name": brief.brand_name,
        "product_name": brief.product_name,
        "campaign_name": brief.campaign_name,
        "price": brief.price,
        "currency": brief.currency,
        "platforms": brief.platforms,
        "validation_status": brief.validation_status,
        "payload": brief.payload,
        "validation_report": brief.validation_report,
        "created_at": brief.created_at.isoformat() if brief.created_at else None,
    }
