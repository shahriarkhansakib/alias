"""
Dependency Invalidation Service.

When an authoritative upstream input changes (e.g., product image replaced,
background regenerated, composite re-generated from different inputs),
any downstream final ads linked to that input must be marked stale.

A stale final ad:
- Cannot be approved without re-rendering.
- Has is_stale=True and vision_qa_status cleared.
- Will show a STALE warning in the frontend.

Architecture:
  Product changed -> Composite stale -> Final Ad stale -> Approval invalid
  Background changed -> Composite stale -> Final Ad stale -> Approval invalid
  Composite changed -> Final Ad stale -> Approval invalid

This service is called by the pipeline services when authoritative inputs are
replaced (not just re-fetched). It does NOT run on every generation -- only
when the data that the final ad was built from has been superseded.
"""
from typing import List
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.models.final_ad import FinalRenderedCreativeRecord
from app.models.composite import CompositedCreativeRecord


class DependencyInvalidationService:
    """
    Marks downstream records as stale when authoritative upstream inputs change.
    Uses the existing model relationships -- no new foreign keys required.
    """

    @staticmethod
    async def invalidate_finals_for_composite(
        db: AsyncSession,
        composite_id: str,
        reason: str = "composite_changed",
    ) -> int:
        """
        Mark all FinalRenderedCreativeRecord rows that reference composite_id as stale.
        Returns count of invalidated records.
        """
        stmt = (
            update(FinalRenderedCreativeRecord)
            .where(FinalRenderedCreativeRecord.composite_id == composite_id)
            .values(
                is_stale=True,
                vision_qa_status=None,
                vision_qa_result=None,
            )
        )
        result = await db.execute(stmt)
        count = result.rowcount or 0
        if count > 0:
            logger.warning(
                f"[DependencyInvalidation] Marked {count} final ad(s) stale. "
                f"composite_id={composite_id} reason={reason}"
            )
        await db.commit()
        return count

    @staticmethod
    async def invalidate_finals_for_background(
        db: AsyncSession,
        background_id: str,
        reason: str = "background_changed",
    ) -> int:
        """
        Mark all FinalRenderedCreativeRecord rows that reference background_id as stale.
        Background change -> composite stale -> final ad stale.
        """
        stmt = (
            update(FinalRenderedCreativeRecord)
            .where(FinalRenderedCreativeRecord.background_id == background_id)
            .values(
                is_stale=True,
                vision_qa_status=None,
                vision_qa_result=None,
            )
        )
        result = await db.execute(stmt)
        count = result.rowcount or 0
        if count > 0:
            logger.warning(
                f"[DependencyInvalidation] Marked {count} final ad(s) stale. "
                f"background_id={background_id} reason={reason}"
            )
        await db.commit()
        return count

    @staticmethod
    async def invalidate_finals_for_job(
        db: AsyncSession,
        job_id: str,
        reason: str = "job_input_changed",
    ) -> int:
        """
        Mark all FinalRenderedCreativeRecord rows for a job as stale.
        Used when the product image (root input) changes.
        """
        stmt = (
            update(FinalRenderedCreativeRecord)
            .where(FinalRenderedCreativeRecord.job_id == job_id)
            .values(
                is_stale=True,
                vision_qa_status=None,
                vision_qa_result=None,
            )
        )
        result = await db.execute(stmt)
        count = result.rowcount or 0
        if count > 0:
            logger.warning(
                f"[DependencyInvalidation] Marked {count} final ad(s) stale. "
                f"job_id={job_id} reason={reason}"
            )
        await db.commit()
        return count

    @staticmethod
    async def invalidate_finals_for_strategy(
        db: AsyncSession,
        strategy_id: str,
        reason: str = "strategy_changed",
    ) -> int:
        """
        Mark all FinalRenderedCreativeRecord rows that reference strategy_id as stale.
        Used when the approved marketing copy or strategy directions are regenerated.
        """
        stmt = (
            update(FinalRenderedCreativeRecord)
            .where(FinalRenderedCreativeRecord.strategy_id == strategy_id)
            .values(
                is_stale=True,
                vision_qa_status=None,
                vision_qa_result=None,
            )
        )
        result = await db.execute(stmt)
        count = result.rowcount or 0
        if count > 0:
            logger.warning(
                f"[DependencyInvalidation] Marked {count} final ad(s) stale. "
                f"strategy_id={strategy_id} reason={reason}"
            )
        await db.commit()
        return count

    @staticmethod
    async def get_stale_finals_for_job(
        db: AsyncSession,
        job_id: str,
    ) -> List[FinalRenderedCreativeRecord]:
        """Return all stale final ads for a job (for frontend display)."""
        stmt = select(FinalRenderedCreativeRecord).where(
            FinalRenderedCreativeRecord.job_id == job_id,
            FinalRenderedCreativeRecord.is_stale == True,
        )
        result = await db.execute(stmt)
        return list(result.scalars().all())


dependency_invalidation_service = DependencyInvalidationService()
