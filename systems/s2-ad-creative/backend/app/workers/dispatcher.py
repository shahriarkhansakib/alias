"""
Job Dispatcher Abstraction Layer.
Decouples FastAPI request handlers from Celery / Redis execution internals.
Supports InProcessJobDispatcher for frictionless local dev and CeleryJobDispatcher for production.
"""

import asyncio
import uuid
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
from app.core.config import settings
from app.core.logging import logger
from app.workers.job_runner import execute_job_stage


class JobDispatcher(ABC):
    """
    Abstract interface for dispatching creative generation jobs.
    """

    @abstractmethod
    async def dispatch(
        self,
        job_id: str,
        stage: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Dispatches a stage execution task and returns a tracking task ID.
        """
        pass


class InProcessJobDispatcher(JobDispatcher):
    """
    Asynchronous in-process dispatcher for local development and offline testing.
    Executes stages asynchronously in the active Python process without requiring Redis.
    """

    async def dispatch(
        self,
        job_id: str,
        stage: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> str:
        dispatch_id = f"inproc-{uuid.uuid4().hex[:12]}"
        logger.info(f"InProcessJobDispatcher scheduling stage '{stage}' for job '{job_id}' [Task: {dispatch_id}]")

        # Spawn asynchronous non-blocking task
        asyncio.create_task(
            self._run_safe(job_id, stage, params, dispatch_id)
        )
        return dispatch_id

    async def _run_safe(
        self,
        job_id: str,
        stage: str,
        params: Optional[Dict[str, Any]],
        dispatch_id: str,
    ) -> None:
        try:
            await execute_job_stage(job_id=job_id, stage=stage, params=params)
            logger.info(f"InProcessJobDispatcher completed stage '{stage}' for job '{job_id}' [Task: {dispatch_id}]")
        except Exception as e:
            logger.error(f"InProcessJobDispatcher error in stage '{stage}' for job '{job_id}': {str(e)}")


class CeleryJobDispatcher(JobDispatcher):
    """
    Production Celery dispatcher.
    Queues job execution messages onto Redis without passing large payloads.
    """

    def __init__(self):
        if not settings.REDIS_URL:
            raise ValueError("CeleryJobDispatcher requires REDIS_URL to be configured.")

    async def dispatch(
        self,
        job_id: str,
        stage: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> str:
        from app.workers.tasks import process_creative_stage

        logger.info(
            f"CeleryJobDispatcher queuing stage '{stage}' for job '{job_id}' on queue '{settings.CELERY_TASK_DEFAULT_QUEUE}'"
        )
        # Dispatch task to Celery queue with minimal payload
        async_result = process_creative_stage.apply_async(
            kwargs={
                "job_id": job_id,
                "stage": stage,
                "params": params or {},
            },
            queue=settings.CELERY_TASK_DEFAULT_QUEUE,
        )
        return str(async_result.id)


_dispatcher_instance: Optional[JobDispatcher] = None


def get_job_dispatcher() -> JobDispatcher:
    global _dispatcher_instance
    if _dispatcher_instance is None:
        if settings.WORKER_TYPE.lower() == "celery":
            _dispatcher_instance = CeleryJobDispatcher()
        else:
            _dispatcher_instance = InProcessJobDispatcher()
    return _dispatcher_instance


def reset_job_dispatcher() -> None:
    """Reset the singleton instance (used in tests)."""
    global _dispatcher_instance
    _dispatcher_instance = None
