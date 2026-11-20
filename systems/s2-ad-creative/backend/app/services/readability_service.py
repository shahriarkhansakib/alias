from typing import Tuple, Dict, Any
from PIL import Image, ImageDraw, ImageFilter, ImageStat
from app.templates.registry import SlotBounds
from app.schemas.final_ad import ReadabilityEnhancementConfig


class ReadabilityService:
    """
    Deterministic Contrast and Readability Engine.
    Evaluates background luminance in the text zone and applies subtle scrims if needed
    to ensure text legibility without altering product pixels.
    """

    @classmethod
    def evaluate_and_apply_treatment(
        cls,
        canvas: Image.Image,
        text_slot: SlotBounds,
        config: ReadabilityEnhancementConfig,
    ) -> Tuple[Image.Image, Dict[str, Any]]:
        w, h = canvas.size
        tx0 = int(w * text_slot.x)
        ty0 = int(w * text_slot.y)
        tx1 = int(w * (text_slot.x + text_slot.width))
        ty1 = int(h * (text_slot.y + text_slot.height))

        # 1. Sample luminance of the text region
        crop = canvas.crop((tx0, ty0, tx1, ty1)).convert("L")
        stat = ImageStat.Stat(crop)
        mean_lum = stat.mean[0]
        stddev_lum = stat.stddev[0]

        treatment_applied = False
        treatment_type = "none"

        # 2. If background is light or busy in text zone, apply soft scrim
        # Light text (#FFFFFF) needs background luminance < 140
        if config.auto_scrim and (mean_lum > 140 or (mean_lum > 100 and stddev_lum > 40)):
            treatment_applied = True
            treatment_type = "gradient_scrim"

            # Create alpha overlay mask
            overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            draw = ImageDraw.Draw(overlay)

            # Draw soft backplate over text zone with margins
            pad = 20
            scrim_x0 = max(0, tx0 - pad)
            scrim_y0 = max(0, ty0 - pad)
            scrim_x1 = min(w, tx1 + pad)
            scrim_y1 = min(h, ty1 + pad)

            alpha_val = int(255 * config.scrim_opacity)
            draw.rounded_rectangle(
                [scrim_x0, scrim_y0, scrim_x1, scrim_y1],
                radius=16,
                fill=(15, 23, 42, alpha_val),
            )

            # Feather slightly for seamless integration
            blurred_overlay = overlay.filter(ImageFilter.GaussianBlur(radius=8))

            # Composite onto canvas
            canvas_rgba = canvas.convert("RGBA")
            canvas_rgba.alpha_composite(blurred_overlay)
            canvas = canvas_rgba.convert("RGB")

        metadata = {
            "mean_luminance": round(mean_lum, 2),
            "stddev_luminance": round(stddev_lum, 2),
            "scrim_applied": treatment_applied,
            "treatment_type": treatment_type,
        }

        return canvas, metadata
