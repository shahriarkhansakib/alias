"""
Phase 8: Generator for Representative Rendered Artifacts.
Renders 5 production-simulation creatives:
1. English (Facebook 1080x1080)
2. Bangla (Instagram 1080x1350)
3. Mixed Bangla-English (LinkedIn 1200x628)
4. Long Headline (Facebook 1080x1080)
5. Price + Discount Badge (Instagram 1080x1350)
Saves artifacts directly to the Antigravity artifact directory.
"""

import io
import os
import sys
import uuid
import asyncio
from pathlib import Path
from PIL import Image, ImageDraw

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.core.database import Base
from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.models.strategy import CreativeStrategyRecord
from app.models.job import CreativeJob, JobStatus
from app.models.background import GeneratedBackgroundRecord
from app.models.composite import CompositedCreativeRecord
from app.models.auth import Tenant, User, Membership, DEFAULT_TENANT_ID, DEFAULT_USER_ID
from app.schemas.platform import TargetPlatform
from app.schemas.strategy import (
    CreativeStrategySpec,
    ConceptSpec,
    VisualDirectionSpec,
    CopySpec,
    CopyPolicyType,
    PlacementDirection,
)
from app.schemas.final_ad import (
    TypographyStyle,
    CTAStyle,
    PriceBadgeStyle,
    ReadabilityEnhancementConfig,
)
from app.services.final_ad_service import FinalAdService
from app.providers.storage_provider import get_storage_provider
from app.demo.sample_assets import SMARTFIT_X1_DEMO_BRIEF, generate_demo_smartwatch_png

ARTIFACT_DIR = Path(r"C:\Users\annin\.gemini\antigravity-ide\brain\2fe70077-ff93-4246-8e9d-2c2556f5888e")


