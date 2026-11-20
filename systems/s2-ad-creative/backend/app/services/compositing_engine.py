import io
import hashlib
from typing import Tuple, Optional
from PIL import Image, ImageFilter

from app.schemas.composite import (
    ShadowConfig,
    PixelPlacementResult,
    ProductIntegrityMetadata,
)
from app.services.product_positioner import ProductPositioner
from app.core.logging import logger


class CompositingEngine:
    """
    Deterministic Compositing Engine.
    Combines the approved AI-synthesized background and the authenticated product cutout.
    Guarantees:
    - The customer product is authoritative and never altered or hallucinated.
    - Alpha blending is crisp and preserves transparent edges.
    - Contact / drop shadows are calculated deterministically from product alpha.
    """

    @classmethod
    def generate_shadow(
        cls,
        product_rgba: Image.Image,
        config: ShadowConfig,
    ) -> Tuple[Image.Image, int, int]:
        """
        Generates a deterministic soft shadow from the product's alpha channel.
        Returns:
            Tuple[Image.Image, int, int]: (shadow RGBA image, shadow offset_x, shadow offset_y)
        """
        w, h = product_rgba.size
        alpha = product_rgba.split()[3]

        # 1. Scale opacity of the alpha mask
        scaled_alpha = alpha.point(lambda p: int(p * config.opacity))

        # 2. Apply Gaussian blur for soft shadow edge falloff
        blurred_alpha = scaled_alpha.filter(ImageFilter.GaussianBlur(radius=config.blur_radius))

        # 3. Create black shadow image with blurred alpha
        shadow_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        shadow_color = Image.new("RGB", (w, h), (10, 12, 16))
        shadow_img.paste(shadow_color, (0, 0), mask=blurred_alpha)

        return shadow_img, config.offset_x, config.offset_y

    @classmethod
    def composite(
        cls,
        background_bytes: bytes,
        cutout_bytes: bytes,
        placement: PixelPlacementResult,
        shadow_config: Optional[ShadowConfig] = None,
        source_asset_id: str = "asset-primary",
        background_id: str = "bg-primary",
    ) -> Tuple[bytes, ProductIntegrityMetadata]:
        """
        Performs deterministic alpha compositing:
        background + optional shadow + product RGBA -> composited image bytes
        """
        # 1. Load background
        bg_img = Image.open(io.BytesIO(background_bytes)).convert("RGBA")

        # 2. Load cutout and scale with Lanczos
        cutout_img = Image.open(io.BytesIO(cutout_bytes)).convert("RGBA")
        scaled_product = ProductPositioner.transform_product(
            cutout=cutout_img,
            target_width=placement.width,
            target_height=placement.height,
        )

        # 3. Render optional deterministic shadow underneath product
        shadow_cfg = shadow_config or ShadowConfig()
        if shadow_cfg.enabled and shadow_cfg.opacity > 0:
            shadow_img, sh_dx, sh_dy = cls.generate_shadow(scaled_product, shadow_cfg)
            sh_x = placement.x + sh_dx
            sh_y = placement.y + sh_dy
            bg_img.paste(shadow_img, (sh_x, sh_y), mask=shadow_img.split()[3])

        # 4. Composite product RGBA on top using product alpha mask
        product_alpha = scaled_product.split()[3]
        bg_img.paste(scaled_product, (placement.x, placement.y), mask=product_alpha)

        # 5. Export high-quality composited image
        # Backgrounds for advertising are fully opaque RGB images
        final_rgb = bg_img.convert("RGB")
        out_buf = io.BytesIO()
        final_rgb.save(out_buf, format="PNG", optimize=True)
        composited_bytes = out_buf.getvalue()

        # 6. Compute cryptographic integrity hashes
        source_hash = hashlib.sha256(cutout_bytes).hexdigest()
        cutout_hash = hashlib.sha256(cutout_bytes).hexdigest()
        output_hash = hashlib.sha256(composited_bytes).hexdigest()

        integrity = ProductIntegrityMetadata(
            source_asset_id=source_asset_id,
            source_asset_hash=source_hash,
            cutout_hash=cutout_hash,
            background_id=background_id,
            output_hash=output_hash,
            compositing_method="deterministic_alpha_composite",
        )

        logger.info(
            f"Completed deterministic compositing: {final_rgb.size}, "
            f"output size={len(composited_bytes)} bytes, output_hash={output_hash[:16]}"
        )

        return composited_bytes, integrity
