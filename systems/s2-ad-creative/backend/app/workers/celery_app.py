"""
Celery Application Configuration for Production Worker Architecture.
Configures Redis broker/backend, queue definitions, serialization, and worker task behavior.
"""

from celery import Celery
from app.core.config import settings

# Initialize Celery app instance
celery_app = Celery(
    "alias_imggen",
    broker=settings.REDIS_URL or "redis://localhost:6379/0",
    backend=settings.REDIS_URL or "redis://localhost:6379/0",
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_default_queue=settings.CELERY_TASK_DEFAULT_QUEUE,
    task_queues={
        settings.CELERY_TASK_DEFAULT_QUEUE: {
            "exchange": settings.CELERY_TASK_DEFAULT_QUEUE,
            "routing_key": settings.CELERY_TASK_DEFAULT_QUEUE,
        }
    },
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
)
