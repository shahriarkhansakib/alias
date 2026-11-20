from typing import Tuple
from PIL import ImageDraw
from app.templates.registry import SlotBounds
from app.schemas.final_ad import CTAStyle
from app.services.typography_engine import FontRegistry, TypographyEngine


class CTARenderer:
    """
    Deterministic CTA button renderer.
    Renders configured CTA copy inside platform's designated cta_safe_slot.
    Guarantees exact copy preservation, pill/box geometry, and crisp contrast.
    """

    @classmethod
    def render_cta(
        cls,
        draw: ImageDraw.ImageDraw,
        cta_text: str,
        cta_slot: SlotBounds,
        canvas_width: int,
        canvas_height: int,
        style: CTAStyle,
        alignment: str = "left",
    ) -> Tuple[int, int, int, int]:
        """
        Renders the CTA button and returns (x0, y0, x1, y1) bounding box.
        """
        registry = FontRegistry.get_instance()
        font = registry.load_font("Inter", weight="bold", size=style.font_size)

        # 1. Slot pixel geometry
        slot_x = int(canvas_width * cta_slot.x)
        slot_y = int(canvas_height * cta_slot.y)
        slot_w = int(canvas_width * cta_slot.width)
        slot_h = int(canvas_height * cta_slot.height)

        # 2. Text measurement
        text_w, text_h = TypographyEngine.measure_text_line(cta_text, font)

        # 3. Button sizing with padding
        btn_w = min(slot_w, text_w + (style.padding_x * 2))
        btn_h = min(slot_h, text_h + (style.padding_y * 2))

        # 4. Button alignment within slot
        if alignment == "center":
            btn_x = slot_x + (slot_w - btn_w) // 2
        elif alignment == "right":
            btn_x = slot_x + slot_w - btn_w
        else:  # left
            btn_x = slot_x

        btn_y = slot_y + (slot_h - btn_h) // 2

        # 5. Draw rounded button container
        x0, y0 = btn_x, btn_y
        x1, y1 = btn_x + btn_w, btn_y + btn_h

        draw.rounded_rectangle(
            [x0, y0, x1, y1],
            radius=style.border_radius,
            fill=style.bg_color,
        )

        # 6. Draw centered text inside container
        text_x = btn_x + (btn_w - text_w) // 2
        text_y = btn_y + (btn_h - text_h) // 2 - 2  # slight optical baseline nudge

        draw.text(
            (text_x, text_y),
            cta_text,
            font=font,
            fill=style.text_color,
        )

        return x0, y0, x1, y1
