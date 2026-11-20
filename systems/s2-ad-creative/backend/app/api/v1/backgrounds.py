from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import logger
from app.core.auth import get_current_tenant
from app.models.auth import Tenant
from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.models.strategy import CreativeStrategyRecord
from app.models.background import GeneratedBackgroundRecord
from app.schemas.background import (
    BackgroundGenerateRequest,
    BackgroundRegenerateRequest,
    BackgroundResponse,
    BackgroundQAResult,
    BackgroundGenerationPrompt,
    QAStatus,
)
from app.services.background_service import BackgroundService
from app.providers.storage_provider import get_storage_provider


router = APIRouter(prefix="/backgrounds", tags=["Phase 4: AI Background Generation"])


@router.post("/generate", response_model=BackgroundResponse, status_code=status.HTTP_200_OK)
async def generate_background(
    request: BackgroundGenerateRequest,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """
    Phase 4 AI Visual Environment / Background Generation.
    Strictly requires an approved CreativeStrategyRecord and verified CreativeJob.
    Cannot accept arbitrary raw brief payloads and cannot bypass Phase 1, 2, or 3 gates.
    """
    logger.info(f"Received background generation request for strategy: {request.strategy_id}, platform: {request.platform.value}")

    # 1. Verify Strategy Gate scoped to authenticated tenant
    stmt_strat = select(CreativeStrategyRecord).where(
        CreativeStrategyRecord.id == request.strategy_id,
        CreativeStrategyRecord.tenant_id == tenant.id,
    )
    strategy = (await db.execute(stmt_strat)).scalar_one_or_none()
    if not strategy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"CreativeStrategy with id '{request.strategy_id}' not found.",
        )

    if strategy.status != "APPROVED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"CreativeStrategy '{request.strategy_id}' status is '{strategy.status}'. Only 'APPROVED' strategies can proceed to background generation.",
        )

    # 2. Verify Brief & Asset Gate Integrity
    brief = await db.get(AdBrief, strategy.brief_id)
    if not brief or brief.validation_status != "PASS":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The underlying brief has not passed Payload validation. Pipeline gate compromised.",
        )

    primary_url = brief.payload.get("images", [{}])[0].get("url")
    if primary_url:
        stmt_asset = (
            select(AssetValidationRecord)
            .where(AssetValidationRecord.url == primary_url)
            .order_by(desc(AssetValidationRecord.created_at))
        )
        asset_record = (await db.execute(stmt_asset)).scalars().first()
        if not asset_record or asset_record.validation_status not in ["PASS", "WARNING"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The underlying product asset has not passed Asset Gate validation. Pipeline gate compromised.",
            )

    # 3. Execute Background Generation & Deterministic QA Pipeline
    record = await BackgroundService.generate_background(
        db=db,
        strategy_id=request.strategy_id,
        platform=request.platform,
        force_regenerate=request.force_regenerate,
        generation_params=request.generation_params,
    )

    # 4. Resolve Storage URL
    storage = get_storage_provider()
    image_url = await storage.get_public_url(record.storage_key)

    gen_params = (
        record.prompt_spec.get("metadata", {}).get("generation_params")
        if isinstance(record.prompt_spec, dict)
        else None
    )

    return BackgroundResponse(
        id=record.id,
        job_id=record.job_id,
        strategy_id=record.strategy_id,
        platform=record.platform,
        width=record.width,
        height=record.height,
        aspect_ratio=record.aspect_ratio,
        image_url=image_url,
        qa_status=QAStatus(record.qa_status),
        qa_result=BackgroundQAResult.model_validate(record.qa_result),
        attempt_number=record.attempt_number,
        prompt=BackgroundGenerationPrompt.model_validate(record.prompt_spec),
        provider=record.provider,
        model_name=record.model_name,
        generation_params=gen_params,
        is_cached=getattr(record, "is_cached", False),
        created_at=record.created_at.isoformat(),
    )


@router.get("/{background_id}", response_model=BackgroundResponse, status_code=status.HTTP_200_OK)
async def get_background(
    background_id: str,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """
    Retrieves generated background metadata, storage URL, and QA diagnostics scoped to the tenant.
    """
    stmt = select(GeneratedBackgroundRecord).where(
        GeneratedBackgroundRecord.id == background_id,
        GeneratedBackgroundRecord.tenant_id == tenant.id,
    )
    record = (await db.execute(stmt)).scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"GeneratedBackgroundRecord '{background_id}' not found.",
        )

    storage = get_storage_provider()
    image_url = await storage.get_public_url(record.storage_key)

    gen_params = (
        record.prompt_spec.get("metadata", {}).get("generation_params")
        if isinstance(record.prompt_spec, dict)
        else None
    )

    return BackgroundResponse(
        id=record.id,
        job_id=record.job_id,
        strategy_id=record.strategy_id,
        platform=record.platform,
        width=record.width,
        height=record.height,
        aspect_ratio=record.aspect_ratio,
        image_url=image_url,
        qa_status=QAStatus(record.qa_status),
        qa_result=BackgroundQAResult.model_validate(record.qa_result),
        attempt_number=record.attempt_number,
        prompt=BackgroundGenerationPrompt.model_validate(record.prompt_spec),
        provider=record.provider,
        model_name=record.model_name,
        generation_params=gen_params,
        is_cached=getattr(record, "is_cached", False),
        created_at=record.created_at.isoformat(),
    )


@router.post("/{background_id}/regenerate", response_model=BackgroundResponse, status_code=status.HTTP_200_OK)
async def regenerate_background(
    background_id: str,
    request: BackgroundRegenerateRequest,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """
    Triggers targeted diagnostic-aware regeneration for an existing background record.
    Preserves creative strategy and brief facts while tuning visual environment generation.
    """
    logger.info(f"Targeted regeneration requested for background record: {background_id}")
    stmt = select(GeneratedBackgroundRecord).where(
        GeneratedBackgroundRecord.id == background_id,
        GeneratedBackgroundRecord.tenant_id == tenant.id,
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"GeneratedBackgroundRecord '{background_id}' not found.",
        )

    new_record = await BackgroundService.regenerate_background(
        db=db,
        background_id=background_id,
        custom_feedback=request.custom_feedback,
        generation_params=request.generation_params,
    )

    storage = get_storage_provider()
    image_url = await storage.get_public_url(new_record.storage_key)

    gen_params = (
        new_record.prompt_spec.get("metadata", {}).get("generation_params")
        if isinstance(new_record.prompt_spec, dict)
        else None
    )

    return BackgroundResponse(
        id=new_record.id,
        job_id=new_record.job_id,
        strategy_id=new_record.strategy_id,
        platform=new_record.platform,
        width=new_record.width,
        height=new_record.height,
        aspect_ratio=new_record.aspect_ratio,
        image_url=image_url,
        qa_status=QAStatus(new_record.qa_status),
        qa_result=BackgroundQAResult.model_validate(new_record.qa_result),
        attempt_number=new_record.attempt_number,
        prompt=BackgroundGenerationPrompt.model_validate(new_record.prompt_spec),
        provider=new_record.provider,
        model_name=new_record.model_name,
        generation_params=gen_params,
        is_cached=getattr(new_record, "is_cached", False),
        created_at=new_record.created_at.isoformat(),
    )
