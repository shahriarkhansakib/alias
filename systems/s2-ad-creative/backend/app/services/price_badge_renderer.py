from typing import Optional, Tuple
from PIL import ImageDraw
from app.schemas.final_ad import PriceBadgeStyle
from app.services.typography_engine import FontRegistry, TypographyEngine


class PriceBadgeRenderer:
    """
    Deterministic Price / Discount badge renderer.
    CRITICAL RULE: Renders ONLY when price/discount copy is explicitly present in the brief/strategy.
    Never invents promotional text, prices, or discounts.
    """

    @classmethod
    def render_badge(
        cls,
        draw: ImageDraw.ImageDraw,
        badge_text: Optional[str],
        anchor_x: int,
        anchor_y: int,
        style: PriceBadgeStyle,
    ) -> Optional[Tuple[int, int, int, int]]:
        """
        Renders price/discount badge at the specified anchor point.
        Returns bounding box (x0, y0, x1, y1) or None if badge_text is absent.
        """
        if not badge_text or not style.enabled:
            return None

        clean_text = badge_text.strip()
        if not clean_text:
            return None

        registry = FontRegistry.get_instance()
        font = registry.load_font("Inter", weight="bold", size=style.font_size)

        text_w, text_h = TypographyEngine.measure_text_line(clean_text, font)
        pad_x = 18
        pad_y = 8

        badge_w = text_w + (pad_x * 2)
        badge_h = text_h + (pad_y * 2)

        x0, y0 = anchor_x, anchor_y
        x1, y1 = anchor_x + badge_w, anchor_y + badge_h

        # Draw badge pill
        draw.rounded_rectangle(
            [x0, y0, x1, y1],
            radius=style.border_radius,
            fill=style.bg_color,
        )

        # Draw centered text
        text_x = x0 + pad_x
        text_y = y0 + pad_y - 2
        draw.text(
            (text_x, text_y),
            clean_text,
            font=font,
            fill=style.text_color,
        )

        return x0, y0, x1, y1
