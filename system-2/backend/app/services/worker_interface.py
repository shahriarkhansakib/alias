import asyncio
from typing import Any, Dict, Optional
from app.core.logging import logger
from app.providers.base import JobWorker


class AsyncLocalJobWorker(JobWorker):
    """
    Lightweight in-process async background worker for local development.
    Requires zero external message brokers (no Redis or Celery needed).
    """

    def __init__(self):
        self._tasks: Dict[str, asyncio.Task] = {}

    async def enqueue_job(self, job_id: str, payload: Dict[str, Any]) -> None:
        logger.info(f"Enqueuing job {job_id} to async local worker pool.")
        task = asyncio.create_task(self._process_job(job_id, payload))
        self._tasks[job_id] = task

    async def _process_job(self, job_id: str, payload: Dict[str, Any]) -> None:
        try:
            logger.info(f"Local worker started processing job: {job_id}")
            # Note: Detailed pipeline execution will be connected in subsequent phases.
            # In Phase 1, worker lifecycle is verified with status transitions.
            await asyncio.sleep(0.5)
            logger.info(f"Local worker completed Phase 1 baseline job check for: {job_id}")
        except Exception as e:
            logger.error(f"Error executing job {job_id}: {e}", exc_info=True)


_worker_instance: Optional[JobWorker] = None


def get_job_worker() -> JobWorker:
    global _worker_instance
    if _worker_instance is None:
        _worker_instance = AsyncLocalJobWorker()
    return _worker_instance
