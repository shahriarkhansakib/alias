from typing import Optional, Dict, Any
from app.schemas.strategy import CreativeStrategySpec
from app.schemas.platform import PlatformCreativeSpec
from app.schemas.background import BackgroundGenerationPrompt
from app.templates.registry import get_template


PROHIBITED_ELEMENTS_NEGATIVE_PROMPT = (
    "text, typography, letters, digits, numbers, words, characters, font, subtitles, "
    "watermark, signature, logo, brand emblem, insignia, stamp, barcode, qr code, "
    "product, physical product, commercial packaging, bottle, box, watch, phone, gadget, "
    "duplicate object, fake device, replica, "
    "human, person, face, man, woman, fingers, hands, body, portrait, "
    "UI, user interface, buttons, menu, website banner, badge, price sticker, discount tag, "
    "low quality, blurry, noisy artifacts, cluttered, photobomb"
)


class BackgroundPromptBuilder:
    """
    Deterministic prompt builder for AI visual environment generation.
    Enforces the core rule:
    AI generates ONLY the visual environment / background.
    AI must NOT generate product images, replicas, labels, text, prices, CTAs, or logos.
    """

    @classmethod
    def build_prompt(
        cls,
        strategy: CreativeStrategySpec,
        platform_spec: PlatformCreativeSpec,
        attempt: int = 1,
        retry_feedback: Optional[str] = None,
    ) -> BackgroundGenerationPrompt:
        template = get_template(strategy.template_id)
        template_name = template.name if template else strategy.template_id

        # Slot bounding descriptions
        text_slot = platform_spec.text_safe_region
        prod_slot = platform_spec.product_safe_region

        # Compositional layout directives
        # Product zone description
        if prod_slot.x > 0.4:
            prod_pos_desc = "right side"
        elif prod_slot.x + prod_slot.width < 0.6:
            prod_pos_desc = "left side"
        else:
            prod_pos_desc = "center"

        # Text zone description
        if text_slot.x < 0.4:
            text_pos_desc = "left side"
        elif text_slot.x > 0.5:
            text_pos_desc = "right side"
        else:
            text_pos_desc = "upper/lower region"

        # Build clean positive prompt
        # We explicitly omit all brand claims, product names, prices, or user copy!
        prompt_parts = [
            f"Commercial advertising background environment for {platform_spec.platform.value.capitalize()} ({platform_spec.aspect_ratio}).",
            f"Visual atmosphere: {strategy.visual_direction.mood}.",
            f"Environment scenery: {strategy.visual_direction.background_direction.strip()}.",
            f"Lighting: {platform_spec.lighting_direction}.",
            f"Composition: Studio scene layout for {template_name}. Empty pedestal or stage area on the {prod_pos_desc} reserved for physical subject placement.",
            f"Negative space: The {text_pos_desc} must remain clean, smooth, low-frequency, and uncluttered with generous negative space and soft gradient lighting.",
            "Camera perspective: Professional studio macro-environment photography, shallow depth of field on distant background, crisp focal lighting on stage.",
            "Quality: Highly detailed ambient textures, 8k resolution, cinematic lighting, modern minimalist aesthetic, completely empty commercial scene.",
        ]

        # Targeted retry injection if QA failed on a prior attempt
        if retry_feedback:
            prompt_parts.append(f"TARGETED CORRECTION DIRECTIVE: {retry_feedback}")

        positive_prompt = " ".join(prompt_parts)

        # Build comprehensive negative prompt
        negative_parts = [PROHIBITED_ELEMENTS_NEGATIVE_PROMPT]
        if strategy.visual_direction.negative_prompt:
            negative_parts.append(strategy.visual_direction.negative_prompt)

        # Context-aware negative reinforcement
        if retry_feedback and "text" in retry_feedback.lower():
            negative_parts.append("letters, glyphs, alphabets, fake typography, symbols, written language, signs")
        if retry_feedback and "clutter" in retry_feedback.lower():
            negative_parts.append("busy textures, noise, high-frequency clutter, patterns in text zone")

        negative_prompt = ", ".join(dict.fromkeys(", ".join(negative_parts).split(", ")))

        return BackgroundGenerationPrompt(
            positive_prompt=positive_prompt,
            negative_prompt=negative_prompt,
            width=platform_spec.target_width,
            height=platform_spec.target_height,
            aspect_ratio=platform_spec.aspect_ratio,
            platform=platform_spec.platform,
            template_id=strategy.template_id,
            prompt_version=f"v1.0-attempt-{attempt}",
            metadata={
                "attempt": attempt,
                "template_name": template_name,
                "has_retry_feedback": bool(retry_feedback),
            },
        )
