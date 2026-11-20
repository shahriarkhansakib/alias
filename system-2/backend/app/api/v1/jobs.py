"""
Job Management and Status Polling API Routes.
Allows clients to inspect authoritative job progression, retrieve stage output references,
and dispatch stages asynchronously.
"""

from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.core.database import get_db
from app.core.auth import get_current_tenant
from app.models.auth import Tenant
from app.models.job import CreativeJob
from app.models.background import GeneratedBackgroundRecord
from app.models.composite import CompositedCreativeRecord
from app.models.final_ad import FinalRenderedCreativeRecord
from app.workers.dispatcher import get_job_dispatcher

router = APIRouter(prefix="/jobs", tags=["Jobs"])


class JobStatusResponse(BaseModel):
    id: str
    brief_id: Optional[str] = None
    strategy_id: Optional[str] = None
    status: str
    current_stage: str
    progress_pct: int
    stage_data: Optional[Dict[str, Any]] = None
    error_details: Optional[Dict[str, Any]] = None
    resource_ids: Dict[str, Optional[str]] = Field(default_factory=dict)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class JobDispatchRequest(BaseModel):
    stage: str
    params: Optional[Dict[str, Any]] = None


class JobDispatchResponse(BaseModel):
    job_id: str
    task_id: str
    status: str
    stage: str


@router.get("/{job_id}", response_model=JobStatusResponse)
async def get_job_status(
    job_id: str,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """
    Authoritative polling endpoint for creative jobs.
    Returns lifecycle status, progression percentage, error diagnostics,
    and references to generated creative assets scoped to the tenant.
    """
    stmt = select(CreativeJob).where(
        CreativeJob.id == job_id,
        CreativeJob.tenant_id == tenant.id,
    )
    job = (await db.execute(stmt)).scalar_one_or_none()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job '{job_id}' not found.",
        )

    # Collect latest output resource references
    bg_stmt = (
        select(GeneratedBackgroundRecord.id)
        .where(GeneratedBackgroundRecord.job_id == job.id)
        .order_by(desc(GeneratedBackgroundRecord.created_at))
    )
    latest_bg_id = (await db.execute(bg_stmt)).scalars().first()

    comp_stmt = (
        select(CompositedCreativeRecord.id)
        .where(CompositedCreativeRecord.job_id == job.id)
        .order_by(desc(CompositedCreativeRecord.created_at))
    )
    latest_comp_id = (await db.execute(comp_stmt)).scalars().first()

    final_stmt = (
        select(FinalRenderedCreativeRecord.id)
        .where(FinalRenderedCreativeRecord.job_id == job.id)
        .order_by(desc(FinalRenderedCreativeRecord.created_at))
    )
    latest_final_id = (await db.execute(final_stmt)).scalars().first()

    return JobStatusResponse(
        id=job.id,
        brief_id=job.brief_id,
        strategy_id=job.strategy_id,
        status=job.status,
        current_stage=job.current_stage,
        progress_pct=job.progress_pct,
        stage_data=job.stage_data,
        error_details=job.error_details,
        resource_ids={
            "background_id": latest_bg_id,
            "composite_id": latest_comp_id,
            "final_ad_id": latest_final_id,
        },
        created_at=job.created_at.isoformat() if job.created_at else None,
        updated_at=job.updated_at.isoformat() if job.updated_at else None,
    )


@router.post("/{job_id}/dispatch", response_model=JobDispatchResponse)
async def dispatch_job_stage(
    job_id: str,
    req: JobDispatchRequest,
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
):
    """
    Asynchronously dispatches a creative generation stage to the configured worker.
    Immediately returns a dispatch task ID without blocking the HTTP connection.
    Enforces that the job belongs to the authenticated tenant.
    """
    stmt = select(CreativeJob).where(
        CreativeJob.id == job_id,
        CreativeJob.tenant_id == tenant.id,
    )
    job = (await db.execute(stmt)).scalar_one_or_none()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job '{job_id}' not found.",
        )

    dispatcher = get_job_dispatcher()
    task_id = await dispatcher.dispatch(
        job_id=job.id,
        stage=req.stage,
        params=req.params,
    )

    return JobDispatchResponse(
        job_id=job.id,
        task_id=task_id,
        status="QUEUED",
        stage=req.stage,
    )
