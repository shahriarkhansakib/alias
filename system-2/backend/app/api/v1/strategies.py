from typing import Dict, Any, Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.core.database import get_db
from app.core.auth import get_current_tenant
from app.models.auth import Tenant
from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.models.job import CreativeJob, JobStatus
from app.models.strategy import CreativeStrategyRecord
from app.schemas.brief import FinalAdBriefPayload
from app.schemas.strategy import (
    CreativeStrategySpec,
    ClaimValidationReport,
    StrategyGenerationResponse,
)
from app.templates.registry import list_registered_templates, TemplateMetadata
from app.services.strategy_service import strategy_service

router = APIRouter(prefix="/strategies", tags=["Creative Strategy & Claim Gate"])


class GenerateStrategyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    brief_id: str = Field(..., min_length=1, description="ID of persisted, validated Ad Brief (required)")
    job_id: Optional[str] = Field(None, description="Optional existing CreativeJob ID to connect")


class ValidateStrategyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    brief: Dict[str, Any] = Field(..., description="Ad Brief payload for ground-truth comparison")
    strategy: Dict[str, Any] = Field(..., description="Creative strategy spec to validate")


@router.get("/templates", response_model=List[TemplateMetadata])
async def get_templates():
    """
    Returns list of all authorized advertisement layout templates in the registry.
    """
    return list_registered_templates()


@router.post("/validate")
async def validate_strategy_endpoint(req: ValidateStrategyRequest):
    """
    Purely deterministic validation of a strategy against an Ad Brief.
    Does NOT invoke any AI provider. Validates:
    - Pydantic v2 schema
    - Template registry membership
    - Price and discount consistency
    - Specification bounds
    - Ground truth claims vs hallucinated claims
    """
    try:
        brief_obj = FinalAdBriefPayload.model_validate(req.brief)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid Ad Brief structure: {str(e)}",
        )

    is_valid, spec, claim_report, schema_errors = strategy_service.validate_existing_strategy(
        brief=brief_obj,
        strategy_dict=req.strategy,
    )

    return {
        "is_valid": is_valid,
        "status": "APPROVED" if is_valid else "REJECTED",
        "strategy": spec.model_dump(mode="json") if spec else None,
        "claim_report": claim_report.model_dump(mode="json"),
        "schema_errors": schema_errors,
    }


