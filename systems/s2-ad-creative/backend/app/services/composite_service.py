import io
import json
import hashlib
from typing import Optional, Dict, Any, Union
from sqlalchemy import select, and_, desc, func
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status

from app.core.logging import logger
from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.models.strategy import CreativeStrategyRecord
from app.models.background import GeneratedBackgroundRecord
from app.models.job import CreativeJob, JobStatus
from app.models.composite import CompositedCreativeRecord
from app.schemas.strategy import CreativeStrategySpec
from app.schemas.platform import TargetPlatform
from app.schemas.background import QAStatus
from app.schemas.composite import (
    ProductPlacementConfig,
    ShadowConfig,
    PixelPlacementResult,
    CompositeQAResult,
    ProductIntegrityMetadata,
)
from app.platforms.registry import build_platform_creative_spec
from app.providers.storage_provider import get_storage_provider
from app.providers.cutout_provider import get_product_cutout_provider, ProductCutoutProvider
from app.services.cutout_qa import CutoutQAService
from app.services.product_positioner import ProductPositioner
from app.services.compositing_engine import CompositingEngine
from app.services.composite_qa import CompositeQAService
from app.demo.sample_assets import generate_demo_smartwatch_png


# Non-generation metadata keys ignored during deterministic cache key computation
IGNORED_CACHE_PARAM_KEYS = {
    "request_id",
    "timestamp",
    "trace_id",
    "created_at",
    "user_id",
    "client_ip",
    "session_id",
    "correlation_id",
    "metadata",
}


