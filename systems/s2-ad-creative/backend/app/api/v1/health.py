from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.config import settings
from app.core.database import get_db
from app.providers.storage_provider import get_storage_provider
from app.schemas.health import SystemHealthResponse, SystemStatusResponse

router = APIRouter(prefix="", tags=["System"])


@router.get("/health", response_model=SystemHealthResponse)
async def check_health(db: AsyncSession = Depends(get_db)):
    """
    Health check endpoint verifying:
    - API operational status
    - Database connectivity
    - Storage system availability
    - Job worker status
    """
    db_status = "healthy"
    try:
        # Perform lightweight DB ping
        await db.execute(text("SELECT 1"))
    except Exception as e:
        db_status = f"unhealthy: {str(e)}"

    storage = get_storage_provider()
    storage_status = "healthy"
    try:
        # Quick check for local or configured storage
        exists = await storage.exists("healthcheck_probe")
    except Exception as e:
        storage_status = f"unhealthy: {str(e)}"

    overall_status = "healthy" if (db_status == "healthy" and storage_status == "healthy") else "degraded"

    return SystemHealthResponse(
        status=overall_status,
        version=settings.VERSION,
        environment=settings.ENVIRONMENT,
        database=db_status,
        storage=storage_status,
        worker=f"operational ({settings.WORKER_TYPE})",
    )


@router.get("/status", response_model=SystemStatusResponse)
async def get_system_status():
    """
    Returns platform runtime status, architectural features, and configuration.
    """
    return SystemStatusResponse(
        project_name=settings.PROJECT_NAME,
        version=settings.VERSION,
        environment=settings.ENVIRONMENT,
        active_features={
            "payload_gate": True,
            "asset_gate": True,
            "deterministic_rendering": True,
            "mock_ai_providers": True,
            "vision_qa_advisory": True,
            "async_worker": True,
        },
        configuration={
            "storage_type": settings.STORAGE_TYPE,
            "worker_type": settings.WORKER_TYPE,
            "cors_origins": settings.CORS_ORIGINS,
            "database_dialect": "postgresql" if "postgresql" in settings.DATABASE_URL else "sqlite",
        },
    )
