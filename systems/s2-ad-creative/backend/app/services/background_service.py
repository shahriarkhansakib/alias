import hashlib
import json
from typing import Optional, Union, Dict, Any
from sqlalchemy import select, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status

from app.core.logging import logger
from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.models.job import CreativeJob, JobStatus
from app.models.strategy import CreativeStrategyRecord
from app.models.background import GeneratedBackgroundRecord
from app.schemas.strategy import CreativeStrategySpec
from app.schemas.platform import TargetPlatform
from app.schemas.background import (
    QAStatus,
    BackgroundQAResult,
    BackgroundGenerationPrompt,
)
from app.platforms.registry import build_platform_creative_spec
from app.services.background_prompt_builder import BackgroundPromptBuilder
from app.services.background_qa import BackgroundQAService
from app.providers.image_provider import (
    BackgroundImageProvider,
    get_background_image_provider,
)
from app.providers.storage_provider import get_storage_provider

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


class BackgroundService:
    """
    Dedicated service managing the Phase 4 AI background generation pipeline:
    - Platform Creative Spec derivation
    - Prompt construction with untrusted data isolation and negative space guidance
    - Provider invocation
    - Deterministic Background QA
    - Targeted diagnostic-aware regeneration (up to 3 attempts)
    - CreativeJob state transitions
    - Result caching and storage persistence

    ARCHITECTURAL NOTE (PHASE 4.1 HARDENING):
    In-process synchronous generation, SQLite/aiosqlite persistence, and local
    filesystem storage are development/MVP architectures designed for zero-dependency
    offline execution and testing. Production deployments will integrate distributed
    asynchronous workers (Celery, Temporal, or Redis Queue) and S3/GCS cloud object storage.
    """

    @classmethod
    def _canonicalize_params(cls, params: Optional[Dict[str, Any]]) -> str:
        """
        Creates a canonical, deterministic JSON representation of generation parameters.
        Ensures dictionary key ordering cannot produce different keys for equivalent parameters,
        and ensures non-generation metadata (e.g. request IDs, timestamps) does not invalidate the cache.
        """
        if not params:
            return "{}"
        filtered = {
            str(k): v
            for k, v in sorted(params.items())
            if str(k).lower() not in IGNORED_CACHE_PARAM_KEYS
        }
        return json.dumps(filtered, sort_keys=True, separators=(",", ":"))

    @classmethod
    def _compute_prompt_hash(cls, positive_prompt: str, negative_prompt: str) -> str:
        """
        Computes a deterministic hash of the positive and negative prompt content.
        Ensures changes in prompt structure or targeted retry feedback alter the cache key.
        """
        content = f"{positive_prompt.strip()}:::{negative_prompt.strip()}"
        return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]

    @classmethod
    def _compute_cache_key(
        cls,
        strategy_id: str,
        strategy_version: int,
        platform: str,
        template_id: str,
        prompt_version: str,
        provider_name: str,
        model_name: str,
        width: int,
        height: int,
        tenant_id: str,
        generation_params: Optional[Dict[str, Any]] = None,
        prompt_hash: Optional[str] = None,
    ) -> str:
        """
        Computes a comprehensive, deterministic SHA-256 cache key accounting for all
        factors that affect image synthesis, strictly isolated by tenant:
        - Mandatory tenant identity (rejects missing/empty tenant_id)
        - Strategy identity and version
        - Target platform and canvas dimensions (width, height)
        - Template ID
        - Prompt version and prompt content hash (positive + negative)
        - Provider and model names
        - Canonical generation parameters (seed, steps, guidance_scale, sampler, etc.)
        """
        if not tenant_id or not str(tenant_id).strip():
            raise ValueError(f"tenant_id is required and cannot be empty (got {tenant_id!r})")
        clean_tenant = str(tenant_id).strip()

        canonical_params = cls._canonicalize_params(generation_params)
        parts = [
            f"tenant:{clean_tenant}",
            strategy_id,
            str(strategy_version),
            platform,
            template_id,
            prompt_version,
            provider_name,
            model_name,
            str(width),
            str(height),
            prompt_hash or "",
            canonical_params,
        ]
        return hashlib.sha256(":".join(parts).encode("utf-8")).hexdigest()

    @classmethod
    async def generate_background(
        cls,
        db: AsyncSession,
        strategy_id: str,
        platform: Union[str, TargetPlatform] = TargetPlatform.INSTAGRAM,
        force_regenerate: bool = False,
        provider: Optional[BackgroundImageProvider] = None,
        max_attempts: int = 3,
        generation_params: Optional[Dict[str, Any]] = None,
    ) -> GeneratedBackgroundRecord:
        active_provider = provider or get_background_image_provider()
        storage = get_storage_provider()

        # Enforce maximum retry bound
        max_attempts = min(max(1, max_attempts), 3)

        # 1. Gate: Load and validate approved strategy
        strategy = await db.get(CreativeStrategyRecord, strategy_id)
        if not strategy:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"CreativeStrategy with id '{strategy_id}' not found.",
            )

        if strategy.status != "APPROVED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"CreativeStrategy '{strategy_id}' status is '{strategy.status}'. Only 'APPROVED' strategies can proceed to background generation.",
            )

        # 2. Gate: Verify underlying AdBrief exists and has passed Payload validation
        brief = await db.get(AdBrief, strategy.brief_id)
        if not brief or brief.validation_status != "PASS":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The underlying brief has not passed Payload validation. Pipeline gate compromised.",
            )

        # 3. Gate: Verify product asset has passed Asset Gate validation if recorded
        primary_url = brief.payload.get("images", [{}])[0].get("url") if brief.payload else None
        if primary_url:
            stmt_asset = (
                select(AssetValidationRecord)
                .where(AssetValidationRecord.url == primary_url)
                .order_by(desc(AssetValidationRecord.created_at))
            )
            asset_record = (await db.execute(stmt_asset)).scalars().first()
            if asset_record and asset_record.validation_status not in ["PASS", "WARNING"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="The underlying product asset has not passed Asset Gate validation. Pipeline gate compromised.",
                )

        # 4. Load associated CreativeJob strictly by strategy_id
        stmt = select(CreativeJob).where(
            and_(
                CreativeJob.strategy_id == strategy_id,
            )
        )
        res = await db.execute(stmt)
        job = res.scalars().first()

        if not job:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No CreativeJob found associated with strategy '{strategy_id}'. Cross-job fallback prohibited.",
            )

        # Enforce graph consistency: Job -> Brief -> Strategy
        if job.brief_id != strategy.brief_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"CreativeJob brief_id '{job.brief_id}' does not match strategy brief_id '{strategy.brief_id}'. Relationship mismatch.",
            )
        if job.strategy_id != strategy.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"CreativeJob strategy_id '{job.strategy_id}' does not match strategy id '{strategy.id}'. Relationship mismatch.",
            )

        # Enforce multi-tenant graph consistency
        if not job.tenant_id or not str(job.tenant_id).strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="CreativeJob missing tenant_id. Tenant identity is strictly mandatory for background generation.",
            )
        if (
            (job.tenant_id and strategy.tenant_id and job.tenant_id != strategy.tenant_id)
            or (brief.tenant_id and strategy.tenant_id and brief.tenant_id != strategy.tenant_id)
            or (job.tenant_id and brief.tenant_id and job.tenant_id != brief.tenant_id)
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cross-tenant resource graph detected. All pipeline resources must belong to the same tenant.",
            )

        # 5. Build Platform Creative Specification
        strategy_spec = CreativeStrategySpec.model_validate(strategy.strategy_spec)
        platform_spec = build_platform_creative_spec(platform, strategy_spec)

        # 6. Cache Evaluation: Compute deterministic prompt hash and initial cache key
        initial_prompt = BackgroundPromptBuilder.build_prompt(
            strategy=strategy_spec,
            platform_spec=platform_spec,
            attempt=1,
            retry_feedback=None,
        )
        initial_prompt_hash = cls._compute_prompt_hash(
            initial_prompt.positive_prompt,
            initial_prompt.negative_prompt,
        )

        cache_key = cls._compute_cache_key(
            strategy_id=strategy.id,
            strategy_version=strategy.version_number,
            platform=platform_spec.platform.value,
            template_id=strategy.template_id,
            prompt_version=initial_prompt.prompt_version,
            provider_name=active_provider.provider_name,
            model_name=active_provider.model_name,
            width=platform_spec.target_width,
            height=platform_spec.target_height,
            generation_params=generation_params,
            prompt_hash=initial_prompt_hash,
            tenant_id=job.tenant_id,
        )

        if not force_regenerate:
            cached_stmt = select(GeneratedBackgroundRecord).where(
                and_(
                    GeneratedBackgroundRecord.tenant_id == job.tenant_id,
                    GeneratedBackgroundRecord.cache_key == cache_key,
                    GeneratedBackgroundRecord.qa_status.in_([QAStatus.PASS.value, QAStatus.WARNING.value]),
                )
            ).order_by(GeneratedBackgroundRecord.created_at.desc())
            cached_res = await db.execute(cached_stmt)
            cached_record = cached_res.scalars().first()

            if cached_record and cached_record.tenant_id == job.tenant_id:
                logger.info(f"Returning cached background for strategy {strategy_id}, platform {platform_spec.platform.value} (tenant: {job.tenant_id})")
                cached_record.is_cached = True
                return cached_record

        # 7. Pipeline State Transition -> BACKGROUND_GENERATION
        try:
            if job.status == JobStatus.STRATEGY_VALIDATED.value:
                job.transition_to(
                    JobStatus.BACKGROUND_GENERATION,
                    stage_name="AI Background Generation",
                    progress_pct=50,
                    stage_data={
                        "platform": platform_spec.platform.value,
                        "target_dimensions": f"{platform_spec.target_width}x{platform_spec.target_height}",
                    },
                )
            elif job.status == JobStatus.FAILED.value:
                job.transition_to(
                    JobStatus.BACKGROUND_GENERATION,
                    stage_name="AI Background Generation (Retry)",
                    progress_pct=50,
                )
            elif job.status in (JobStatus.BACKGROUND_QA.value, JobStatus.BACKGROUND_APPROVED.value):
                job.transition_to(
                    JobStatus.REGENERATING,
                    stage_name="Background Re-generation",
                    progress_pct=50,
                )
                job.transition_to(
                    JobStatus.BACKGROUND_GENERATION,
                    stage_name="AI Background Generation",
                    progress_pct=50,
                )
            elif job.status != JobStatus.BACKGROUND_GENERATION.value:
                job.transition_to(
                    JobStatus.BACKGROUND_GENERATION,
                    stage_name="AI Background Generation",
                    progress_pct=50,
                )
            await db.commit()
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid job state transition for background generation: {str(e)}",
            )

        # 8. Targeted Generation Loop (up to max_attempts)
        last_retry_feedback: Optional[str] = None
        last_qa_result: Optional[BackgroundQAResult] = None
        last_prompt: Optional[BackgroundGenerationPrompt] = None
        last_image_bytes: Optional[bytes] = None

        for attempt in range(1, max_attempts + 1):
            if attempt > 1:
                logger.info(f"Starting targeted regeneration attempt {attempt}/{max_attempts} with feedback: {last_retry_feedback}")
                job.transition_to(
                    JobStatus.REGENERATING,
                    stage_name=f"Targeted Background Retry {attempt}",
                    progress_pct=50 + (attempt - 1) * 6,
                    stage_data={"attempt": attempt, "feedback": last_retry_feedback},
                )
                job.transition_to(
                    JobStatus.BACKGROUND_GENERATION,
                    stage_name=f"AI Background Generation (Attempt {attempt})",
                )
                await db.commit()

            # Build deterministic prompt with targeted feedback
            prompt = BackgroundPromptBuilder.build_prompt(
                strategy=strategy_spec,
                platform_spec=platform_spec,
                attempt=attempt,
                retry_feedback=last_retry_feedback,
            )
            if generation_params:
                prompt.metadata["generation_params"] = cls._canonicalize_params(generation_params)
            last_prompt = prompt

            # Invoke vendor-neutral Image Provider with generation_params
            try:
                image_bytes = await active_provider.generate_background(prompt, generation_params=generation_params)
                last_image_bytes = image_bytes
            except Exception as e:
                logger.error(f"Image generation provider failed on attempt {attempt}: {str(e)}")
                job.transition_to(
                    JobStatus.FAILED,
                    stage_name="Background Generation Failed",
                    error_details={"provider_error": str(e), "attempt": attempt},
                )
                await db.commit()
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Image generation provider error: {str(e)}",
                )

            # Transition to BACKGROUND_QA
            job.transition_to(
                JobStatus.BACKGROUND_QA,
                stage_name="Background QA Analysis",
                progress_pct=55 + (attempt - 1) * 6,
            )
            await db.commit()

            # Run deterministic Background QA
            qa_result = BackgroundQAService.evaluate(image_bytes, platform_spec)
            last_qa_result = qa_result

            # Evaluate QA Result: PASS or WARNING
            if qa_result.status in (QAStatus.PASS, QAStatus.WARNING):
                logger.info(f"Background QA {qa_result.status.value} on attempt {attempt} (score: {qa_result.overall_score:.2f})")

                # Store image
                storage_prefix = f"tenants/{job.tenant_id}/" if getattr(job, "tenant_id", None) else ""
                storage_key = f"{storage_prefix}backgrounds/{job.id}/{platform_spec.platform.value}_attempt_{attempt}.png"
                await storage.save_bytes(image_bytes, storage_key, content_type="image/png")

                # Compute attempt-specific cache key matching this successful attempt
                attempt_prompt_hash = cls._compute_prompt_hash(prompt.positive_prompt, prompt.negative_prompt)
                attempt_cache_key = cls._compute_cache_key(
                    strategy_id=strategy.id,
                    strategy_version=strategy.version_number,
                    platform=platform_spec.platform.value,
                    template_id=strategy.template_id,
                    prompt_version=prompt.prompt_version,
                    provider_name=active_provider.provider_name,
                    model_name=active_provider.model_name,
                    width=platform_spec.target_width,
                    height=platform_spec.target_height,
                    generation_params=generation_params,
                    prompt_hash=attempt_prompt_hash,
                    tenant_id=job.tenant_id,
                )

                # Transition Job to BACKGROUND_APPROVED with preserved status & diagnostics
                stage_title = "Background Approved" if qa_result.status == QAStatus.PASS else "Background Approved (with Warnings)"
                job.transition_to(
                    JobStatus.BACKGROUND_APPROVED,
                    stage_name=stage_title,
                    progress_pct=75,
                    stage_data={
                        "qa_status": qa_result.status.value,
                        "qa_score": qa_result.overall_score,
                        "warnings": qa_result.warnings,
                        "storage_key": storage_key,
                        "attempt": attempt,
                    },
                )

                # Persist Record with Cache Key
                record = GeneratedBackgroundRecord(
                    tenant_id=job.tenant_id,
                    job_id=job.id,
                    strategy_id=strategy.id,
                    brief_id=strategy.brief_id,
                    platform=platform_spec.platform.value,
                    width=platform_spec.target_width,
                    height=platform_spec.target_height,
                    aspect_ratio=platform_spec.aspect_ratio,
                    provider=active_provider.provider_name,
                    model_name=active_provider.model_name,
                    prompt_spec=prompt.model_dump(),
                    prompt_version=prompt.prompt_version,
                    attempt_number=attempt,
                    storage_key=storage_key,
                    qa_status=qa_result.status.value,
                    qa_result=qa_result.model_dump(),
                    cache_key=attempt_cache_key,
                    is_cached=False,
                )
                db.add(record)
                await db.commit()
                await db.refresh(record)
                return record

            else:
                # QA Failed: Log and record targeted feedback for retry
                logger.warning(
                    f"Background QA failed on attempt {attempt}: {qa_result.issues}. "
                    f"Guidance: {qa_result.retry_guidance}"
                )
                last_retry_feedback = qa_result.retry_guidance or "; ".join(qa_result.issues)

        # If all attempts exhausted: save audit record and mark job FAILED
        logger.error(f"Background generation QA failed after all {max_attempts} attempts.")
        storage_prefix = f"tenants/{job.tenant_id}/" if getattr(job, "tenant_id", None) else ""
        storage_key_failed = f"{storage_prefix}backgrounds/{job.id}/{platform_spec.platform.value}_failed_final.png"
        if last_image_bytes:
            await storage.save_bytes(last_image_bytes, storage_key_failed, content_type="image/png")

        job.transition_to(
            JobStatus.FAILED,
            stage_name="Background QA Rejected",
            error_details={
                "error": "Exhausted maximum background generation attempts without passing QA",
                "attempts": max_attempts,
                "issues": last_qa_result.issues if last_qa_result else [],
                "retry_guidance": last_retry_feedback,
            },
        )

        failed_record = GeneratedBackgroundRecord(
            tenant_id=job.tenant_id,
            job_id=job.id,
            strategy_id=strategy.id,
            brief_id=strategy.brief_id,
            platform=platform_spec.platform.value,
            width=platform_spec.target_width,
            height=platform_spec.target_height,
            aspect_ratio=platform_spec.aspect_ratio,
            provider=active_provider.provider_name,
            model_name=active_provider.model_name,
            prompt_spec=last_prompt.model_dump() if last_prompt else {},
            prompt_version=last_prompt.prompt_version if last_prompt else "v1.0-failed",
            attempt_number=max_attempts,
            storage_key=storage_key_failed,
            qa_status=QAStatus.FAIL.value,
            qa_result=last_qa_result.model_dump() if last_qa_result else {},
            cache_key=None,  # NEVER cache a failed background!
            is_cached=False,
        )
        db.add(failed_record)
        await db.commit()
        await db.refresh(failed_record)
        return failed_record

    @classmethod
    async def regenerate_background(
        cls,
        db: AsyncSession,
        background_id: str,
        custom_feedback: Optional[str] = None,
        provider: Optional[BackgroundImageProvider] = None,
        generation_params: Optional[Dict[str, Any]] = None,
    ) -> GeneratedBackgroundRecord:
        """
        Triggers targeted regeneration on an existing background record.
        Incorporates previous QA issues and optional developer feedback.
        Enforces maximum 3 attempts and pipeline security gates.
        """
        old_record = await db.get(GeneratedBackgroundRecord, background_id)
        if not old_record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"GeneratedBackgroundRecord '{background_id}' not found.",
            )

        # Enforce consistency of old_record graph
        strategy = await db.get(CreativeStrategyRecord, old_record.strategy_id)
        if not strategy or strategy.brief_id != old_record.brief_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Background record brief_id does not match strategy brief_id. Relationship mismatch.",
            )
        job = await db.get(CreativeJob, old_record.job_id)
        if not job or job.id != old_record.job_id or job.strategy_id != old_record.strategy_id or job.brief_id != old_record.brief_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Background record job graph inconsistent. Cross-job resource access prohibited.",
            )

        return await cls.generate_background(
            db=db,
            strategy_id=old_record.strategy_id,
            platform=old_record.platform,
            force_regenerate=True,
            provider=provider,
            max_attempts=3,
            generation_params=generation_params,
        )
