import io
import math
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
from PIL import Image, ImageDraw, ImageFilter
from app.schemas.background import BackgroundGenerationPrompt
from app.core.logging import logger


class BackgroundImageProvider(ABC):
    """
    Abstract interface for background image generation providers.
    Guarantees vendor-neutral isolation for visual environment synthesis.
    """

    @abstractmethod
    async def generate_background(
        self,
        prompt: BackgroundGenerationPrompt,
        generation_params: Optional[Dict[str, Any]] = None,
    ) -> bytes:
        """
        Synthesizes a visual environment background matching the requested dimensions and prompt.
        Returns raw image bytes (PNG or JPEG).
        """
        pass

    @property
    @abstractmethod
    def provider_name(self) -> str:
        pass

    @property
    @abstractmethod
    def model_name(self) -> str:
        pass


class MockBackgroundImageProvider(BackgroundImageProvider):
    """
    Deterministic Mock Background Image Provider.
    Allows zero-cost offline development and automated testing without external paid APIs.
    Produces high-fidelity studio background fixtures matching target dimensions and layouts.
    """

    def __init__(
        self,
        provider_name: str = "mock",
        model_name: str = "mock-studio-v1",
        simulate_failure: bool = False,
        simulate_bad_dimensions: bool = False,
        simulate_text_artifact: bool = False,
        simulate_watermark: bool = False,
        simulate_text_clutter: bool = False,
        simulate_product_obstruction: bool = False,
        simulate_brightness_issue: bool = False,
    ):
        self._provider_name = provider_name
        self._model_name = model_name
        self.simulate_failure = simulate_failure
        self.simulate_bad_dimensions = simulate_bad_dimensions
        self.simulate_text_artifact = simulate_text_artifact
        self.simulate_watermark = simulate_watermark
        self.simulate_text_clutter = simulate_text_clutter
        self.simulate_product_obstruction = simulate_product_obstruction
        self.simulate_brightness_issue = simulate_brightness_issue

    @property
    def provider_name(self) -> str:
        return self._provider_name

    @property
    def model_name(self) -> str:
        return self._model_name

    async def generate_background(
        self,
        prompt: BackgroundGenerationPrompt,
        generation_params: Optional[Dict[str, Any]] = None,
    ) -> bytes:
        if self.simulate_failure:
            raise RuntimeError("Simulated image generation provider failure (upstream API error)")

        # Target dimensions
        target_w = prompt.width
        target_h = prompt.height

        if self.simulate_bad_dimensions:
            target_w = target_w // 2
            target_h = target_h // 2

        # Base canvas: Dark luxury studio gradient (14, 18, 28)
        img = Image.new("RGB", (target_w, target_h), color=(14, 18, 28))
        draw = ImageDraw.Draw(img)

        # Draw ambient atmospheric soft lighting glow on right/product side
        # Leaving left side clean dark negative space
        glow_cx = int(target_w * 0.72)
        glow_cy = int(target_h * 0.52)
        glow_rx = int(target_w * 0.38)
        glow_ry = int(target_h * 0.42)

        # Multi-layer radial glow for smooth luxury gradient
        colors = [(20, 32, 54), (28, 48, 80), (36, 68, 110), (45, 90, 140)]
        for i, col in enumerate(colors):
            factor = (len(colors) - i) / len(colors)
            rx = int(glow_rx * factor)
            ry = int(glow_ry * factor)
            draw.ellipse(
                [glow_cx - rx, glow_cy - ry, glow_cx + rx, glow_cy + ry],
                fill=col,
            )

        # Smooth blur filter for natural studio gradient
        img = img.filter(ImageFilter.GaussianBlur(radius=int(min(target_w, target_h) * 0.05)))
        draw = ImageDraw.Draw(img)

        # Subtle studio floor / platform line near bottom
        floor_y = int(target_h * 0.82)
        draw.line([(0, floor_y), (target_w, floor_y)], fill=(30, 42, 64), width=2)

        # --- SIMULATION MODES FOR QA TESTING ---
        if self.simulate_text_artifact:
            # Draw obvious text-like artifact / letters
            draw.rectangle([int(target_w * 0.1), int(target_h * 0.3), int(target_w * 0.35), int(target_h * 0.38)], fill=(240, 240, 240))
            draw.text((int(target_w * 0.12), int(target_h * 0.32)), "PROMO 50% OFF SALE", fill=(10, 10, 10))

        if self.simulate_watermark:
            # Draw watermark in corner
            wm_x = int(target_w * 0.88)
            wm_y = int(target_h * 0.94)
            draw.rectangle([wm_x, wm_y, wm_x + int(target_w * 0.09), wm_y + int(target_h * 0.04)], fill=(200, 200, 200))
            draw.text((wm_x + 5, wm_y + 2), "COPYRIGHT", fill=(0, 0, 0))

        if self.simulate_text_clutter:
            # Fill the text-safe zone with dense, noisy high-frequency lines/grid
            for y_step in range(int(target_h * 0.18), int(target_h * 0.65), 10):
                for x_step in range(int(target_w * 0.08), int(target_w * 0.45), 12):
                    draw.rectangle([x_step, y_step, x_step + 8, y_step + 8], fill=(180, 190, 210))

        if self.simulate_product_obstruction:
            # Draw an unwanted big bright commercial object in the product-safe zone
            prod_cx = int(target_w * 0.70)
            prod_cy = int(target_h * 0.50)
            box_r = int(min(target_w, target_h) * 0.22)
            draw.rectangle([prod_cx - box_r, prod_cy - box_r, prod_cx + box_r, prod_cy + box_r], fill=(220, 80, 50))

        if self.simulate_brightness_issue:
            # Wash out the canvas with erratic, blinding brightness in the text zone
            draw.rectangle(
                [int(target_w * 0.05), int(target_h * 0.15), int(target_w * 0.5), int(target_h * 0.7)],
                fill=(250, 250, 250),
            )

        buffer = io.BytesIO()
        img.save(buffer, format="PNG", optimize=True)
        image_bytes = buffer.getvalue()
        logger.info(f"Generated mock background ({target_w}x{target_h}, {len(image_bytes)} bytes)")
        return image_bytes


_current_image_provider: Optional[BackgroundImageProvider] = None


def get_background_image_provider() -> BackgroundImageProvider:
    global _current_image_provider
    if _current_image_provider is None:
        _current_image_provider = MockBackgroundImageProvider()
    return _current_image_provider


def set_background_image_provider(provider: BackgroundImageProvider) -> None:
    global _current_image_provider
    _current_image_provider = provider
