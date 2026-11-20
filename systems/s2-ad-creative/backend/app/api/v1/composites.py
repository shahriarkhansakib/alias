from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import logger
from app.core.auth import get_current_tenant
from app.models.auth import Tenant
from app.models.background import GeneratedBackgroundRecord
from app.models.composite import CompositedCreativeRecord
from app.schemas.background import QAStatus
from app.schemas.composite import (
    CompositeGenerateRequest,
    CompositeRegenerateRequest,
    CompositeResponse,
    CompositeQAResult,
)
from app.schemas.platform import TargetPlatform
from app.services.composite_service import CompositeService
from app.providers.storage_provider import get_storage_provider


router = APIRouter(prefix="/composites", tags=["Phase 5: Product Cutout & Compositing"])


@router.post("/generate", response_model=CompositeResponse, status_code=status.HTTP_200_OK)
async def generate_composite(
    request: CompositeGenerateRequest,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """
    Phase 5 Product Cutout Extraction & Compositing.
    Places the authentic customer product asset onto the approved AI background.
    Strictly enforces all preceding pipeline gates (Brief PASS, Asset PASS, Strategy APPROVED, Background PASS/WARNING).
    """
    logger.info(f"Received product compositing request for background: {request.background_id}")

    # Verify background exists and belongs to the authenticated tenant
    stmt_bg = select(GeneratedBackgroundRecord).where(
        GeneratedBackgroundRecord.id == request.background_id,
        GeneratedBackgroundRecord.tenant_id == tenant.id,
    )
    bg = (await db.execute(stmt_bg)).scalar_one_or_none()
    if not bg:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"GeneratedBackgroundRecord with id '{request.background_id}' not found.",
        )

    record = await CompositeService.composite_product(
        db=db,
        background_id=request.background_id,
        product_image_url=request.product_image_url,
        placement_config=request.placement,
        shadow_config=request.shadow,
        force_regenerate=request.force_regenerate,
    )

    storage = get_storage_provider()
    image_url = await storage.get_public_url(record.storage_key)
    cutout_url = await storage.get_public_url(record.cutout_storage_key) if record.cutout_storage_key else None

    return CompositeResponse(
        id=record.id,
        job_id=record.job_id,
        strategy_id=record.strategy_id,
        brief_id=record.brief_id,
        background_id=record.background_id,
        platform=TargetPlatform(record.platform),
        width=record.width,
        height=record.height,
        aspect_ratio=record.aspect_ratio,
        image_url=image_url,
        cutout_url=cutout_url,
        placement_spec=record.placement_spec,
        shadow_spec=record.shadow_spec,
        integrity_metadata=record.integrity_metadata,
        qa_status=QAStatus(record.qa_status),
        qa_result=CompositeQAResult.model_validate(record.qa_result),
        attempt_number=record.attempt_number,
        is_cached=getattr(record, "is_cached", False),
        created_at=record.created_at.isoformat(),
    )


@router.get("/{composite_id}", response_model=CompositeResponse, status_code=status.HTTP_200_OK)
async def get_composite(
    composite_id: str,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """
    Retrieves composited creative metadata, storage URL, and QA diagnostics scoped to the tenant.
    """
    stmt = select(CompositedCreativeRecord).where(
        CompositedCreativeRecord.id == composite_id,
        CompositedCreativeRecord.tenant_id == tenant.id,
    )
    record = (await db.execute(stmt)).scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"CompositedCreativeRecord with id '{composite_id}' not found.",
        )

    storage = get_storage_provider()
    image_url = await storage.get_public_url(record.storage_key)
    cutout_url = await storage.get_public_url(record.cutout_storage_key) if record.cutout_storage_key else None

    return CompositeResponse(
        id=record.id,
        job_id=record.job_id,
        strategy_id=record.strategy_id,
        brief_id=record.brief_id,
        background_id=record.background_id,
        platform=TargetPlatform(record.platform),
        width=record.width,
        height=record.height,
        aspect_ratio=record.aspect_ratio,
        image_url=image_url,
        cutout_url=cutout_url,
        placement_spec=record.placement_spec,
        shadow_spec=record.shadow_spec,
        integrity_metadata=record.integrity_metadata,
        qa_status=QAStatus(record.qa_status),
        qa_result=CompositeQAResult.model_validate(record.qa_result),
        attempt_number=record.attempt_number,
        is_cached=getattr(record, "is_cached", False),
        created_at=record.created_at.isoformat(),
    )


@router.post("/{composite_id}/regenerate", response_model=CompositeResponse, status_code=status.HTTP_200_OK)
async def regenerate_composite(
    composite_id: str,
    request: CompositeRegenerateRequest,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """
    Deterministically recomposites an existing creative with modified parameters.
    Does NOT regenerate background or modify creative strategy.
    """
    logger.info(f"Targeted recompositing requested for composite: {composite_id}")
    stmt = select(CompositedCreativeRecord).where(
        CompositedCreativeRecord.id == composite_id,
        CompositedCreativeRecord.tenant_id == tenant.id,
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"CompositedCreativeRecord with id '{composite_id}' not found.",
        )

    new_record = await CompositeService.recomposite_product(
        db=db,
        composite_id=composite_id,
        product_image_url=request.product_image_url,
        placement_config=request.placement,
        shadow_config=request.shadow,
        custom_feedback=request.custom_feedback,
    )

    storage = get_storage_provider()
    image_url = await storage.get_public_url(new_record.storage_key)
    cutout_url = await storage.get_public_url(new_record.cutout_storage_key) if new_record.cutout_storage_key else None

    return CompositeResponse(
        id=new_record.id,
        job_id=new_record.job_id,
        strategy_id=new_record.strategy_id,
        brief_id=new_record.brief_id,
        background_id=new_record.background_id,
        platform=TargetPlatform(new_record.platform),
        width=new_record.width,
        height=new_record.height,
        aspect_ratio=new_record.aspect_ratio,
        image_url=image_url,
        cutout_url=cutout_url,
        placement_spec=new_record.placement_spec,
        shadow_spec=new_record.shadow_spec,
        integrity_metadata=new_record.integrity_metadata,
        qa_status=QAStatus(new_record.qa_status),
        qa_result=CompositeQAResult.model_validate(new_record.qa_result),
        attempt_number=new_record.attempt_number,
        is_cached=getattr(new_record, "is_cached", False),
        created_at=new_record.created_at.isoformat(),
    )
