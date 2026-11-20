from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import get_current_tenant, get_optional_current_user
from app.models.auth import Tenant, User
from app.schemas.publishing import (
    PublishRequest,
    PublishRetryRequest,
    PublishingRecordResponse,
    PublishingReconcileResponse,
    PlatformPublishingCapability,
)
from app.publishing.capability_registry import PublishingCapabilityRegistry
from app.services.publishing_service import PublishingService

router = APIRouter(prefix="/publishing", tags=["Phase 9: Publishing Infrastructure Layer"])


@router.get("/capabilities", response_model=List[PlatformPublishingCapability])
async def list_publishing_capabilities():
    """
    Returns registered social publishing platform capabilities, constraints,
    and provider integration statuses.
    """
    return PublishingCapabilityRegistry.list_capabilities()


@router.post("", response_model=PublishingRecordResponse, status_code=status.HTTP_201_CREATED)
async def publish_creative(
    payload: PublishRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    user: Optional[User] = Depends(get_optional_current_user),
):
    """
    Initiates publishing of an approved final advertisement (FINAL_AD_APPROVED).
    Validates creative approval, storage artifact existence, platform matching,
    enforces deterministic idempotency, and records full audit provenance.
    """
    record = await PublishingService.create_and_publish(
        db=db,
        user=user,
        payload=payload,
        target_tenant_id=tenant.id,
    )
    return PublishingRecordResponse.model_validate(record)


@router.get("/{publishing_id}", response_model=PublishingRecordResponse)
async def get_publishing_record(
    publishing_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    user: Optional[User] = Depends(get_optional_current_user),
):
    """
    Retrieves a publishing record with strict tenant isolation.
    """
    record = await PublishingService.get_record(
        db=db,
        publishing_id=publishing_id,
        user=user,
        target_tenant_id=tenant.id,
    )
    return PublishingRecordResponse.model_validate(record)


@router.post("/{publishing_id}/retry", response_model=PublishingRecordResponse)
async def retry_publishing(
    publishing_id: str,
    payload: PublishRetryRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    user: Optional[User] = Depends(get_optional_current_user),
):
    """
    Retries a failed publishing attempt (PUBLISH_FAILED -> PUBLISH_QUEUED -> PUBLISHING).
    """
    record = await PublishingService.retry_publishing(
        db=db,
        publishing_id=publishing_id,
        user=user,
        payload=payload,
        target_tenant_id=tenant.id,
    )
    return PublishingRecordResponse.model_validate(record)


@router.post("/{publishing_id}/reconcile", response_model=PublishingReconcileResponse)
async def reconcile_publishing(
    publishing_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    user: Optional[User] = Depends(get_optional_current_user),
):
    """
    Reconciles publishing record against provider idempotency registry
    after an ambiguous failure/worker crash to detect whether an external post was created.
    """
    return await PublishingService.reconcile_publishing(
        db=db,
        publishing_id=publishing_id,
        user=user,
        target_tenant_id=tenant.id,
    )