async def render_representative_artifacts():
    print(f"Starting Phase 8 representative artifact rendering...")
    print(f"Target artifact directory: {ARTIFACT_DIR}")

    # Set up in-memory sqlite engine
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async_session = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    storage = get_storage_provider()
    demo_png_bytes = generate_demo_smartwatch_png()

    scenarios = [
        {
            "filename": "phase8_rendered_english_facebook_1080x1080.png",
            "title": "English Creative",
            "platform": TargetPlatform.FACEBOOK,
            "width": 1080,
            "height": 1080,
            "aspect_ratio": "1:1",
            "headline": "SmartFit X1 Pro",
            "subheadline": "Precision titanium fitness tracker with 14-day battery life.",
            "cta": "Shop Now",
            "offer": None,
            "bg_color": (15, 23, 42),
            "accent_color": "#3B82F6",
            "badge_enabled": False,
        },
        {
            "filename": "phase8_rendered_bangla_instagram_1080x1350.png",
            "title": "Bangla-Only Creative",
            "platform": TargetPlatform.INSTAGRAM,
            "width": 1080,
            "height": 1350,
            "aspect_ratio": "4:5",
            "headline": "স্মার্টফিট প্রো এক্স১",
            "subheadline": "১৪ দিনের ব্যাটারি ব্যাকআপ সহ প্রিমিয়াম স্মার্টওয়াচ",
            "cta": "এখনই কিনুন",
            "offer": None,
            "bg_color": (20, 25, 35),
            "accent_color": "#10B981",
            "badge_enabled": False,
        },
        {
            "filename": "phase8_rendered_mixed_bangla_english_linkedin_1200x628.png",
            "title": "Mixed Bangla-English Creative",
            "platform": TargetPlatform.LINKEDIN,
            "width": 1200,
            "height": 628,
            "aspect_ratio": "1.91:1",
            "headline": "নতুন SmartFit Pro",
            "subheadline": "প্রিমিয়াম Titanium বডি ও 14-day ব্যাটারি",
            "cta": "Order Now",
            "offer": None,
            "bg_color": (17, 24, 39),
            "accent_color": "#6366F1",
            "badge_enabled": False,
        },
        {
            "filename": "phase8_rendered_long_headline_facebook_1080x1080.png",
            "title": "Long Headline Creative",
            "platform": TargetPlatform.FACEBOOK,
            "width": 1080,
            "height": 1080,
            "aspect_ratio": "1:1",
            "headline": "Experience Unmatched Performance and Intelligent Endurance Every Single Day",
            "subheadline": "Built for elite athletes with aerospace titanium and real-time heart metrics.",
            "cta": "Learn More",
            "offer": None,
            "bg_color": (24, 24, 27),
            "accent_color": "#EC4899",
            "badge_enabled": False,
        },
        {
            "filename": "phase8_rendered_price_discount_instagram_1080x1350.png",
            "title": "Price + Discount Creative",
            "platform": TargetPlatform.INSTAGRAM,
            "width": 1080,
            "height": 1350,
            "aspect_ratio": "4:5",
            "headline": "SmartFit X1 Special Edition",
            "subheadline": "Limited time seasonal promotion with immediate delivery.",
            "cta": "Claim Offer",
            "offer": "৳4,999 (25% OFF)",
            "bg_color": (15, 23, 42),
            "accent_color": "#F59E0B",
            "badge_enabled": True,
        },
    ]

    rendered_paths = []

    async with async_session() as session:
        # Seed tenant and user
        tenant = Tenant(id=DEFAULT_TENANT_ID, name="Default Org", slug="default-org")
        user = User(id=DEFAULT_USER_ID, email="dev@example.com", full_name="Dev", is_active=True)
        membership = Membership(id="mem-1", user_id=DEFAULT_USER_ID, tenant_id=DEFAULT_TENANT_ID, role="OWNER")
        session.add_all([tenant, user, membership])
        await session.flush()

        for s in scenarios:
            print(f"\n--- Generating: {s['title']} ({s['platform'].value}) ---")
            
            # 1. Brief
            brief_payload = dict(SMARTFIT_X1_DEMO_BRIEF)
            brief_payload["campaign"]["platforms"] = [s["platform"].value]
            if s["offer"]:
                brief_payload["offer"] = {"price": 4999.0, "currency": "BDT", "discount": "25% OFF"}

            brief = AdBrief(
                brand_name="SmartFit",
                product_name="SmartFit X1 Pro",
                price=4999.0 if s["offer"] else 999.0,
                currency="BDT",
                platforms=[s["platform"].value],
                validation_status="PASS",
                payload=brief_payload,
                tenant_id=DEFAULT_TENANT_ID,
            )
            session.add(brief)
            await session.flush()

            # 2. Asset
            asset_key = f"assets/{brief.id}/product.png"
            await storage.save_bytes(demo_png_bytes, asset_key, content_type="image/png")
            primary_url = brief_payload["images"][0]["url"]
            asset = AssetValidationRecord(
                url=primary_url,
                storage_key=asset_key,
                validation_status="PASS",
                width=800,
                height=800,
                has_alpha_channel=True,
                file_size_bytes=len(demo_png_bytes),
                tenant_id=DEFAULT_TENANT_ID,
            )
            session.add(asset)

            # Logo asset
            logo_url = f"http://example.com/logo_{s['platform'].value}.png"
            brief_payload["brand"]["logo_url"] = logo_url
            logo_img = Image.new("RGBA", (200, 60), color=(0, 0, 0, 0))
            d = ImageDraw.Draw(logo_img)
            d.rectangle([(0, 0), (199, 59)], fill=(59, 130, 246, 255))
            d.text((20, 20), "SmartFit", fill=(255, 255, 255, 255))
            logo_buf = io.BytesIO()
            logo_img.save(logo_buf, format="PNG")
            logo_bytes = logo_buf.getvalue()
            logo_key = f"assets/{brief.id}/logo.png"
            await storage.save_bytes(logo_bytes, logo_key, content_type="image/png")

            logo_asset = AssetValidationRecord(
                url=logo_url,
                storage_key=logo_key,
                validation_status="PASS",
                width=200,
                height=60,
                has_alpha_channel=True,
                file_size_bytes=len(logo_bytes),
                tenant_id=DEFAULT_TENANT_ID,
            )
            session.add(logo_asset)
            await session.flush()

            # 3. Strategy
            strat_spec = CreativeStrategySpec(
                concept=ConceptSpec(
                    name="Phase 8 Simulation",
                    creative_angle="High performance meets production reliability",
                    reasoning_notes="Phase 8 test spec",
                ),
                visual_direction=VisualDirectionSpec(
                    mood="clean modern luxury",
                    lighting="dramatic studio lighting",
                    background_direction="Minimalist dark studio with generous typography space",
                    negative_prompt="text, typography, watermark, logo, product, messy, blurry",
                    product_placement=PlacementDirection.RIGHT,
                    text_placement=PlacementDirection.LEFT,
                ),
                copy_spec=CopySpec(
                    headline=s["headline"],
                    subheadline=s["subheadline"],
                    cta=s["cta"],
                    offer_mention=s["offer"],
                    headline_policy=CopyPolicyType.AI_GENERATED_CREATIVE,
                    subheadline_policy=CopyPolicyType.FACTUAL,
                    cta_policy=CopyPolicyType.USER_PROVIDED,
                ),
                template_id="product_sale_dark",
            )
            strategy = CreativeStrategyRecord(
                brief_id=brief.id,
                version_number=1,
                status="APPROVED",
                template_id="product_sale_dark",
                strategy_spec=strat_spec.model_dump(),
                claim_validation_report={"passed": True, "unsupported_claims": [], "summary": "OK"},
                tenant_id=DEFAULT_TENANT_ID,
            )
            session.add(strategy)
            await session.flush()

            # 4. Job
            job = CreativeJob(
                brief_id=brief.id,
                strategy_id=strategy.id,
                status=JobStatus.COMPOSITE_APPROVED.value,
                current_stage="Composite Approved",
                tenant_id=DEFAULT_TENANT_ID,
            )
            session.add(job)
            await session.flush()

            # 5. Background image
            bg_img = Image.new("RGB", (s["width"], s["height"]), color=s["bg_color"])
            # Add a subtle stylish gradient / radial aura to make it look premium
            bg_draw = ImageDraw.Draw(bg_img)
            cx, cy = int(s["width"] * 0.7), int(s["height"] * 0.5)
            r = int(min(s["width"], s["height"]) * 0.4)
            bg_draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(s["bg_color"][0] + 15, s["bg_color"][1] + 18, s["bg_color"][2] + 25))

            bg_buf = io.BytesIO()
            bg_img.save(bg_buf, format="PNG")
            bg_bytes = bg_buf.getvalue()
            bg_key = f"backgrounds/{job.id}/{s['platform'].value}/bg.png"
            await storage.save_bytes(bg_bytes, bg_key, content_type="image/png")

            bg = GeneratedBackgroundRecord(
                job_id=job.id,
                brief_id=brief.id,
                strategy_id=strategy.id,
                platform=s["platform"].value,
                width=s["width"],
                height=s["height"],
                aspect_ratio=s["aspect_ratio"],
                storage_key=bg_key,
                provider="mock",
                model_name="mock-sdxl",
                prompt_spec={"prompt": "Dark minimalist studio background", "negative_prompt": "text, logo"},
                prompt_version="1.0",
                qa_status="PASS",
                qa_result={"status": "PASS", "overall_score": 0.96},
                cache_key=f"bg_cache_{uuid.uuid4().hex[:8]}",
                tenant_id=DEFAULT_TENANT_ID,
            )
            session.add(bg)
            await session.flush()

            # 6. Composite
            comp_img = bg_img.copy()
            # Composite demo product on the right
            prod_img = Image.open(io.BytesIO(demo_png_bytes)).convert("RGBA")
            target_pw = int(s["width"] * 0.40)
            target_ph = int(target_pw * (prod_img.height / prod_img.width))
            resized_prod = prod_img.resize((target_pw, target_ph), Image.Resampling.LANCZOS)
            px = int(s["width"] * 0.55)
            py = int((s["height"] - target_ph) * 0.5)
            comp_img.paste(resized_prod, (px, py), resized_prod)

            comp_buf = io.BytesIO()
            comp_img.save(comp_buf, format="PNG")
            comp_bytes = comp_buf.getvalue()
            comp_key = f"composites/{job.id}/{s['platform'].value}/comp.png"
            await storage.save_bytes(comp_bytes, comp_key, content_type="image/png")

            composite = CompositedCreativeRecord(
                job_id=job.id,
                brief_id=brief.id,
                strategy_id=strategy.id,
                background_id=bg.id,
                platform=s["platform"].value,
                width=s["width"],
                height=s["height"],
                aspect_ratio=s["aspect_ratio"],
                storage_key=comp_key,
                placement_spec={
                    "x": px,
                    "y": py,
                    "width": target_pw,
                    "height": target_ph,
                },
                shadow_spec={"enabled": True, "opacity": 0.35},
                integrity_metadata={
                    "source_asset_id": asset.id,
                    "source_asset_hash": "dummy_source_hash",
                    "cutout_hash": "dummy_cutout_hash",
                    "background_id": bg.id,
                    "output_hash": "dummy_comp_hash",
                    "compositing_method": "deterministic_pillow_v1",
                },
                qa_status="PASS",
                qa_result={"status": "PASS", "overall_score": 0.95},
                cache_key=f"comp_cache_{uuid.uuid4().hex[:8]}",
                tenant_id=DEFAULT_TENANT_ID,
            )
            session.add(composite)
            await session.commit()

            # 7. Render Final Ad via authoritative FinalAdService
            badge_cfg = PriceBadgeStyle(
                enabled=s["badge_enabled"],
                bg_color="#DC2626" if s["badge_enabled"] else "#1E293B",
                text_color="#FFFFFF",
            )
            cta_cfg = CTAStyle(
                enabled=True,
                bg_color=s["accent_color"],
                text_color="#FFFFFF",
                border_radius=8,
            )
            typo_cfg = TypographyStyle(
                font_family="Inter",
                headline_weight="bold",
                subheadline_weight="regular",
                headline_color="#FFFFFF",
                subheadline_color="#94A3B8",
            )
            readability_cfg = ReadabilityEnhancementConfig(
                auto_scrim=True,
                scrim_opacity=0.45,
            )

            final_record = await FinalAdService.render_final_ad(
                db=session,
                composite_id=composite.id,
                typography_style=typo_cfg,
                cta_style=cta_cfg,
                price_badge_style=badge_cfg,
                readability_config=readability_cfg,
                force_regenerate=True,
            )

            # Retrieve final rendered image bytes from storage
            final_bytes = await storage.get_bytes(final_record.storage_key)
            out_file = ARTIFACT_DIR / s["filename"]
            with open(out_file, "wb") as f:
                f.write(final_bytes)

            print(f"SUCCESS: Rendered {s['filename']} ({len(final_bytes)} bytes, {final_record.width}x{final_record.height}, QA: {final_record.qa_status})")
            rendered_paths.append(str(out_file))

    await engine.dispose()
    print("\nAll 5 representative artifacts rendered successfully!")
    return rendered_paths


if __name__ == "__main__":
    asyncio.run(render_representative_artifacts())
