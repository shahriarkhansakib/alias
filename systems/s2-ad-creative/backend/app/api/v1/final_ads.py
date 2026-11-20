from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.core.database import get_db
from app.core.logging import logger
from app.core.auth import get_current_tenant
from app.models.auth import Tenant
from app.models.composite import CompositedCreativeRecord
from app.models.final_ad import FinalRenderedCreativeRecord
from app.models.job import CreativeJob, JobStatus
from app.schemas.background import QAStatus
from app.schemas.final_ad import (
    FinalAdGenerateRequest,
    FinalAdRegenerateRequest,
    FinalAdResponse,
    FinalAdQAResult,
    TypographyStyle,
    CTAStyle,
    PriceBadgeStyle,
    ReadabilityEnhancementConfig,
)
from app.schemas.platform import TargetPlatform
from app.services.final_ad_service import FinalAdService
from app.providers.storage_provider import get_storage_provider


router = APIRouter(prefix="/final-ads", tags=["Phase 6: Deterministic Final Advertisement Rendering"])


class FinalAdApprovalResponse(BaseModel):
    approved: bool
    message: str
    final_ad_id: str
    job_id: str
    qa_status: str
    vision_qa_status: str


async def _serialize_final_ad_response(
    record: FinalRenderedCreativeRecord,
    storage=None,
) -> FinalAdResponse:
    storage = storage or get_storage_provider()
    image_url = await storage.get_public_url(record.storage_key)
    return FinalAdResponse(
        id=record.id,
        job_id=record.job_id,
        strategy_id=record.strategy_id,
        brief_id=record.brief_id,
        composite_id=record.composite_id,
        background_id=record.background_id,
        platform=TargetPlatform(record.platform),
        width=record.width,
        height=record.height,
        aspect_ratio=record.aspect_ratio,
        image_url=image_url,
        copy_spec=record.copy_spec,
        typography_spec=record.typography_spec,
        cta_spec=record.cta_spec,
        logo_spec=record.logo_spec,
        price_badge_spec=record.price_badge_spec,
        readability_spec=record.readability_spec,
        provenance_chain=record.provenance_chain,
        qa_status=QAStatus(record.qa_status),
        qa_result=FinalAdQAResult.model_validate(record.qa_result),
        attempt_number=record.attempt_number,
        is_cached=record.is_cached,
        created_at=record.created_at.isoformat() if hasattr(record.created_at, "isoformat") else str(record.created_at),
        vision_qa_status=record.vision_qa_status,
        vision_qa_result=record.vision_qa_result,
        is_stale=record.is_stale,
    )


@router.post("/generate", response_model=FinalAdResponse, status_code=status.HTTP_200_OK)
async def generate_final_ad(
    request: FinalAdGenerateRequest,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """
    Phase 6 Deterministic Final Advertisement Rendering.
    Overlays approved typography, CTA, brand elements, and price badges onto the approved composite.
    Strictly enforces all preceding pipeline gates (Brief, Asset, Strategy, Background, Composite).
    """
    logger.info(f"Received final ad render request for composite: {request.composite_id}")

    # Verify composite exists and belongs to the authenticated tenant
    stmt_comp = select(CompositedCreativeRecord).where(
        CompositedCreativeRecord.id == request.composite_id,
        CompositedCreativeRecord.tenant_id == tenant.id,
    )
    comp = (await db.execute(stmt_comp)).scalar_one_or_none()
    if not comp:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"CompositedCreativeRecord with id '{request.composite_id}' not found.",
        )

    record = await FinalAdService.render_final_ad(
        db=db,
        composite_id=request.composite_id,
        typography_style=request.typography,
        cta_style=request.cta,
        price_badge_style=request.price_badge,
        readability_config=request.readability,
        force_regenerate=request.force_regenerate,
    )

    return await _serialize_final_ad_response(record)


@router.get("/{final_ad_id}", response_model=FinalAdResponse, status_code=status.HTTP_200_OK)
async def get_final_ad(
    final_ad_id: str,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Retrieves a persisted FinalRenderedCreativeRecord by ID scoped to the tenant."""
    stmt = select(FinalRenderedCreativeRecord).where(
        FinalRenderedCreativeRecord.id == final_ad_id,
        FinalRenderedCreativeRecord.tenant_id == tenant.id,
    )
    record = (await db.execute(stmt)).scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"FinalRenderedCreativeRecord with id '{final_ad_id}' not found.",
        )

    return await _serialize_final_ad_response(record)


@router.post("/{final_ad_id}/regenerate", response_model=FinalAdResponse, status_code=status.HTTP_200_OK)
async def regenerate_final_ad(
    final_ad_id: str,
    request: FinalAdRegenerateRequest,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """
    Deterministic layout recomposition for Phase 6.
    Re-renders typography, CTA, and badge elements with updated parameters.
    Bypasses cache and generates a new attempt.
    """
    stmt = select(FinalRenderedCreativeRecord).where(
        FinalRenderedCreativeRecord.id == final_ad_id,
        FinalRenderedCreativeRecord.tenant_id == tenant.id,
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"FinalRenderedCreativeRecord with id '{final_ad_id}' not found.",
        )

    clean_typo = {k: v for k, v in existing.typography_spec.items() if k != "script_analysis"} if existing.typography_spec else {}
    typo_style = request.typography or (TypographyStyle.model_validate(clean_typo) if clean_typo else None)
    cta_style = request.cta or (CTAStyle.model_validate(existing.cta_spec.get("style", {})) if existing.cta_spec else None)
    badge_style = request.price_badge or (PriceBadgeStyle() if existing.price_badge_spec else None)
    read_cfg = request.readability or ReadabilityEnhancementConfig()

    record = await FinalAdService.render_final_ad(
        db=db,
        composite_id=existing.composite_id,
        typography_style=typo_style,
        cta_style=cta_style,
        price_badge_style=badge_style,
        readability_config=read_cfg,
        force_regenerate=True,
    )

    return await _serialize_final_ad_response(record)


@router.post("/{final_ad_id}/approve", response_model=FinalAdApprovalResponse, status_code=status.HTTP_200_OK)
async def approve_final_ad(
    final_ad_id: str,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """
    Authoritative approval endpoint for the final advertisement.
    Enforces tenant scoping, stale checking, deterministic verification, and vision QA policy.
    Blocks approval if the artifact is stale, deterministically invalid, or failed vision verification.
    """
    stmt = select(FinalRenderedCreativeRecord).where(
        FinalRenderedCreativeRecord.id == final_ad_id,
        FinalRenderedCreativeRecord.tenant_id == tenant.id,
    )
    record = (await db.execute(stmt)).scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"FinalRenderedCreativeRecord with id '{final_ad_id}' not found.",
        )

    can_approve, reason = FinalAdService.evaluate_approval(record)
    if not can_approve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Approval rejected: {reason}",
        )

    # Transition associated CreativeJob to COMPLETED
    job = await db.get(CreativeJob, record.job_id)
    if job and job.tenant_id == tenant.id:
        if job.status != JobStatus.COMPLETED.value:
            job.transition_to(
                JobStatus.COMPLETED,
                stage_name="Advertisement Approved and Finalized",
                progress_pct=100,
                stage_data={
                    "approved_final_ad_id": record.id,
                    "storage_key": record.storage_key,
                },
            )
            await db.commit()

    return FinalAdApprovalResponse(
        approved=True,
        message="Final advertisement approved successfully.",
        final_ad_id=record.id,
        job_id=record.job_id,
        qa_status=record.qa_status,
        vision_qa_status=record.vision_qa_status or "NOT_RUN",
    )