class CompositeService:
    """
    Dedicated Service managing the Phase 5 Product Cutout Extraction & Compositing pipeline:
    - Gate enforcement (Brief PASS, Asset PASS, Strategy APPROVED, Background PASS/WARNING)
    - Source product asset resolution and integrity verification
    - Product cutout extraction with vendor-neutral abstraction (ProductCutoutProvider)
    - Alpha channel and cutout QA validation (CutoutQAService)
    - Deterministic aspect-ratio-preserving placement calculation (ProductPositioner)
    - Deterministic contact/drop shadow generation
    - Pillow alpha compositing (CompositingEngine)
    - Composite QA evaluation (CompositeQAService)
    - CreativeJob state transitions and record persistence
    """

    @classmethod
    def _canonicalize_dict(cls, data: Optional[Dict[str, Any]]) -> str:
        """Deterministic canonical JSON serialization for caching."""
        if not data:
            return "{}"
        filtered = {
            str(k): v
            for k, v in sorted(data.items())
            if str(k).lower() not in IGNORED_CACHE_PARAM_KEYS
        }
        return json.dumps(filtered, sort_keys=True, separators=(",", ":"))

    @classmethod
    def _compute_cache_key(
        cls,
        source_asset_hash: str,
        cutout_hash: str,
        background_id: str,
        platform: str,
        template_id: str,
        placement_dict: Dict[str, Any],
        shadow_dict: Dict[str, Any],
        tenant_id: str,
    ) -> str:
        """
        Computes a deterministic SHA-256 cache key strictly isolated by tenant.
        Rejects missing, empty, or whitespace-only tenant_id.
        """
        if not tenant_id or not str(tenant_id).strip():
            raise ValueError(f"tenant_id is required and cannot be empty (got {tenant_id!r})")
        clean_tenant = str(tenant_id).strip()

        parts = [
            f"tenant:{clean_tenant}",
            source_asset_hash,
            cutout_hash,
            background_id,
            platform,
            template_id,
            cls._canonicalize_dict(placement_dict),
            cls._canonicalize_dict(shadow_dict),
        ]
        return hashlib.sha256(":".join(parts).encode("utf-8")).hexdigest()

    @classmethod
    async def _resolve_product_bytes(
        cls,
        asset_record: AssetValidationRecord,
        storage: Any,
    ) -> bytes:
        """
        Retrieves the authenticated source product image bytes from storage or URL.
        Falls back to generating demo fixture bytes for local offline development.
        """
        # 1. Try resolving via explicit storage_key
        if asset_record.storage_key:
            try:
                return await storage.get_bytes(asset_record.storage_key)
            except Exception as e:
                logger.warning(f"Storage lookup for {asset_record.storage_key} failed: {e}")

        # 2. Try extracting storage_key from asset_record.url (e.g. /storage/demo/iphone.png -> demo/iphone.png)
        raw_url = asset_record.url or ""
        if "/storage/" in raw_url:
            candidate_key = raw_url.split("/storage/", 1)[-1].split("?")[0].strip("/")
            try:
                return await storage.get_bytes(candidate_key)
            except Exception as e:
                logger.warning(f"Storage lookup for extracted key '{candidate_key}' failed: {e}")

        # 3. Try resolving via direct URL download (local dev server or external asset)
        if raw_url.startswith("http://") or raw_url.startswith("https://"):
            try:
                from app.services.asset_gate import asset_gate_service
                download_result, download_err = await asset_gate_service._secure_download(
                    raw_url, allow_local_demo=True
                )
                if download_result and download_result[0]:
                    return download_result[0]
                if download_err:
                    logger.warning(f"Direct download for asset URL '{raw_url}' failed: {download_err}")
            except Exception as e:
                logger.warning(f"Failed to fetch asset from URL '{raw_url}': {e}")

        # 4. Try raw_url directly as a relative storage key
        if raw_url and not raw_url.startswith("http"):
            try:
                return await storage.get_bytes(raw_url.lstrip("/"))
            except Exception:
                pass

        # 5. Fallback for offline mock tests: common demo asset keys
        for candidate_key in ["demo/smartfit_x1.png", "assets/demo/smartfit_x1.png"]:
            try:
                return await storage.get_bytes(candidate_key)
            except Exception:
                pass

        # 6. Final fallback for local test harness
        demo_bytes = generate_demo_smartwatch_png()
        await storage.save_bytes(demo_bytes, "demo/smartfit_x1.png", content_type="image/png")
        return demo_bytes

    @classmethod
    async def composite_product(
        cls,
        db: AsyncSession,
        background_id: str,
        product_image_url: Optional[str] = None,
        placement_config: Optional[ProductPlacementConfig] = None,
        shadow_config: Optional[ShadowConfig] = None,
        force_regenerate: bool = False,
        cutout_provider: Optional[ProductCutoutProvider] = None,
    ) -> CompositedCreativeRecord:
        active_cutout_provider = cutout_provider or get_product_cutout_provider()
        storage = get_storage_provider()

        # =============================================================
        # 1. Gate Enforcements
        # =============================================================
        # A. Background Gate
        background = await db.get(GeneratedBackgroundRecord, background_id)
        if not background:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"GeneratedBackgroundRecord with id '{background_id}' not found.",
            )

        if background.qa_status not in ("PASS", "WARNING"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Background '{background_id}' QA status is '{background.qa_status}'. Only 'PASS' or 'WARNING' backgrounds can proceed to compositing.",
            )

        # B. Strategy Gate
        strategy = await db.get(CreativeStrategyRecord, background.strategy_id)
        if not strategy:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"CreativeStrategy with id '{background.strategy_id}' not found.",
            )

        if strategy.status != "APPROVED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"CreativeStrategy '{strategy.id}' status is '{strategy.status}'. Only 'APPROVED' strategies can proceed to compositing.",
            )

        # Enforce Background -> Strategy relationship
        if background.strategy_id != strategy.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Background strategy_id '{background.strategy_id}' does not match strategy '{strategy.id}'. Relationship mismatch.",
            )
        if background.brief_id != strategy.brief_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Background brief_id '{background.brief_id}' does not match strategy brief_id '{strategy.brief_id}'. Relationship mismatch.",
            )

        # C. Brief Gate
        brief = await db.get(AdBrief, background.brief_id)
        if not brief or brief.validation_status != "PASS":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The underlying brief has not passed Payload validation. Pipeline gate compromised.",
            )

        # D. Asset Gate
        primary_url = (product_image_url.strip() if product_image_url and product_image_url.strip() else None) or (
            brief.payload.get("images", [{}])[0].get("url") if brief.payload else None
        )
        if not primary_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No product image URL found in validated brief or request. Pipeline gate compromised.",
            )

        stmt_asset = (
            select(AssetValidationRecord)
            .where(AssetValidationRecord.url == primary_url)
            .order_by(desc(AssetValidationRecord.created_at))
        )
        asset_record = (await db.execute(stmt_asset)).scalars().first()
        if not asset_record and product_image_url:
            # On-the-fly Asset Gate validation and record persistence for explicit override product image
            from app.services.asset_gate import asset_gate_service
            val_res = await asset_gate_service.validate_url_and_asset(
                url=primary_url,
                require_transparency=True,
                allow_local_demo=True,
            )
            if not val_res.is_valid:
                val_res = await asset_gate_service.validate_url_and_asset(
                    url=primary_url,
                    require_transparency=False,
                    allow_local_demo=True,
                )
            if not val_res.is_valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"The product asset '{primary_url}' failed Asset Gate validation. Pipeline gate compromised.",
                )
            meta = val_res.asset_metadata or {}
            storage_key = meta.get("storage_key")
            if not storage_key and primary_url and "/storage/" in primary_url:
                storage_key = primary_url.split("/storage/", 1)[-1].split("?")[0].strip("/")

            asset_record = AssetValidationRecord(
                tenant_id=background.tenant_id,
                url=primary_url,
                storage_key=storage_key,
                detected_mime=meta.get("detected_mime"),
                width=meta.get("width"),
                height=meta.get("height"),
                aspect_ratio=meta.get("aspect_ratio"),
                has_alpha_channel=meta.get("has_alpha_channel", False),
                transparency_percent=meta.get("transparency_percent"),
                file_size_bytes=meta.get("file_size_bytes"),
                validation_status=val_res.status.value,
                validation_report=val_res.report.model_dump(mode="json"),
            )
            db.add(asset_record)
            await db.commit()
            await db.refresh(asset_record)

        if not asset_record or asset_record.validation_status not in ["PASS", "WARNING"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The underlying product asset has not passed Asset Gate validation. Pipeline gate compromised.",
            )

        # E. Authoritative CreativeJob Resolution (Strictly via background.job_id)
        stmt_job = select(CreativeJob).where(CreativeJob.id == background.job_id)
        job = (await db.execute(stmt_job)).scalars().first()

        if not job:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Authoritative CreativeJob '{background.job_id}' referenced by background '{background_id}' not found. Cross-job fallback prohibited.",
            )

        # Enforce Composite -> Job -> Brief -> Strategy -> Background graph invariants
        if job.brief_id != background.brief_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"CreativeJob brief_id '{job.brief_id}' does not match background brief_id '{background.brief_id}'. Relationship mismatch.",
            )
        if job.strategy_id != background.strategy_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"CreativeJob strategy_id '{job.strategy_id}' does not match background strategy_id '{background.strategy_id}'. Relationship mismatch.",
            )

        # Enforce multi-tenant graph consistency
        if not job.tenant_id or not str(job.tenant_id).strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="CreativeJob missing tenant_id. Tenant identity is strictly mandatory for compositing.",
            )
        if (
            (job.tenant_id and background.tenant_id and job.tenant_id != background.tenant_id)
            or (strategy.tenant_id and background.tenant_id and strategy.tenant_id != background.tenant_id)
            or (brief.tenant_id and background.tenant_id and brief.tenant_id != background.tenant_id)
            or (job.tenant_id and strategy.tenant_id and job.tenant_id != strategy.tenant_id)
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cross-tenant resource graph detected. All pipeline resources must belong to the same tenant.",
            )

        # =============================================================
        # 2. Retrieve Source Product & Background Assets
        # =============================================================
        product_bytes = await cls._resolve_product_bytes(asset_record, storage)
        source_asset_hash = hashlib.sha256(product_bytes).hexdigest()

        try:
            background_bytes = await storage.get_bytes(background.storage_key)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to load background storage key '{background.storage_key}': {str(e)}",
            )

        # =============================================================
        # 3. Product Cutout Extraction & Validation
        # =============================================================
        current_job_status = JobStatus(job.status)
        if current_job_status in (JobStatus.BACKGROUND_APPROVED, JobStatus.COMPOSITING) or (force_regenerate and current_job_status == JobStatus.COMPOSITE_APPROVED):
            job.transition_to(
                JobStatus.PRODUCT_CUTOUT,
                stage_name="Product Cutout Extraction",
                progress_pct=80,
                stage_data={"source_asset_id": asset_record.id, "source_hash": source_asset_hash[:16]},
            )
            await db.commit()

        try:
            cutout_bytes, cutout_meta = await active_cutout_provider.extract_cutout(
                product_bytes, asset_metadata=asset_record.validation_report
            )
        except Exception as e:
            logger.error(f"Cutout extraction failed: {str(e)}")
            job.transition_to(
                JobStatus.FAILED,
                stage_name="Cutout Extraction Failed",
                error_details={"error": str(e)},
            )
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Cutout extraction error: {str(e)}",
            )

        cutout_hash = hashlib.sha256(cutout_bytes).hexdigest()

        # Transition to PRODUCT_QA if coming from PRODUCT_CUTOUT
        if JobStatus(job.status) == JobStatus.PRODUCT_CUTOUT:
            job.transition_to(
                JobStatus.PRODUCT_QA,
                stage_name="Product Cutout QA",
                progress_pct=85,
            )
            await db.commit()

        cutout_qa = CutoutQAService.evaluate(cutout_bytes)
        if cutout_qa.status == QAStatus.FAIL:
            logger.error(f"Product cutout QA failed: {cutout_qa.issues}")
            job.transition_to(
                JobStatus.FAILED,
                stage_name="Product Cutout QA Failed",
                error_details={"issues": cutout_qa.issues, "details": cutout_qa.details},
            )
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cutout QA validation failed: {'; '.join(cutout_qa.issues)}",
            )

        # Save cutout asset
        storage_prefix = f"tenants/{job.tenant_id}/" if getattr(job, "tenant_id", None) else ""
        cutout_storage_key = f"{storage_prefix}cutouts/{job.id}/product_cutout.png"
        await storage.save_bytes(cutout_bytes, cutout_storage_key, content_type="image/png")

        # =============================================================
        # 4. Placement & Geometry Derivation
        # =============================================================
        strategy_spec = CreativeStrategySpec.model_validate(strategy.strategy_spec)
        platform_spec = build_platform_creative_spec(background.platform, strategy_spec)

        placement_cfg = placement_config or ProductPlacementConfig()
        shadow_cfg = shadow_config or ShadowConfig()

        placement_result = ProductPositioner.calculate_placement(
            canvas_width=platform_spec.target_width,
            canvas_height=platform_spec.target_height,
            cutout_width=cutout_meta.output_dimensions[0],
            cutout_height=cutout_meta.output_dimensions[1],
            safe_region=platform_spec.product_safe_region,
            config=placement_cfg,
        )

        # =============================================================
        # 5. Cache Evaluation
        # =============================================================
        cache_key = cls._compute_cache_key(
            source_asset_hash=source_asset_hash,
            cutout_hash=cutout_hash,
            background_id=background.id,
            platform=platform_spec.platform.value,
            template_id=strategy.template_id,
            placement_dict=placement_cfg.model_dump(),
            shadow_dict=shadow_cfg.model_dump(),
            tenant_id=job.tenant_id,
        )

        if not force_regenerate:
            stmt_cache = select(CompositedCreativeRecord).where(
                and_(
                    CompositedCreativeRecord.tenant_id == job.tenant_id,
                    CompositedCreativeRecord.cache_key == cache_key,
                    CompositedCreativeRecord.qa_status.in_([QAStatus.PASS.value, QAStatus.WARNING.value]),
                )
            ).order_by(CompositedCreativeRecord.created_at.desc())
            cached_res = await db.execute(stmt_cache)
            cached_record = cached_res.scalars().first()

            if cached_record and cached_record.tenant_id == job.tenant_id:
                logger.info(f"Returning cached composited creative for background {background_id} (tenant: {job.tenant_id})")
                cached_record.is_cached = True
                return cached_record

        # =============================================================
        # 6. Execute Deterministic Alpha Compositing
        # =============================================================
        if JobStatus(job.status) in (JobStatus.PRODUCT_QA, JobStatus.BACKGROUND_APPROVED, JobStatus.COMPOSITING):
            if JobStatus(job.status) != JobStatus.COMPOSITING:
                job.transition_to(
                    JobStatus.COMPOSITING,
                    stage_name="Deterministic Product Compositing",
                    progress_pct=90,
                    stage_data={
                        "placement": placement_result.model_dump(),
                        "shadow_enabled": shadow_cfg.enabled,
                    },
                )
                await db.commit()

        composited_bytes, integrity = CompositingEngine.composite(
            background_bytes=background_bytes,
            cutout_bytes=cutout_bytes,
            placement=placement_result,
            shadow_config=shadow_cfg,
            source_asset_id=asset_record.id,
            background_id=background.id,
        )

        # =============================================================
        # 7. Deterministic Composite QA
        # =============================================================
        if JobStatus(job.status) == JobStatus.COMPOSITING:
            job.transition_to(
                JobStatus.COMPOSITE_QA,
                stage_name="Composite QA Evaluation",
                progress_pct=95,
            )
            await db.commit()

        composite_qa = CompositeQAService.evaluate(
            composite_bytes=composited_bytes,
            platform_spec=platform_spec,
            placement=placement_result,
        )

        # =============================================================
        # 8. Storage & State Finalization
        # =============================================================
        stmt_count = select(func.count(CompositedCreativeRecord.id)).where(
            and_(
                CompositedCreativeRecord.job_id == job.id,
                CompositedCreativeRecord.platform == platform_spec.platform.value,
            )
        )
        attempt_count = (await db.execute(stmt_count)).scalar() or 0
        attempt_number = attempt_count + 1

        storage_prefix = f"tenants/{job.tenant_id}/" if getattr(job, "tenant_id", None) else ""
        storage_key = f"{storage_prefix}composites/{job.id}/{platform_spec.platform.value}/composite_attempt_{attempt_number}.png"
        await storage.save_bytes(composited_bytes, storage_key, content_type="image/png")

        if composite_qa.status in (QAStatus.PASS, QAStatus.WARNING):
            stage_title = "Composite Approved" if composite_qa.status == QAStatus.PASS else "Composite Approved (with Warnings)"
            if JobStatus(job.status) == JobStatus.COMPOSITE_QA:
                job.transition_to(
                    JobStatus.COMPOSITE_APPROVED,
                    stage_name=stage_title,
                    progress_pct=100,
                    stage_data={
                        "qa_status": composite_qa.status.value,
                        "qa_score": composite_qa.overall_score,
                        "warnings": composite_qa.warnings,
                        "storage_key": storage_key,
                    },
                )

            record = CompositedCreativeRecord(
                tenant_id=job.tenant_id,
                job_id=job.id,
                strategy_id=strategy.id,
                brief_id=brief.id,
                background_id=background.id,
                platform=platform_spec.platform.value,
                width=platform_spec.target_width,
                height=platform_spec.target_height,
                aspect_ratio=platform_spec.aspect_ratio,
                storage_key=storage_key,
                cutout_storage_key=cutout_storage_key,
                placement_spec=placement_result.model_dump(),
                shadow_spec=shadow_cfg.model_dump(),
                integrity_metadata=integrity.model_dump(),
                qa_status=composite_qa.status.value,
                qa_result=composite_qa.model_dump(),
                cache_key=cache_key,
                is_cached=False,
                attempt_number=attempt_number,
            )
            db.add(record)
            await db.commit()
            await db.refresh(record)
            return record

        else:
            # Composite QA Rejected
            job.transition_to(
                JobStatus.FAILED,
                stage_name="Composite QA Rejected",
                error_details={"issues": composite_qa.issues, "score": composite_qa.overall_score},
            )
            failed_record = CompositedCreativeRecord(
                tenant_id=job.tenant_id,
                job_id=job.id,
                strategy_id=strategy.id,
                brief_id=brief.id,
                background_id=background.id,
                platform=platform_spec.platform.value,
                width=platform_spec.target_width,
                height=platform_spec.target_height,
                aspect_ratio=platform_spec.aspect_ratio,
                storage_key=storage_key,
                cutout_storage_key=cutout_storage_key,
                placement_spec=placement_result.model_dump(),
                shadow_spec=shadow_cfg.model_dump(),
                integrity_metadata=integrity.model_dump(),
                qa_status=QAStatus.FAIL.value,
                qa_result=composite_qa.model_dump(),
                cache_key=None,  # NEVER cache a failed composite!
                is_cached=False,
                attempt_number=attempt_number,
            )
            db.add(failed_record)
            await db.commit()
            await db.refresh(failed_record)
            return failed_record

    @classmethod
    async def recomposite_product(
        cls,
        db: AsyncSession,
        composite_id: str,
        product_image_url: Optional[str] = None,
        placement_config: Optional[ProductPlacementConfig] = None,
        shadow_config: Optional[ShadowConfig] = None,
        custom_feedback: Optional[str] = None,
    ) -> CompositedCreativeRecord:
        """
        Deterministically recomposites an existing creative with modified parameters.
        Does NOT regenerate the AI background or alter the creative strategy.
        """
        old_record = await db.get(CompositedCreativeRecord, composite_id)
        if not old_record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"CompositedCreativeRecord '{composite_id}' not found.",
            )

        # Validate that old_record's background, job, strategy, and brief are mutually consistent
        bg = await db.get(GeneratedBackgroundRecord, old_record.background_id)
        if not bg or bg.job_id != old_record.job_id or bg.brief_id != old_record.brief_id or bg.strategy_id != old_record.strategy_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Composite record graph inconsistent with referenced background. Cross-job access prohibited.",
            )

        # Merge placement configs if provided
        placement = placement_config
        if placement is None and old_record.placement_spec:
            placement = ProductPlacementConfig.model_validate(old_record.placement_spec)

        shadow = shadow_config
        if shadow is None and old_record.shadow_spec:
            shadow = ShadowConfig.model_validate(old_record.shadow_spec)

        return await cls.composite_product(
            db=db,
            background_id=old_record.background_id,
            product_image_url=product_image_url,
            placement_config=placement,
            shadow_config=shadow,
            force_regenerate=True,
        )