@router.post("/generate", response_model=StrategyGenerationResponse)
async def generate_creative_strategy(
    req: GenerateStrategyRequest,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """
    Generates a structured Creative Strategy strictly from a persisted and validated Ad Brief:
    1. Loads persisted AdBrief by brief_id scoped to the authenticated tenant.
    2. Verifies AdBrief validation_status == 'PASS'.
    3. Verifies required product image asset exists.
    4. Verifies corresponding AssetValidationRecord exists with validation_status == 'PASS'.
    5. Connects or creates authoritative CreativeJob state machine.
    6. Generates strategy via provider with deterministic retry diagnostics.
    7. Validates strategy against Claim Gate and Template Registry.
    8. Updates CreativeJob and persists non-orphan CreativeStrategyRecord.
    """
    # 1. Load persisted AdBrief scoped to current tenant
    stmt = select(AdBrief).where(AdBrief.id == req.brief_id, AdBrief.tenant_id == tenant.id)
    result = await db.execute(stmt)
    ad_brief_record = result.scalar_one_or_none()
    if not ad_brief_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Ad Brief '{req.brief_id}' not found.",
        )

    # 2. Verify brief validation status
    if ad_brief_record.validation_status != "PASS":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ad Brief '{req.brief_id}' has not passed Payload validation (status: {ad_brief_record.validation_status}).",
        )

    try:
        brief_obj = FinalAdBriefPayload.model_validate(ad_brief_record.payload)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Persisted brief payload corrupt or invalid: {str(e)}",
        )

    # 3. Verify required product asset exists in brief
    images = ad_brief_record.payload.get("images", [])
    if not images or not images[0].get("url"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ad Brief '{req.brief_id}' does not contain required product image asset.",
        )
    primary_asset_url = images[0]["url"]

    # 4. Verify corresponding AssetValidationRecord exists and passed
    stmt_asset = (
        select(AssetValidationRecord)
        .where(
            AssetValidationRecord.url == primary_asset_url,
            (AssetValidationRecord.tenant_id == tenant.id) | (AssetValidationRecord.tenant_id == None),
        )
        .order_by(desc(AssetValidationRecord.created_at))
    )
    asset_record = (await db.execute(stmt_asset)).scalars().first()
    if not asset_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Product asset '{primary_asset_url}' has not been validated by Asset Gate.",
        )
    if asset_record.validation_status not in ["PASS", "WARNING"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Product asset '{primary_asset_url}' failed Asset Gate validation (status: {asset_record.validation_status}).",
        )

    # 5. Connect or create authoritative CreativeJob
    creative_job: Optional[CreativeJob] = None
    if req.job_id:
        stmt_job = select(CreativeJob).where(
            CreativeJob.id == req.job_id,
            CreativeJob.tenant_id == tenant.id,
        )
        creative_job = (await db.execute(stmt_job)).scalar_one_or_none()
        if not creative_job:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"CreativeJob '{req.job_id}' not found.",
            )
        creative_job.brief_id = ad_brief_record.id
    else:
        creative_job = CreativeJob(
            tenant_id=tenant.id,
            brief_id=ad_brief_record.id,
            status=JobStatus.ASSET_CHECK.value,
            current_stage="Asset Check Passed",
            progress_pct=25,
            brief_data=ad_brief_record.payload,
        )
        db.add(creative_job)
        await db.flush()

    # Transition to STRATEGY_GENERATING via authoritative state machine
    try:
        creative_job.transition_to(
            JobStatus.STRATEGY_GENERATING,
            stage_name="Generating Creative Strategy",
            progress_pct=30,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot generate strategy: invalid job transition ({str(e)})",
        )

    # 6. Execute Strategy Pipeline with Claim Gate and contextual retries
    strat_status, spec, claim_report, retry_count = await strategy_service.generate_and_validate_strategy(
        brief=brief_obj,
        max_retries=3,
    )

    created_id: Optional[str] = None
    created_at_str: Optional[str] = None

    if strat_status == "APPROVED" and spec:
        # Record successful generation transition
        creative_job.transition_to(
            JobStatus.STRATEGY_GENERATED,
            stage_name="Strategy Spec Generated",
            progress_pct=35,
        )

        # Persist strategy record
        record = CreativeStrategyRecord(
            tenant_id=tenant.id,
            brief_id=ad_brief_record.id,
            version_number=1,
            status=strat_status,
            model_provider="mock",
            model_name="mock-strategist-v1",
            template_id=spec.template_id,
            strategy_spec=spec.model_dump(mode="json"),
            claim_validation_report=claim_report.model_dump(mode="json"),
            retry_count=retry_count,
        )
        db.add(record)
        await db.flush()
        created_id = record.id
        created_at_str = record.created_at.isoformat() if record.created_at else None

        # Authoritative transition to STRATEGY_VALIDATED
        creative_job.transition_to(
            JobStatus.STRATEGY_VALIDATED,
            stage_name="Strategy Validated & Approved",
            progress_pct=40,
            stage_data={
                "strategy_id": created_id,
                "template_id": spec.template_id,
                "retry_count": retry_count,
            },
        )
        creative_job.strategy_id = created_id
    else:
        # Generation or validation failed
        creative_job.transition_to(
            JobStatus.FAILED,
            stage_name="Strategy Generation Failed Claim Gate",
            error_details=claim_report.model_dump(mode="json"),
        )

    await db.commit()
    await db.refresh(creative_job)

    return StrategyGenerationResponse(
        status=strat_status,
        strategy=spec,
        claim_report=claim_report,
        retry_count=retry_count,
        strategy_id=created_id,
        job_id=creative_job.id,
        created_at=created_at_str,
    )


@router.get("/{strategy_id}")
async def get_strategy(
    strategy_id: str,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """Fetches details of a creative strategy scoped to the authenticated tenant."""
    stmt = select(CreativeStrategyRecord).where(
        CreativeStrategyRecord.id == strategy_id,
        CreativeStrategyRecord.tenant_id == tenant.id,
    )
    strategy = (await db.execute(stmt)).scalar_one_or_none()
    if not strategy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"CreativeStrategy with id '{strategy_id}' not found.",
        )
    return {
        "id": strategy.id,
        "tenant_id": strategy.tenant_id,
        "brief_id": strategy.brief_id,
        "version_number": strategy.version_number,
        "status": strategy.status,
        "template_id": strategy.template_id,
        "strategy_spec": strategy.strategy_spec,
        "claim_validation_report": strategy.claim_validation_report,
        "retry_count": strategy.retry_count,
        "created_at": strategy.created_at.isoformat() if strategy.created_at else None,
    }

