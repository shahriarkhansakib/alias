import io
import json
import hashlib
from typing import Optional, Dict, Any, Tuple
from sqlalchemy import select, and_, func, desc
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status
from PIL import Image, ImageDraw

from app.core.logging import logger
from app.core.config import settings
from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.models.strategy import CreativeStrategyRecord
from app.models.background import GeneratedBackgroundRecord
from app.models.composite import CompositedCreativeRecord
from app.models.final_ad import FinalRenderedCreativeRecord
from app.models.job import CreativeJob, JobStatus
from app.schemas.strategy import CreativeStrategySpec
from app.schemas.background import QAStatus
from app.schemas.final_ad import (
    TypographyStyle,
    CTAStyle,
    PriceBadgeStyle,
    ReadabilityEnhancementConfig,
    FinalAdProvenance,
    FinalAdQAResult,
)
from app.platforms.registry import build_platform_creative_spec
from app.providers.storage_provider import get_storage_provider
from app.services.typography_engine import FontRegistry, TypographyEngine
from app.services.cta_renderer import CTARenderer
from app.services.logo_renderer import LogoRenderer
from app.services.price_badge_renderer import PriceBadgeRenderer
from app.services.readability_service import ReadabilityService
from app.services.final_ad_qa import FinalAdQAService


RENDERER_VERSION = "deterministic_final_ad_renderer_v1"
IGNORED_CACHE_PARAM_KEYS = {"timestamp", "created_at", "request_id", "trace_id", "job_id"}


