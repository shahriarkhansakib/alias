"""
Authoritative Job Stage Execution Engine.
Coordinates creative services, state machine transitions, idempotency checks,
and clean database transaction boundaries. Shared across InProcess and Celery dispatchers.
"""

import time
from typing import Optional, Dict, Any
from sqlalchemy import select, desc
from app.core.database import AsyncSessionLocal
from app.core.logging import logger
from app.models.job import CreativeJob, JobStatus
from app.models.strategy import CreativeStrategyRecord
from app.models.background import GeneratedBackgroundRecord
from app.models.composite import CompositedCreativeRecord
from app.models.final_ad import FinalRenderedCreativeRecord
from app.schemas.platform import TargetPlatform
from app.services.background_service import BackgroundService
from app.services.composite_service import CompositeService
from app.services.final_ad_service import FinalAdService


async def execute_job_stage(
    job_id: str,
    stage: str,
    params: Optional[Dict[str, Any]] = None,
    db: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Executes a discrete stage of the creative pipeline with strict idempotency,
    transaction boundary protection, and canonical state machine enforcement.
    """
    params = params or {}
    start_time = time.time()
    logger.info(f"Worker beginning stage '{stage}' for job '{job_id}'")

    if db is not None:
        return await _run_stage(db, job_id, stage, params, start_time)

    async with AsyncSessionLocal() as session:
        return await _run_stage(session, job_id, stage, params, start_time)


async def _run_stage(
    db: Any,
    job_id: str,
    stage: str,
    params: Dict[str, Any],
    start_time: float,
) -> Dict[str, Any]:
    job = await db.get(CreativeJob, job_id)
    if not job:
        raise ValueError(f"Job '{job_id}' not found in database.")

    # Security: Authoritative tenant verification
    # Workers must never trust client-supplied tenant_id in task payload
    forged_tenant = params.get("tenant_id")
    if forged_tenant and forged_tenant != job.tenant_id:
        raise ValueError(
            f"Tenant spoofing detected: payload tenant '{forged_tenant}' does not match authoritative job tenant '{job.tenant_id}'."
        )

    stage_upper = stage.upper()

    # =========================================================================
    # 1. BACKGROUND GENERATION STAGE
    # =========================================================================
    if stage_upper == "BACKGROUND":
        platform_str = params.get("platform", "instagram")
        platform_enum = TargetPlatform(platform_str)
        strategy_id = params.get("strategy_id") or job.strategy_id

        if not strategy_id:
            raise ValueError(f"Job '{job_id}' has no strategy_id associated.")

        # Idempotency check: see if an approved background already exists
        existing_bg_stmt = (
            select(GeneratedBackgroundRecord)
            .where(
                GeneratedBackgroundRecord.job_id == job.id,
                GeneratedBackgroundRecord.strategy_id == strategy_id,
                GeneratedBackgroundRecord.platform == platform_enum.value,
                GeneratedBackgroundRecord.qa_status.in_(["PASS", "WARNING"]),
            )
            .order_by(desc(GeneratedBackgroundRecord.created_at))
        )
        existing_bg = (await db.execute(existing_bg_stmt)).scalars().first()
        if existing_bg and not params.get("force_regenerate"):
            logger.info(f"Idempotent worker execution: returning existing background '{existing_bg.id}' for job '{job.id}'")
            return {
                "job_id": job.id,
                "stage": stage,
                "status": job.status,
                "resource_id": existing_bg.id,
                "duration_s": round(time.time() - start_time, 3),
                "is_cached": True,
            }

        # Execute via existing authoritative BackgroundService
        bg_record = await BackgroundService.generate_background(
            db=db,
            strategy_id=strategy_id,
            platform=platform_enum,
            force_regenerate=params.get("force_regenerate", False),
            generation_params=params.get("generation_params"),
        )
        return {
            "job_id": job.id,
            "stage": stage,
            "status": "BACKGROUND_APPROVED",
            "resource_id": bg_record.id,
            "duration_s": round(time.time() - start_time, 3),
            "is_cached": bg_record.is_cached,
        }

    # =========================================================================
    # 2. PRODUCT CUTOUT STAGE
    # =========================================================================
    elif stage_upper == "CUTOUT":
        cutout_bytes, cutout_key = await CompositeService.extract_and_validate_cutout(
            db=db,
            job_id=job.id,
        )
        return {
            "job_id": job.id,
            "stage": stage,
            "status": job.status,
            "resource_id": cutout_key,
            "duration_s": round(time.time() - start_time, 3),
        }

    # =========================================================================
    # 3. COMPOSITING STAGE
    # =========================================================================
    elif stage_upper == "COMPOSITE":
        background_id = params.get("background_id")
        if not background_id:
            # Find latest background for this job
            bg_stmt = (
                select(GeneratedBackgroundRecord)
                .where(GeneratedBackgroundRecord.job_id == job.id)
                .order_by(desc(GeneratedBackgroundRecord.created_at))
            )
            bg_rec = (await db.execute(bg_stmt)).scalars().first()
            if not bg_rec:
                raise ValueError(f"No background found for job '{job.id}'")
            background_id = bg_rec.id
        else:
            bg_chk = await db.get(GeneratedBackgroundRecord, background_id)
            if bg_chk and bg_chk.tenant_id and job.tenant_id and bg_chk.tenant_id != job.tenant_id:
                raise ValueError("Referenced background belongs to another tenant.")

        platform_str = params.get("platform", "instagram")
        platform_enum = TargetPlatform(platform_str)

        # Idempotency check: see if an approved composite already exists
        existing_comp_stmt = (
            select(CompositedCreativeRecord)
            .where(
                CompositedCreativeRecord.job_id == job.id,
                CompositedCreativeRecord.background_id == background_id,
                CompositedCreativeRecord.platform == platform_enum.value,
                CompositedCreativeRecord.qa_status.in_(["PASS", "WARNING"]),
            )
            .order_by(desc(CompositedCreativeRecord.created_at))
        )
        existing_comp = (await db.execute(existing_comp_stmt)).scalars().first()
        if existing_comp and not params.get("force_regenerate"):
            logger.info(f"Idempotent worker execution: returning existing composite '{existing_comp.id}' for job '{job.id}'")
            return {
                "job_id": job.id,
                "stage": stage,
                "status": job.status,
                "resource_id": existing_comp.id,
                "duration_s": round(time.time() - start_time, 3),
                "is_cached": True,
            }

        comp_record = await CompositeService.composite_product(
            db=db,
            background_id=background_id,
            placement_config=params.get("placement"),
            shadow_config=params.get("shadow"),
            force_regenerate=params.get("force_regenerate", False),
        )
        return {
            "job_id": job.id,
            "stage": stage,
            "status": "COMPOSITE_APPROVED",
            "resource_id": comp_record.id,
            "duration_s": round(time.time() - start_time, 3),
            "is_cached": comp_record.is_cached,
        }

    # =========================================================================
    # 4. FINAL AD RENDERING STAGE
    # =========================================================================
    elif stage_upper in ("FINAL_AD", "FINAL_RENDERING"):
        composite_id = params.get("composite_id")
        if not composite_id:
            comp_stmt = (
                select(CompositedCreativeRecord)
                .where(CompositedCreativeRecord.job_id == job.id)
                .order_by(desc(CompositedCreativeRecord.created_at))
            )
            comp_rec = (await db.execute(comp_stmt)).scalars().first()
            if not comp_rec:
                raise ValueError(f"No composite found for job '{job.id}'")
            composite_id = comp_rec.id
        else:
            comp_chk = await db.get(CompositedCreativeRecord, composite_id)
            if comp_chk and comp_chk.tenant_id and job.tenant_id and comp_chk.tenant_id != job.tenant_id:
                raise ValueError("Referenced composite belongs to another tenant.")

        platform_str = params.get("platform", "instagram")
        platform_enum = TargetPlatform(platform_str)

        # Idempotency check: see if approved final ad already exists
        existing_final_stmt = (
            select(FinalRenderedCreativeRecord)
            .where(
                FinalRenderedCreativeRecord.job_id == job.id,
                FinalRenderedCreativeRecord.composite_id == composite_id,
                FinalRenderedCreativeRecord.platform == platform_enum.value,
                FinalRenderedCreativeRecord.qa_status.in_(["FINAL_AD_APPROVED", "PASS", "WARNING"]),
                FinalRenderedCreativeRecord.is_stale == False,
            )
            .order_by(desc(FinalRenderedCreativeRecord.created_at))
        )
        existing_final = (await db.execute(existing_final_stmt)).scalars().first()
        if existing_final and not params.get("force_regenerate"):
            logger.info(f"Idempotent worker execution: returning existing final ad '{existing_final.id}' for job '{job.id}'")
            return {
                "job_id": job.id,
                "stage": stage,
                "status": job.status,
                "resource_id": existing_final.id,
                "duration_s": round(time.time() - start_time, 3),
                "is_cached": True,
            }

        final_record = await FinalAdService.render_final_ad(
            db=db,
            composite_id=composite_id,
            typography_style=params.get("typography"),
            cta_style=params.get("cta"),
            price_badge_style=params.get("price_badge"),
            readability_config=params.get("readability"),
            force_regenerate=params.get("force_regenerate", False),
        )
        return {
            "job_id": job.id,
            "stage": stage,
            "status": "FINAL_AD_APPROVED",
            "resource_id": final_record.id,
            "duration_s": round(time.time() - start_time, 3),
            "is_cached": final_record.is_cached,
        }

    else:
        raise ValueError(f"Unknown or unsupported stage: '{stage}'")
