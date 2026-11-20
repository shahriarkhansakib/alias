"""
Celery Task Definitions for Creative Generation Pipeline.
Encapsulates bounded retries, infrastructure fault tolerance, and thin execution
over the authoritative execute_job_stage runner.
"""

import asyncio
from typing import Optional, Dict, Any
from celery.exceptions import MaxRetriesExceededError
from app.core.logging import logger
from app.workers.celery_app import celery_app
from app.workers.job_runner import execute_job_stage


@celery_app.task(
    bind=True,
    name="creative.process_stage",
    max_retries=3,
    default_retry_delay=5,
    acks_late=True,
)
def process_creative_stage(
    self,
    job_id: str,
    stage: str,
    params: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Celery task orchestrating background creative stage execution.
    - Minimal payload: only job_id, stage, and safe parameters.
    - Idempotent against duplicate deliveries.
    - Bounded retries: transient connection errors retry up to 3 times.
    - Deterministic errors fail immediately without exhausting worker capacity.
    """
    logger.info(
        f"Celery task '{self.request.id}' executing stage '{stage}' for job '{job_id}' (Attempt: {self.request.retries + 1})"
    )

    try:
        # Run async stage runner within worker sync thread
        result = asyncio.run(
            execute_job_stage(
                job_id=job_id,
                stage=stage,
                params=params or {},
            )
        )
        logger.info(f"Celery task '{self.request.id}' completed successfully for job '{job_id}'")
        return result

    except (ConnectionError, TimeoutError, OSError) as transient_exc:
        logger.warning(
            f"Transient infrastructure error in task '{self.request.id}' for job '{job_id}': {str(transient_exc)}. "
            f"Retrying ({self.request.retries + 1}/{self.max_retries})..."
        )
        try:
            raise self.retry(exc=transient_exc, countdown=5 * (2 ** self.request.retries))
        except MaxRetriesExceededError:
            logger.error(f"Task '{self.request.id}' exceeded max retries for job '{job_id}'")
            raise

    except Exception as exc:
        # Deterministic domain/QA error: do NOT retry endlessly
        logger.error(
            f"Deterministic failure in task '{self.request.id}' for job '{job_id}' (stage: {stage}): {str(exc)}"
        )
        raise exc


@celery_app.task(
    bind=True,
    name="publishing.process_stage",
    max_retries=3,
    default_retry_delay=5,
    acks_late=True,
)
def process_publishing_stage(
    self,
    publishing_record_id: str,
) -> Dict[str, Any]:
    """
    Celery task orchestrating social publishing stage.
    - Minimal payload: only publishing_record_id.
    - Zero image bytes, tokens, or raw brief JSON.
    - Authoritative tenant/resource derived from database.
    """
    from app.workers.publishing_runner import execute_publishing_record

    logger.info(
        f"Celery publishing task '{self.request.id}' for record '{publishing_record_id}' (Attempt: {self.request.retries + 1})"
    )

    try:
        record = asyncio.run(execute_publishing_record(publishing_record_id))
        return {
            "status": record.status if record else "NOT_FOUND",
            "external_post_id": record.external_post_id if record else None,
        }
    except (ConnectionError, TimeoutError, OSError) as transient_exc:
        logger.warning(
            f"Transient error in publishing task '{self.request.id}' for record '{publishing_record_id}': {transient_exc}. "
            f"Retrying ({self.request.retries + 1}/{self.max_retries})..."
        )
        try:
            raise self.retry(exc=transient_exc, countdown=5 * (2 ** self.request.retries))
        except MaxRetriesExceededError:
            logger.error(f"Publishing task '{self.request.id}' exceeded max retries for record '{publishing_record_id}'")
            raise