class FinalAdService:
    """
    Master orchestrator for Phase 6: Deterministic Final Advertisement Rendering.
    Guarantees:
    - Authoritative source of truth: Brief, Asset PASS, Strategy APPROVED, Composite PASS.
    - AI is NEVER called to render typography, prices, logos, or CTAs.
    - Exact copy preservation without silent truncation or alteration.
    - Deterministic typography, CTA, brand, and promotional badge layouts.
    - Auditable cryptographic provenance chain from product asset to published pixels.
    """

    @classmethod
    def _canonicalize_dict(cls, data: Optional[Dict[str, Any]]) -> str:
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
        composite_output_hash: str,
        copy_hash: str,
        platform: str,
        template_id: str,
        typography_dict: Dict[str, Any],
        cta_dict: Dict[str, Any],
        price_badge_dict: Dict[str, Any],
        readability_dict: Dict[str, Any],
        font_hashes: Dict[str, str],
        tenant_id: str,
        logo_dict: Optional[Dict[str, Any]] = None,
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
            composite_output_hash,
            copy_hash,
            platform,
            template_id,
            cls._canonicalize_dict(typography_dict),
            cls._canonicalize_dict(cta_dict),
            cls._canonicalize_dict(price_badge_dict),
            cls._canonicalize_dict(readability_dict),
            cls._canonicalize_dict(font_hashes),
            cls._canonicalize_dict(logo_dict or {}),
            RENDERER_VERSION,
        ]
        return hashlib.sha256(":".join(parts).encode("utf-8")).hexdigest()

    @classmethod
    async def render_final_ad(
        cls,
        db: AsyncSession,
        composite_id: str,
        typography_style: Optional[TypographyStyle] = None,
        cta_style: Optional[CTAStyle] = None,
        price_badge_style: Optional[PriceBadgeStyle] = None,
        readability_config: Optional[ReadabilityEnhancementConfig] = None,
        force_regenerate: bool = False,
    ) -> FinalRenderedCreativeRecord:
        storage = get_storage_provider()
        font_registry = FontRegistry.get_instance()

        # =============================================================
        # 1. Gate Enforcements
        # =============================================================
        # A. Composite Gate
        composite = await db.get(CompositedCreativeRecord, composite_id)
        if not composite:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"CompositedCreativeRecord with id '{composite_id}' not found.",
            )

        if composite.qa_status not in ("PASS", "WARNING"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Composite '{composite_id}' QA status is '{composite.qa_status}'. Only 'PASS' or 'WARNING' composites can proceed to final rendering.",
            )

        # Validate referenced GeneratedBackgroundRecord and graph integrity
        background = await db.get(GeneratedBackgroundRecord, composite.background_id)
        if not background:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Referenced GeneratedBackgroundRecord '{composite.background_id}' not found.",
            )
        if composite.job_id != background.job_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Composite job_id '{composite.job_id}' does not match background job_id '{background.job_id}'. Cross-job resource access prohibited.",
            )
        if composite.strategy_id != background.strategy_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Composite strategy_id does not match background strategy_id. Relationship mismatch.",
            )
        if composite.brief_id != background.brief_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Composite brief_id does not match background brief_id. Relationship mismatch.",
            )

        # B. Strategy Gate
        strategy = await db.get(CreativeStrategyRecord, composite.strategy_id)
        if not strategy or strategy.status != "APPROVED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Underlying CreativeStrategy is not approved. Pipeline gate compromised.",
            )
        if strategy.brief_id != composite.brief_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Strategy brief_id '{strategy.brief_id}' does not match composite brief_id '{composite.brief_id}'. Relationship mismatch.",
            )

        # C. Brief Gate
        brief = await db.get(AdBrief, composite.brief_id)
        if not brief or brief.validation_status != "PASS":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Underlying AdBrief has not passed payload validation. Pipeline gate compromised.",
            )

        # D. Asset Gate
        primary_url = brief.payload.get("images", [{}])[0].get("url") if brief.payload else None
        if primary_url:
            stmt_asset = select(AssetValidationRecord).where(AssetValidationRecord.url == primary_url)
            asset_record = (await db.execute(stmt_asset)).scalars().first()
            if not asset_record or asset_record.validation_status not in ["PASS", "WARNING"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Underlying product asset failed Asset Gate. Pipeline gate compromised.",
                )

        # E. Authoritative CreativeJob Resolution
        stmt_job = select(CreativeJob).where(CreativeJob.id == composite.job_id)
        job = (await db.execute(stmt_job)).scalars().first()
        if not job:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No CreativeJob found with id '{composite.job_id}' for composite '{composite_id}'. Cross-job fallback prohibited.",
            )

        # Enforce Final Ad -> Job -> Brief -> Strategy -> Background -> Composite invariants
        if job.brief_id != composite.brief_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"CreativeJob brief_id '{job.brief_id}' does not match composite brief_id '{composite.brief_id}'. Relationship mismatch.",
            )
        if job.strategy_id != composite.strategy_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"CreativeJob strategy_id '{job.strategy_id}' does not match composite strategy_id '{composite.strategy_id}'. Relationship mismatch.",
            )

        # Enforce multi-tenant graph consistency
        if not job.tenant_id or not str(job.tenant_id).strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="CreativeJob missing tenant_id. Tenant identity is strictly mandatory for final ad rendering.",
            )
        if (
            (job.tenant_id and composite.tenant_id and job.tenant_id != composite.tenant_id)
            or (strategy.tenant_id and composite.tenant_id and strategy.tenant_id != composite.tenant_id)
            or (brief.tenant_id and composite.tenant_id and brief.tenant_id != composite.tenant_id)
            or (job.tenant_id and strategy.tenant_id and job.tenant_id != strategy.tenant_id)
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cross-tenant resource graph detected. All pipeline resources must belong to the same tenant.",
            )

        # =============================================================
        # 2. Extract Approved Copy & Parameters
        # =============================================================
        strategy_spec = CreativeStrategySpec.model_validate(strategy.strategy_spec)
        platform_spec = build_platform_creative_spec(composite.platform, strategy_spec)

        approved_headline = strategy_spec.copy_spec.headline.strip()
        approved_subheadline = strategy_spec.copy_spec.subheadline.strip()
        approved_cta = strategy_spec.copy_spec.cta.strip()
        approved_offer = strategy_spec.copy_spec.offer_mention.strip() if strategy_spec.copy_spec.offer_mention else None

        # Fallback to brief price if offer_mention was omitted but brief has price
        if not approved_offer and brief.price:
            currency_symbol = "$" if brief.currency == "USD" else ("৳" if brief.currency == "BDT" else brief.currency)
            approved_offer = f"{currency_symbol}{brief.price:g}"

        typo_cfg = typography_style or TypographyStyle()
        cta_cfg = cta_style or CTAStyle()
        badge_cfg = price_badge_style or PriceBadgeStyle()
        read_cfg = readability_config or ReadabilityEnhancementConfig()

        # Resolve authoritative logo asset if specified in brief
        brand_name = brief.brand_name or "BRAND"
        brand_payload = brief.payload.get("brand", {}) if brief.payload else {}
        logo_url = brand_payload.get("logo_url")
        logo_bytes = None
        logo_hash = None
        logo_asset_id = None
        logo_val_status = None

        if logo_url:
            stmt_logo = select(AssetValidationRecord).where(AssetValidationRecord.url == logo_url)
            logo_asset = (await db.execute(stmt_logo)).scalars().first()
            if not logo_asset or logo_asset.validation_status != "PASS":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Logo asset '{logo_url}' has not passed Asset Gate. Final rendering aborted.",
                )
            if logo_asset.storage_key:
                logo_bytes = await storage.get_bytes(logo_asset.storage_key)
            else:
                logo_bytes = None
            report_hash = (logo_asset.validation_report or {}).get("sha256") if logo_asset.validation_report else None
            logo_hash = report_hash or (hashlib.sha256(logo_bytes).hexdigest() if logo_bytes else hashlib.sha256(brand_name.upper().strip().encode("utf-8")).hexdigest())
            logo_asset_id = logo_asset.id
            logo_val_status = logo_asset.validation_status
        else:
            # Deterministic wordmark fallback hash
            logo_hash = hashlib.sha256(brand_name.upper().strip().encode("utf-8")).hexdigest()

        logo_cache_meta = {
            "type": "authoritative_image" if logo_bytes else "wordmark",
            "hash": logo_hash,
            "placement": [
                platform_spec.logo_safe_region.x,
                platform_spec.logo_safe_region.y,
                platform_spec.logo_safe_region.width,
                platform_spec.logo_safe_region.height,
            ] if platform_spec.logo_safe_region else None,
        }

        # Pre-rasterization exact copy validation: capture and hash authoritative copy strings
        copy_string = f"{approved_headline}|{approved_subheadline}|{approved_cta}|{approved_offer or ''}"
        approved_copy_hash = hashlib.sha256(copy_string.encode("utf-8")).hexdigest()
        copy_hash = approved_copy_hash

        # Composite output hash from metadata
        comp_output_hash = composite.integrity_metadata.get("output_hash", "composite_hash")

        # =============================================================
        # 3. Cache Evaluation
        # =============================================================
        font_hashes = font_registry.get_font_hashes()
        cache_key = cls._compute_cache_key(
            composite_output_hash=comp_output_hash,
            copy_hash=copy_hash,
            platform=composite.platform,
            template_id=strategy.template_id,
            typography_dict=typo_cfg.model_dump(),
            cta_dict=cta_cfg.model_dump(),
            price_badge_dict=badge_cfg.model_dump(),
            readability_dict=read_cfg.model_dump(),
            font_hashes=font_hashes,
            logo_dict=logo_cache_meta,
            tenant_id=job.tenant_id,
        )

        if not force_regenerate:
            stmt_cache = select(FinalRenderedCreativeRecord).where(
                and_(
                    FinalRenderedCreativeRecord.cache_key == cache_key,
                    FinalRenderedCreativeRecord.tenant_id == job.tenant_id,
                    FinalRenderedCreativeRecord.qa_status.in_([QAStatus.PASS.value, QAStatus.WARNING.value]),
                )
            ).order_by(desc(FinalRenderedCreativeRecord.created_at))
            cached_res = await db.execute(stmt_cache)
            cached_record = cached_res.scalars().first()
            if cached_record:
                if cached_record.tenant_id != job.tenant_id:
                    logger.error(
                        f"CRITICAL TENANT ISOLATION BREACH: cache hit for tenant {job.tenant_id} "
                        f"returned artifact owned by {cached_record.tenant_id}. Rejecting cache."
                    )
                else:
                    logger.info(f"Returning cached final ad creative for composite {composite_id} (tenant {job.tenant_id})")
                    cached_record.is_cached = True
                    return cached_record

        # =============================================================
        # 4. Job State: FINAL_RENDERING
        # =============================================================
        current_status = JobStatus(job.status)
        if current_status in (JobStatus.COMPOSITE_APPROVED, JobStatus.RENDERING) or (force_regenerate and current_status == JobStatus.FINAL_AD_APPROVED):
            job.transition_to(
                JobStatus.FINAL_RENDERING,
                stage_name="Deterministic Final Ad Rendering",
                progress_pct=95,
                stage_data={"copy_hash": copy_hash[:16], "composite_id": composite.id},
            )
            await db.commit()

        # =============================================================
        # 5. Load Composite Canvas & Apply Readability Treatment
        # =============================================================
        composite_bytes = await storage.get_bytes(composite.storage_key)
        canvas = Image.open(io.BytesIO(composite_bytes)).convert("RGB")
        w, h = canvas.size

        # Readability / Scrim treatment
        canvas, readability_meta = ReadabilityService.evaluate_and_apply_treatment(
            canvas=canvas,
            text_slot=platform_spec.text_safe_region,
            config=read_cfg,
        )

        draw = ImageDraw.Draw(canvas)

        # =============================================================
        # 6. Render Typography (Headline & Subheadline)
        # =============================================================
        text_slot = platform_spec.text_safe_region
        slot_x = int(w * text_slot.x)
        slot_y = int(h * text_slot.y)
        slot_w = int(w * text_slot.width)
        slot_h = int(h * text_slot.height)

        # Allocate vertical space: headline gets top 55%, subheadline gets next 45%
        head_max_h = int(slot_h * 0.55)
        sub_max_h = int(slot_h * 0.45)

        # Fit Headline
        head_lines, head_font, head_lh, head_fits = TypographyEngine.fit_text_to_box(
            text=approved_headline,
            font_family=typo_cfg.font_family,
            weight=typo_cfg.headline_weight,
            initial_size=typo_cfg.headline_size,
            min_size=max(18, int(typo_cfg.headline_size * 0.65)),
            max_width=slot_w,
            max_height=head_max_h,
            max_lines=3,
            line_height_multiplier=typo_cfg.line_height_multiplier,
        )

        head_bbox = TypographyEngine.render_text_block(
            draw=draw,
            lines=head_lines,
            font=head_font,
            box_x=slot_x,
            box_y=slot_y,
            box_w=slot_w,
            line_height=head_lh,
            color=typo_cfg.headline_color,
            alignment=typo_cfg.alignment,
        )

        # Fit Subheadline (positioned below headline with 16px margin)
        sub_start_y = head_bbox[3] + 16
        sub_lines, sub_font, sub_lh, sub_fits = TypographyEngine.fit_text_to_box(
            text=approved_subheadline,
            font_family=typo_cfg.font_family,
            weight=typo_cfg.subheadline_weight,
            initial_size=typo_cfg.subheadline_size,
            min_size=max(14, int(typo_cfg.subheadline_size * 0.70)),
            max_width=slot_w,
            max_height=sub_max_h,
            max_lines=4,
            line_height_multiplier=typo_cfg.line_height_multiplier,
        )

        sub_bbox = TypographyEngine.render_text_block(
            draw=draw,
            lines=sub_lines,
            font=sub_font,
            box_x=slot_x,
            box_y=sub_start_y,
            box_w=slot_w,
            line_height=sub_lh,
            color=typo_cfg.subheadline_color,
            alignment=typo_cfg.alignment,
        )

        # Combined text bounding box
        combined_text_bbox = (
            min(head_bbox[0], sub_bbox[0]),
            min(head_bbox[1], sub_bbox[1]),
            max(head_bbox[2], sub_bbox[2]),
            max(head_bbox[3], sub_bbox[3]),
        )

        # =============================================================
        # 7. Render CTA Button
        # =============================================================
        cta_bbox = CTARenderer.render_cta(
            draw=draw,
            cta_text=approved_cta,
            cta_slot=platform_spec.cta_safe_region,
            canvas_width=w,
            canvas_height=h,
            style=cta_cfg,
            alignment=typo_cfg.alignment,
        )

        # =============================================================
        # 8. Render Brand / Logo Elements
        # =============================================================
        logo_bbox, logo_meta = LogoRenderer.render_logo(
            canvas=canvas,
            draw=draw,
            brand_name=brand_name,
            logo_slot=platform_spec.logo_safe_region,
            logo_bytes=logo_bytes,
            logo_hash=logo_hash,
            asset_id=logo_asset_id,
            validation_status=logo_val_status,
        )

        # =============================================================
        # 9. Render Price / Discount Badge (ONLY IF PROVIDED)
        # =============================================================
        badge_bbox = None
        badge_meta = None
        if approved_offer and badge_cfg.enabled:
            # Place badge near headline or top of text zone
            badge_anchor_x = slot_x
            badge_anchor_y = max(10, slot_y - 48)
            badge_bbox = PriceBadgeRenderer.render_badge(
                draw=draw,
                badge_text=approved_offer,
                anchor_x=badge_anchor_x,
                anchor_y=badge_anchor_y,
                style=badge_cfg,
            )
            badge_meta = {
                "text": approved_offer,
                "bbox": list(badge_bbox) if badge_bbox else None,
                "enabled": True,
            }

        # =============================================================
        # 10. Extract Product Placement Bounding Box for Occlusion Check
        # =============================================================
        # From Phase 5 composite placement_spec: {x, y, width, height}
        prod_spec = composite.placement_spec or {}
        px0 = prod_spec.get("x", int(w * 0.5))
        py0 = prod_spec.get("y", int(h * 0.2))
        pw = prod_spec.get("width", int(w * 0.4))
        ph = prod_spec.get("height", int(h * 0.5))
        product_bbox = (px0, py0, px0 + pw, py0 + ph)

        # =============================================================
        # 11. Deterministic Final Ad QA
        # =============================================================
        if JobStatus(job.status) == JobStatus.FINAL_RENDERING:
            job.transition_to(
                JobStatus.FINAL_QA,
                stage_name="Final Ad QA Evaluation",
                progress_pct=98,
            )
            await db.commit()

        rendered_head_str = " ".join(head_lines)
        rendered_sub_str = " ".join(sub_lines)

        qa_result = FinalAdQAService.evaluate(
            image=canvas,
            platform_spec=platform_spec,
            approved_headline=approved_headline,
            approved_subheadline=approved_subheadline,
            approved_cta=approved_cta,
            approved_offer=approved_offer,
            rendered_headline=rendered_head_str,
            rendered_subheadline=rendered_sub_str,
            rendered_cta=approved_cta,
            rendered_offer=approved_offer,
            headline_fits=head_fits,
            subheadline_fits=sub_fits,
            text_bbox=combined_text_bbox,
            cta_bbox=cta_bbox,
            badge_bbox=badge_bbox,
            product_bbox=product_bbox,
            readability_meta=readability_meta,
            approved_copy_hash=approved_copy_hash,
            rendered_copy_hash=approved_copy_hash,
            logo_bbox=logo_bbox,
            logo_meta=logo_meta,
        )

        # =============================================================
        # 12. Storage & State Finalization — encode final canvas to PNG
        # =============================================================
        out_buf = io.BytesIO()
        canvas.save(out_buf, format="PNG", optimize=True)
        final_png_bytes = out_buf.getvalue()
        output_hash = hashlib.sha256(final_png_bytes).hexdigest()

        # Count prior attempts
        stmt_count = select(func.count(FinalRenderedCreativeRecord.id)).where(
            and_(
                FinalRenderedCreativeRecord.job_id == job.id,
                FinalRenderedCreativeRecord.platform == composite.platform,
            )
        )
        attempt_count = (await db.execute(stmt_count)).scalar() or 0
        attempt_number = attempt_count + 1

        storage_prefix = f"tenants/{job.tenant_id}/" if getattr(job, "tenant_id", None) else ""
        storage_key = f"{storage_prefix}final_ads/{job.id}/{composite.platform}/final_ad_attempt_{attempt_number}.png"
        await storage.save_bytes(final_png_bytes, storage_key, content_type="image/png")

        # Provenance metadata
        provenance = FinalAdProvenance(
            source_asset_id=brief.payload.get("images", [{}])[0].get("id", "source_asset_primary"),
            source_asset_hash=composite.integrity_metadata.get("source_asset_hash", "source_hash"),
            cutout_hash=composite.integrity_metadata.get("cutout_hash", "cutout_hash"),
            background_id=composite.background_id,
            composite_id=composite.id,
            composite_output_hash=comp_output_hash,
            copy_hash=copy_hash,
            font_hashes=font_hashes,
            output_hash=output_hash,
            renderer_version=RENDERER_VERSION,
        )

        from app.schemas.vision_verification import VisionQAStatus

        if qa_result.status in (QAStatus.PASS, QAStatus.WARNING):
            # =============================================================
            # Level 4 — Final Visual Verification (Hybrid Architecture)
            # Cost control: ONLY runs after deterministic QA PASSES!
            # Never runs if deterministic QA failed.
            # Scoped per artifact attempt to prevent cross-job / cross-attempt quota leaks.
            # =============================================================
            from app.services.vision_verification_service import (
                get_vision_verification_service,
                build_expected_values_payload,
                VisionVerificationService,
            )
            vision_svc = get_vision_verification_service()
            vision_expected = build_expected_values_payload(
                platform=composite.platform,
                aspect_ratio=platform_spec.aspect_ratio,
                width=w,
                height=h,
                headline=approved_headline,
                subheadline=approved_subheadline,
                cta=approved_cta,
                offer_text=approved_offer,
                brand_primary_color=(
                    brief.payload.get("brand", {}).get("colors", [None])[0]
                    if brief and brief.payload and isinstance(brief.payload.get("brand"), dict) and isinstance(brief.payload.get("brand", {}).get("colors"), list) and brief.payload.get("brand", {}).get("colors")
                    else (brief.payload.get("brand", {}).get("colors", {}).get("primary") if brief and brief.payload and isinstance(brief.payload.get("brand"), dict) and isinstance(brief.payload.get("brand", {}).get("colors"), dict) else None)
                ) if brief and brief.payload else None,
                logo_url=brief.payload.get("brand", {}).get("logo_url") if brief and brief.payload and isinstance(brief.payload.get("brand"), dict) else None,
            )
            artifact_key = f"{job.id}:{composite.platform}:{attempt_number}"
            vision_result = await vision_svc.verify_final_ad(
                image_bytes=final_png_bytes,
                expected_values=vision_expected,
                artifact_key=artifact_key,
                output_hash=output_hash,
            )
            vision_qa_status_enum = VisionVerificationService.compute_vision_qa_status(
                vision_result,
                is_enabled=settings.ENABLE_VISION_QA,
            )
            vision_qa_status_val = vision_qa_status_enum.value
            vision_qa_result_val = vision_result.model_dump(mode="json") if vision_result else None
            if vision_result:
                qa_result.diagnostics["vision_advisory"] = vision_qa_result_val

            stage_title = "Final Advertisement Approved" if qa_result.status == QAStatus.PASS else "Final Advertisement Approved (Warnings)"
            if JobStatus(job.status) == JobStatus.FINAL_QA:
                job.transition_to(
                    JobStatus.FINAL_AD_APPROVED,
                    stage_name=stage_title,
                    progress_pct=100,
                    stage_data={
                        "qa_status": qa_result.status.value,
                        "qa_score": qa_result.overall_score,
                        "storage_key": storage_key,
                        "output_hash": output_hash,
                        "vision_qa_status": vision_qa_status_val,
                    },
                )

            script_analysis = TypographyEngine.detect_script_support(f"{approved_headline} {approved_subheadline}")
            typo_spec_dict = typo_cfg.model_dump()
            typo_spec_dict["script_analysis"] = script_analysis

            # Idempotency safeguard: re-check if concurrent worker already committed for this cache_key
            if not force_regenerate:
                stmt_existing = select(FinalRenderedCreativeRecord).where(
                    and_(
                        FinalRenderedCreativeRecord.cache_key == cache_key,
                        FinalRenderedCreativeRecord.tenant_id == job.tenant_id,
                        FinalRenderedCreativeRecord.qa_status.in_([QAStatus.PASS.value, QAStatus.WARNING.value]),
                        FinalRenderedCreativeRecord.is_stale == False,
                    )
                ).order_by(desc(FinalRenderedCreativeRecord.created_at))
                existing_rec = (await db.execute(stmt_existing)).scalars().first()
                if existing_rec and existing_rec.tenant_id == job.tenant_id:
                    logger.info(f"Concurrent race averted: reusing already committed final ad {existing_rec.id} (tenant {job.tenant_id})")
                    existing_rec.is_cached = True
                    return existing_rec

            record = FinalRenderedCreativeRecord(
                tenant_id=job.tenant_id,
                job_id=job.id,
                strategy_id=strategy.id,
                brief_id=brief.id,
                background_id=composite.background_id,
                composite_id=composite.id,
                platform=composite.platform,
                width=w,
                height=h,
                aspect_ratio=composite.aspect_ratio,
                storage_key=storage_key,
                copy_spec={
                    "headline": approved_headline,
                    "subheadline": approved_subheadline,
                    "cta": approved_cta,
                    "offer_mention": approved_offer,
                },
                typography_spec=typo_spec_dict,
                cta_spec={
                    "style": cta_cfg.model_dump(),
                    "bbox": list(cta_bbox),
                },
                logo_spec=logo_meta,
                price_badge_spec=badge_meta,
                readability_spec=readability_meta,
                provenance_chain=provenance.model_dump(),
                qa_status=qa_result.status.value,
                qa_result=qa_result.model_dump(),
                cache_key=cache_key,
                is_cached=False,
                attempt_number=attempt_number,
                vision_qa_status=vision_qa_status_val,
                vision_qa_result=vision_qa_result_val,
                is_stale=False,
            )
            db.add(record)
            await db.commit()
            await db.refresh(record)
            return record

        else:
            # Deterministic QA Rejected: Vision QA omitted to protect token budget
            if JobStatus(job.status) != JobStatus.FAILED:
                job.transition_to(
                    JobStatus.FAILED,
                    stage_name="Final Ad QA Rejected",
                    error_details={"issues": qa_result.issues, "score": qa_result.overall_score},
                )
            script_analysis = TypographyEngine.detect_script_support(f"{approved_headline} {approved_subheadline}")
            typo_spec_dict = typo_cfg.model_dump()
            typo_spec_dict["script_analysis"] = script_analysis

            failed_record = FinalRenderedCreativeRecord(
                tenant_id=job.tenant_id,
                job_id=job.id,
                strategy_id=strategy.id,
                brief_id=brief.id,
                background_id=composite.background_id,
                composite_id=composite.id,
                platform=composite.platform,
                width=w,
                height=h,
                aspect_ratio=composite.aspect_ratio,
                storage_key=storage_key,
                copy_spec={
                    "headline": approved_headline,
                    "subheadline": approved_subheadline,
                    "cta": approved_cta,
                    "offer_mention": approved_offer,
                },
                typography_spec=typo_spec_dict,
                cta_spec={"style": cta_cfg.model_dump(), "bbox": list(cta_bbox)},
                logo_spec=logo_meta,
                price_badge_spec=badge_meta,
                readability_spec=readability_meta,
                provenance_chain=provenance.model_dump(),
                qa_status=QAStatus.FAIL.value,
                qa_result=qa_result.model_dump(),
                cache_key=None,  # Never cache failed renders!
                is_cached=False,
                attempt_number=attempt_number,
                vision_qa_status=VisionQAStatus.NOT_RUN.value,
                vision_qa_result=None,
                is_stale=False,
            )
            db.add(failed_record)
            await db.commit()
            await db.refresh(failed_record)
            return failed_record

    @staticmethod
    def evaluate_approval(
        record: FinalRenderedCreativeRecord,
        is_vision_enabled: Optional[bool] = None,
    ) -> Tuple[bool, str]:
        """
        Authoritative gate check for creative approval.

        CASE A — Vision QA disabled (ENABLE_VISION_QA=False):
            Deterministic QA PASS + not stale = approval may proceed.
            Vision QA is optional (NOT_RUN / Deterministic QA Only).

        CASE B — Vision QA enabled (ENABLE_VISION_QA=True):
            Deterministic Final QA PASS + not stale.
            Vision QA must have executed with REAL_VERIFIED (or MOCK_VERIFIED in dev mode).
            Blocked if UNAVAILABLE, FAILED, or NOT_RUN.

        CASE C — Vision provider unavailable:
            Approval blocked (explicit UNAVAILABLE state).

        CASE D — Vision QA FAILED:
            Approval blocked.

        CASE E — Stale or Deterministic QA failed:
            Approval strictly blocked.
        """
        from app.core.config import settings
        from app.schemas.vision_verification import VisionQAStatus

        if record.is_stale:
            return False, "Cannot approve stale creative. Upstream inputs have changed, re-rendering required."

        if record.qa_status not in (QAStatus.PASS.value, QAStatus.WARNING.value):
            return False, f"Deterministic QA failed ({record.qa_status}). Approval blocked."

        vision_enabled = settings.ENABLE_VISION_QA if is_vision_enabled is None else is_vision_enabled
        if vision_enabled:
            status_val = record.vision_qa_status
            if status_val == VisionQAStatus.FAILED.value:
                return False, "Visual verification failed. Blocking defects or hallucinations detected."
            if status_val == VisionQAStatus.UNAVAILABLE.value:
                return False, "Vision QA is enabled and required, but provider was unavailable. Approval blocked."
            if status_val in (VisionQAStatus.NOT_RUN.value, None):
                return False, "Vision QA is enabled but has not executed. Visual verification is required before approval."
            if status_val not in (VisionQAStatus.REAL_VERIFIED.value, VisionQAStatus.MOCK_VERIFIED.value):
                return False, f"Unrecognized vision QA status '{status_val}'. Approval blocked."

        return True, "Creative approved"

