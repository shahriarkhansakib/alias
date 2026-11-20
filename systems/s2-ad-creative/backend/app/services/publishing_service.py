import hashlib
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, desc

from app.core.logging import logger
from app.core.config import settings
from app.models.auth import User, Membership, DEFAULT_TENANT_ID
from app.models.job import CreativeJob, JobStatus
from app.models.final_ad import FinalRenderedCreativeRecord
from app.models.publishing import PublishingRecord, PublishingStatus
from app.schemas.publishing import PublishRequest, PublishRetryRequest, PublishingReconcileResponse
from app.providers.storage_provider import get_storage_provider
from app.publishing.capability_registry import PublishingCapabilityRegistry
from app.publishing.providers.factory import get_publishing_provider
from app.workers.publishing_runner import execute_publishing_record


class PublishingService:
    """
    Publishing Service orchestrating social media publishing workflows.
    Strictly downstream of FINAL_AD_APPROVED.
    Enforces immutable creative provenance, multi-tenant isolation, deterministic idempotency,
    and external reconciliation.
    """

    @classmethod
    def _platforms_match(cls, creative_platform: str, requested_platform: str) -> bool:
        """
        Validates that the creative's rendered platform matches the requested publishing platform.
        E.g. 'instagram_square' matches 'instagram', 'facebook_feed' matches 'facebook'.
        Prevents rendering for Instagram and accidentally publishing to LinkedIn.
        """
        c_norm = creative_platform.lower()
        r_norm = requested_platform.lower()

        if c_norm == r_norm:
            return True

        for base in ["facebook", "instagram", "linkedin"]:
            if base in c_norm and base in r_norm:
                return True

        return False

    @classmethod
    def compute_idempotency_key(
        cls,
        tenant_id: str,
        final_ad_id: str,
        platform: str,
        caption: Optional[str] = None,
    ) -> str:
        """
        Computes a deterministic idempotency key for social publishing requests.
        Ensures identical publish attempts map to the exact same logical publishing action.
        """
        caption_hash = hashlib.sha256((caption or "").encode("utf-8")).hexdigest()[:16]
        raw = f"{tenant_id}:{final_ad_id}:{platform.lower().strip()}:{caption_hash}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:64]

    @classmethod
    async def create_and_publish(
        cls,
        db: AsyncSession,
        user: Optional[User],
        payload: PublishRequest,
        target_tenant_id: Optional[str] = None,
        provider_override=None,
    ) -> PublishingRecord:
        """
        Validates creative approval prerequisites, constructs the PublishingRecord,
        and executes publishing via the provider abstraction.
        """
        tenant_id = target_tenant_id or (user.active_tenant_id if user else DEFAULT_TENANT_ID)

        # 1. Authorize user membership in target tenant
        if user and user.id != "dev-admin-user-id":
            stmt_mem = select(Membership).where(
                and_(Membership.user_id == user.id, Membership.tenant_id == tenant_id)
            )
            membership = (await db.execute(stmt_mem)).scalars().first()
            if not membership:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Target tenant not found or access denied.",
                )

        # 2. Fetch and Validate FinalRenderedCreativeRecord
        final_ad = await db.get(FinalRenderedCreativeRecord, payload.final_ad_id)
        if not final_ad or final_ad.tenant_id != tenant_id:
            # Safe 404 to avoid leaking cross-tenant creative existence
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Final creative '{payload.final_ad_id}' not found.",
            )

        # Check stale flag
        if getattr(final_ad, "is_stale", False):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot publish stale creative. Upstream inputs have changed; re-render and re-approve first.",
            )

        # Deterministic Final QA Check
        if final_ad.qa_status not in ["PASS", "WARNING"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot publish creative that failed deterministic QA (status: '{final_ad.qa_status}').",
            )

        # Vision QA Check (when enabled)
        from app.schemas.vision_verification import VisionQAStatus
        if settings.ENABLE_VISION_QA and getattr(final_ad, "vision_qa_status", None):
            if final_ad.vision_qa_status == VisionQAStatus.FAILED.value:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Cannot publish creative: Vision QA status is '{final_ad.vision_qa_status}' (FAILED).",
                )
            if final_ad.vision_qa_status not in [
                VisionQAStatus.REAL_VERIFIED.value,
                VisionQAStatus.MOCK_VERIFIED.value,
                VisionQAStatus.UNAVAILABLE.value,
                VisionQAStatus.NOT_RUN.value,
            ]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Cannot publish creative: Unrecognized Vision QA status '{final_ad.vision_qa_status}'.",
                )

        # 3. Upstream Creative Job Status Gate: Prerequisite is FINAL_AD_APPROVED
        job = await db.get(CreativeJob, final_ad.job_id)
        if not job or job.status != JobStatus.FINAL_AD_APPROVED.value:
            curr_status = job.status if job else "UNKNOWN"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Creative is not approved for publishing. Current job status: '{curr_status}'. Prerequisite is FINAL_AD_APPROVED.",
            )

        # 4. Storage Artifact Existence
        storage = get_storage_provider()
        artifact_exists = await storage.exists(final_ad.storage_key)
        if not artifact_exists:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Referenced creative storage artifact '{final_ad.storage_key}' does not exist in storage provider.",
            )

        # 5. Platform Capability & Creative Platform Matching
        cap = PublishingCapabilityRegistry.get_capability(payload.platform)
        if not cap:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Platform '{payload.platform}' is not supported in the publishing capability registry.",
            )

        if not cls._platforms_match(final_ad.platform, payload.platform):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Platform mismatch: Creative was rendered for platform '{final_ad.platform}', "
                    f"cannot publish to requested platform '{payload.platform}'."
                ),
            )

        val_errors = PublishingCapabilityRegistry.validate_publish_payload(
            platform=payload.platform,
            caption=payload.caption,
            metadata=payload.platform_metadata,
        )
        if val_errors:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="; ".join(val_errors),
            )

        # 5b. Resolve and Validate ConnectedAccount
        from app.models.publishing import ConnectedAccount, AccountStatus
        if payload.account_id:
            acc = await db.get(ConnectedAccount, payload.account_id)
            if not acc or acc.tenant_id != tenant_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Connected account '{payload.account_id}' not found.",
                )
        elif payload.platform.lower().strip() == "facebook":
            stmt_acc = select(ConnectedAccount).where(
                and_(
                    ConnectedAccount.tenant_id == tenant_id,
                    ConnectedAccount.platform == "facebook",
                    ConnectedAccount.status.in_([AccountStatus.CONNECTED.value, AccountStatus.ACTIVE.value]),
                )
            )
            acc = (await db.execute(stmt_acc)).scalars().first()
            if acc:
                payload.account_id = acc.id

        # 6. Idempotency Key Resolution

        idempotency_key = payload.idempotency_key or cls.compute_idempotency_key(
            tenant_id=tenant_id,
            final_ad_id=final_ad.id,
            platform=payload.platform,
            caption=payload.caption,
        )

        # 7. Check for Existing Publishing Record (Idempotency)
        stmt_exist = select(PublishingRecord).where(
            and_(
                PublishingRecord.tenant_id == tenant_id,
                PublishingRecord.idempotency_key == idempotency_key,
            )
        ).order_by(desc(PublishingRecord.created_at))
        existing_rec = (await db.execute(stmt_exist)).scalars().first()

        if existing_rec:
            if existing_rec.status == PublishingStatus.PUBLISHED.value:
                logger.info(
                    f"[PublishingService] Idempotency hit: Creative '{final_ad.id}' already published as post '{existing_rec.external_post_id}'."
                )
                return existing_rec
            elif existing_rec.status in (PublishingStatus.PUBLISH_QUEUED.value, PublishingStatus.PUBLISHING.value):
                logger.info(f"[PublishingService] In-flight publish request deduplicated for key '{idempotency_key}'.")
                return existing_rec
            elif existing_rec.status == PublishingStatus.PUBLISH_FAILED.value:
                logger.info(f"[PublishingService] Retrying failed record '{existing_rec.id}' with idempotency key '{idempotency_key}'.")
                existing_rec.transition_to(PublishingStatus.PUBLISH_QUEUED)
                await db.commit()
                await db.refresh(existing_rec)
                executed_rec = await execute_publishing_record(existing_rec.id, db=db, provider_override=provider_override)
                return executed_rec or existing_rec

        # 8. Immutable Creative Provenance
        provenance = dict(final_ad.provenance_chain or {})
        provenance["final_ad_id"] = final_ad.id
        provenance["final_ad_storage_key"] = final_ad.storage_key
        provenance["composite_id"] = final_ad.composite_id
        provenance["background_id"] = final_ad.background_id
        provenance["strategy_id"] = final_ad.strategy_id
        provenance["brief_id"] = final_ad.brief_id
        provenance["publishing_requested_at"] = datetime.now(timezone.utc).isoformat()

        # 9. Create Publishing Record
        record = PublishingRecord(
            tenant_id=tenant_id,
            final_ad_id=final_ad.id,
            platform=payload.platform.lower().strip(),
            status=PublishingStatus.PUBLISH_QUEUED.value,
            provider="mock" if cap.provider_type == "mock" else payload.platform.lower().strip(),
            external_account_id=payload.account_id,
            caption=payload.caption,
            platform_metadata=payload.platform_metadata or {},
            idempotency_key=idempotency_key,
            provenance_chain=provenance,
        )
        db.add(record)
        await db.commit()
        await db.refresh(record)

        # 10. Execute Publishing Stage
        executed = await execute_publishing_record(record.id, db=db, provider_override=provider_override)
        return executed or record

    @classmethod
    async def get_record(
        cls,
        db: AsyncSession,
        publishing_id: str,
        user: Optional[User],
        target_tenant_id: Optional[str] = None,
    ) -> PublishingRecord:
        """Retrieves a publishing record with strict tenant isolation."""
        tenant_id = target_tenant_id or (user.active_tenant_id if user else DEFAULT_TENANT_ID)
        record = await db.get(PublishingRecord, publishing_id)
        if not record or record.tenant_id != tenant_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Publishing record not found.",
            )
        return record

    @classmethod
    async def retry_publishing(
        cls,
        db: AsyncSession,
        publishing_id: str,
        user: Optional[User],
        payload: PublishRetryRequest,
        target_tenant_id: Optional[str] = None,
        provider_override=None,
    ) -> PublishingRecord:
        """Retries a failed publishing attempt."""
        record = await cls.get_record(db, publishing_id, user, target_tenant_id)
        if record.status != PublishingStatus.PUBLISH_FAILED.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot retry publishing record with status '{record.status}'. Only PUBLISH_FAILED can be retried.",
            )

        record.transition_to(PublishingStatus.PUBLISH_QUEUED)
        await db.commit()
        await db.refresh(record)

        executed = await execute_publishing_record(record.id, db=db, provider_override=provider_override)
        return executed or record

    @classmethod
    async def reconcile_publishing(
        cls,
        db: AsyncSession,
        publishing_id: str,
        user: Optional[User],
        target_tenant_id: Optional[str] = None,
        provider_override=None,
    ) -> PublishingReconcileResponse:
        """
        Reconciles publishing record against provider idempotency registry
        to detect whether an external post was created during a previous worker crash/timeout.
        """
        record = await cls.get_record(db, publishing_id, user, target_tenant_id)
        old_status = record.status

        provider = provider_override or get_publishing_provider(record.provider, platform=record.platform, db=db)
        reconciled = await provider.reconcile(
            idempotency_key=record.idempotency_key,
            account_id=record.external_account_id,
            expected_caption=record.caption,
        )


        if reconciled and reconciled.success and reconciled.external_post_id:
            record.external_post_id = reconciled.external_post_id
            record.post_url = reconciled.post_url
            record.provider_response = reconciled.raw_response
            if record.status != PublishingStatus.PUBLISHED.value:
                record.transition_to(PublishingStatus.PUBLISHED)
                await db.commit()
                await db.refresh(record)

            return PublishingReconcileResponse(
                reconciled=True,
                previous_status=old_status,
                current_status=record.status,
                external_post_id=record.external_post_id,
                post_url=record.post_url,
                message="Successfully reconciled external post from provider registry.",
            )

        return PublishingReconcileResponse(
            reconciled=False,
            previous_status=old_status,
            current_status=record.status,
            external_post_id=record.external_post_id,
            post_url=record.post_url,
            message="No external post found in provider registry matching idempotency key.",
        )
