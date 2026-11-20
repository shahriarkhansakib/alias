from datetime import datetime, timezone
import hashlib
from typing import Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import AsyncSessionLocal
from app.core.logging import logger
from app.models.publishing import PublishingRecord, PublishingStatus
from app.models.final_ad import FinalRenderedCreativeRecord
from app.providers.storage_provider import get_storage_provider
from app.publishing.providers.factory import get_publishing_provider


async def _execute_publishing_record_with_db(
    db: AsyncSession,
    publishing_record_id: str,
    provider_override=None,
) -> Optional[PublishingRecord]:
    record = await db.get(PublishingRecord, publishing_record_id)
    if not record:
        logger.error(f"[PublishingRunner] PublishingRecord '{publishing_record_id}' not found.")
        return None

    # Pure idempotency: if already PUBLISHED, return immediately
    if record.status == PublishingStatus.PUBLISHED.value:
        logger.info(f"[PublishingRunner] Record '{record.id}' is already PUBLISHED. Reusing existing post.")
        return record

    provider = provider_override or get_publishing_provider(record.provider, platform=record.platform, db=db)

    # 1. Pre-flight Reconciliation Check
    # If external server created the post during a previous ambiguous timeout/worker crash,
    # reconciliation prevents duplicate external post creation.
    try:
        reconciled = await provider.reconcile(
            idempotency_key=record.idempotency_key,
            account_id=record.external_account_id,
            expected_caption=record.caption,
        )

        if reconciled and reconciled.success and reconciled.external_post_id:
            logger.info(
                f"[PublishingRunner] Reconciled existing external post '{reconciled.external_post_id}' "
                f"for record '{record.id}' using idempotency key."
            )
            record.external_post_id = reconciled.external_post_id
            record.post_url = reconciled.post_url
            record.provider_response = reconciled.raw_response
            record.transition_to(PublishingStatus.PUBLISHED)
            await db.commit()
            await db.refresh(record)
            return record
    except Exception as rec_exc:
        logger.warning(f"[PublishingRunner] Reconciliation check failed (proceeding to publish): {rec_exc}")

    # Transition state to PUBLISHING (re-queue first if retrying from PUBLISH_FAILED)
    try:
        if record.status == PublishingStatus.PUBLISH_FAILED.value:
            record.transition_to(PublishingStatus.PUBLISH_QUEUED)
        record.transition_to(PublishingStatus.PUBLISHING)
        await db.commit()
        await db.refresh(record)
    except ValueError as e:
        logger.warning(f"[PublishingRunner] Transition rejected: {e}")
        return record

    # 2. Load Final Ad Artifact from Storage
    final_ad = await db.get(FinalRenderedCreativeRecord, record.final_ad_id)
    if not final_ad:
        record.transition_to(
            PublishingStatus.PUBLISH_FAILED,
            error_code="CREATIVE_NOT_FOUND",
            error_message=f"FinalRenderedCreativeRecord '{record.final_ad_id}' no longer exists.",
        )
        await db.commit()
        return record

    storage = get_storage_provider()
    try:
        asset_bytes = await storage.get_bytes(final_ad.storage_key)
    except Exception as storage_exc:
        record.transition_to(
            PublishingStatus.PUBLISH_FAILED,
            error_code="STORAGE_READ_FAILED",
            error_message=f"Failed to read creative artifact from storage: {storage_exc}",
        )
        await db.commit()
        return record

    # Integrity verification: verify stored asset bytes match approved creative output hash
    expected_output_hash = (final_ad.provenance_chain or {}).get("output_hash")
    if expected_output_hash:
        actual_output_hash = hashlib.sha256(asset_bytes).hexdigest()
        if actual_output_hash != expected_output_hash:
            logger.error(
                f"[PublishingRunner] Creative output hash mismatch for record '{record.id}'. "
                f"Expected {expected_output_hash}, got {actual_output_hash}."
            )
            record.transition_to(
                PublishingStatus.PUBLISH_FAILED,
                error_code="OUTPUT_HASH_MISMATCH",
                error_message="Creative artifact integrity check failed: storage content does not match approved output hash.",
            )
            await db.commit()
            return record

    # 3. Execute Publish Call via Provider
    try:
        result = await provider.publish(
            record_id=record.id,
            platform=record.platform,
            asset_bytes=asset_bytes,
            caption=record.caption,
            platform_metadata=record.platform_metadata,
            idempotency_key=record.idempotency_key,
            account_id=record.external_account_id,
        )

        if result.success and result.external_post_id:
            record.external_post_id = result.external_post_id
            record.post_url = result.post_url
            record.provider_response = result.raw_response
            record.transition_to(PublishingStatus.PUBLISHED)
            logger.info(
                f"[PublishingRunner] Successfully published record '{record.id}' -> external post '{result.external_post_id}'"
            )
        else:
            record.transition_to(
                PublishingStatus.PUBLISH_FAILED,
                error_code=result.error_code or "PROVIDER_FAILURE",
                error_message=result.error_message or "Provider failed to publish creative.",
            )
            record.provider_response = result.raw_response

    except Exception as prov_exc:
        logger.error(f"[PublishingRunner] Provider error publishing record '{record.id}': {prov_exc}")
        record.transition_to(
            PublishingStatus.PUBLISH_FAILED,
            error_code="PROVIDER_EXCEPTION",
            error_message=str(prov_exc),
        )

    await db.commit()
    await db.refresh(record)
    return record


async def execute_publishing_record(
    publishing_record_id: str,
    db: Optional[AsyncSession] = None,
    provider_override=None,
) -> Optional[PublishingRecord]:
    """
    Authoritative publishing runner.
    Derived tenant and creative state directly from the database.
    Performs reconciliation pre-checks before issuing external publish calls
    to prevent duplicate external social posts across worker crashes/retries.
    """
    if db is not None:
        return await _execute_publishing_record_with_db(db, publishing_record_id, provider_override)
    async with AsyncSessionLocal() as session:
        return await _execute_publishing_record_with_db(session, publishing_record_id, provider_override)
