from typing import Tuple, Optional
from PIL import Image

from app.templates.registry import SlotBounds
from app.schemas.composite import (
    ProductPlacementConfig,
    PlacementAlignment,
    PixelPlacementResult,
)
from app.core.logging import logger


class ProductPositioner:
    """
    Deterministic Product Placement and Scaling Engine.
    Enforces that product cutout placement:
    1. Preserves exact product aspect ratio without stretching or distortion.
    2. Uses high-quality Lanczos resampling.
    3. Fits within the configured Platform/Template product-safe region.
    4. Follows deterministic alignment rules without LLM pixel hallucination.
    """

    @classmethod
    def calculate_placement(
        cls,
        canvas_width: int,
        canvas_height: int,
        cutout_width: int,
        cutout_height: int,
        safe_region: SlotBounds,
        config: Optional[ProductPlacementConfig] = None,
    ) -> PixelPlacementResult:
        cfg = config or ProductPlacementConfig()

        # 1. Convert normalized safe region to target pixel bounding box
        safe_x = int(canvas_width * safe_region.x)
        safe_y = int(canvas_height * safe_region.y)
        safe_w = int(canvas_width * safe_region.width)
        safe_h = int(canvas_height * safe_region.height)

        # 2. Account for configurable padding inside the safe slot
        pad_x = int(safe_w * cfg.padding_pct)
        pad_y = int(safe_h * cfg.padding_pct)
        usable_w = max(10, safe_w - (pad_x * 2))
        usable_h = max(10, safe_h - (pad_y * 2))

        # 3. Calculate uniform aspect-ratio-preserving scale factor
        scale_fit = min(usable_w / cutout_width, usable_h / cutout_height)
        final_scale = scale_fit * cfg.scale

        target_w = max(1, int(round(cutout_width * final_scale)))
        target_h = max(1, int(round(cutout_height * final_scale)))

        # 4. Deterministic Alignment within the product-safe zone
        if cfg.alignment == PlacementAlignment.CENTER:
            target_x = safe_x + (safe_w - target_w) // 2
            target_y = safe_y + (safe_h - target_h) // 2
        elif cfg.alignment == PlacementAlignment.BOTTOM:
            target_x = safe_x + (safe_w - target_w) // 2
            target_y = safe_y + safe_h - target_h - pad_y
        elif cfg.alignment == PlacementAlignment.TOP:
            target_x = safe_x + (safe_w - target_w) // 2
            target_y = safe_y + pad_y
        elif cfg.alignment == PlacementAlignment.LEFT:
            target_x = safe_x + pad_x
            target_y = safe_y + (safe_h - target_h) // 2
        elif cfg.alignment == PlacementAlignment.RIGHT:
            target_x = safe_x + safe_w - target_w - pad_x
            target_y = safe_y + (safe_h - target_h) // 2
        else:
            target_x = safe_x + (safe_w - target_w) // 2
            target_y = safe_y + (safe_h - target_h) // 2

        # 5. Apply manual pixel offsets
        target_x += cfg.offset_x
        target_y += cfg.offset_y

        # 6. Canvas boundary clamping: never allow product to escape canvas boundaries
        target_x = max(0, min(target_x, canvas_width - target_w))
        target_y = max(0, min(target_y, canvas_height - target_h))

        logger.info(
            f"Calculated product placement: pos=({target_x}, {target_y}), "
            f"size=({target_w}x{target_h}), scale={final_scale:.3f}, alignment={cfg.alignment.value}"
        )

        return PixelPlacementResult(
            x=target_x,
            y=target_y,
            width=target_w,
            height=target_h,
            normalized_slot=safe_region.to_coordinates(),
            canvas_width=canvas_width,
            canvas_height=canvas_height,
        )

    @classmethod
    def transform_product(
        cls,
        cutout: Image.Image,
        target_width: int,
        target_height: int,
    ) -> Image.Image:
        """
        Scales product cutout to target dimensions using high-quality Lanczos resampling.
        Preserves alpha channel and colour depth.
        """
        return cutout.resize((target_width, target_height), resample=Image.Resampling.LANCZOS)
