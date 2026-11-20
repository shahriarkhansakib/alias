import io
import time
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, Tuple, List
from PIL import Image, ImageFilter, ImageChops

from app.schemas.composite import CutoutMetadata
from app.core.logging import logger


class ProductCutoutProvider(ABC):
    """
    Abstract interface for product cutout extraction / background removal.
    Guarantees vendor-neutral isolation so production segmentation providers
    (e.g., BiRefNet, RMBG, Rembg, AWS Rekognition) can be plugged in seamlessly.
    """

    @abstractmethod
    async def extract_cutout(
        self,
        image_bytes: bytes,
        asset_metadata: Optional[Dict[str, Any]] = None,
    ) -> Tuple[bytes, CutoutMetadata]:
        """
        Extracts a clean product cutout with alpha transparency.
        Returns:
            Tuple[bytes, CutoutMetadata]: (PNG bytes with alpha channel, extraction metadata)
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


class DeterministicCutoutProvider(ProductCutoutProvider):
    """
    Deterministic Product Cutout Provider for zero-cost offline development and testing.
    - If the input image already possesses an alpha channel, respects and preserves it.
    - If the input image has a solid background (e.g. white/light studio background),
      deterministically separates the product using corner-sampling and chroma difference.
    - Offers simulation toggles for adversarial and regression test coverage.
    """

    def __init__(
        self,
        provider_name: str = "deterministic_cutout",
        model_name: str = "chroma-mask-v1",
        simulate_failure: bool = False,
        simulate_transparent: bool = False,
        simulate_opaque: bool = False,
        simulate_corrupt: bool = False,
        simulate_cropped: bool = False,
    ):
        self._provider_name = provider_name
        self._model_name = model_name
        self.simulate_failure = simulate_failure
        self.simulate_transparent = simulate_transparent
        self.simulate_opaque = simulate_opaque
        self.simulate_corrupt = simulate_corrupt
        self.simulate_cropped = simulate_cropped

    @property
    def provider_name(self) -> str:
        return self._provider_name

    @property
    def model_name(self) -> str:
        return self._model_name

    async def extract_cutout(
        self,
        image_bytes: bytes,
        asset_metadata: Optional[Dict[str, Any]] = None,
    ) -> Tuple[bytes, CutoutMetadata]:
        start_time = time.perf_counter()

        if self.simulate_failure:
            raise RuntimeError("Simulated cutout extraction failure (segmentation provider error)")

        if self.simulate_corrupt:
            return b"CORRUPTED_CUTOUT_BYTES_12345", CutoutMetadata(
                provider=self.provider_name,
                model_name=self.model_name,
                input_dimensions=[0, 0],
                output_dimensions=[0, 0],
                alpha_coverage=0.0,
                bounding_box=[0, 0, 0, 0],
                opaque_pixels=0,
                processing_time_ms=0.5,
                status="corrupt",
            )

        try:
            img = Image.open(io.BytesIO(image_bytes))
        except Exception as e:
            raise ValueError(f"Cannot decode source product image for cutout extraction: {str(e)}")

        orig_w, orig_h = img.size

        if self.simulate_transparent:
            # Completely transparent image
            transparent_img = Image.new("RGBA", (orig_w, orig_h), (0, 0, 0, 0))
            buf = io.BytesIO()
            transparent_img.save(buf, format="PNG")
            return buf.getvalue(), CutoutMetadata(
                provider=self.provider_name,
                model_name=self.model_name,
                input_dimensions=[orig_w, orig_h],
                output_dimensions=[orig_w, orig_h],
                alpha_coverage=0.0,
                bounding_box=[0, 0, 0, 0],
                opaque_pixels=0,
                processing_time_ms=round((time.perf_counter() - start_time) * 1000, 2),
                status="transparent",
            )

        if self.simulate_cropped:
            # Microscopic 2x2 crop to trigger excessive cropping failure
            micro_img = Image.new("RGBA", (orig_w, orig_h), (0, 0, 0, 0))
            micro_img.putpixel((orig_w // 2, orig_h // 2), (255, 0, 0, 255))
            buf = io.BytesIO()
            micro_img.save(buf, format="PNG")
            return buf.getvalue(), CutoutMetadata(
                provider=self.provider_name,
                model_name=self.model_name,
                input_dimensions=[orig_w, orig_h],
                output_dimensions=[orig_w, orig_h],
                alpha_coverage=0.0001,
                bounding_box=[orig_w // 2, orig_h // 2, orig_w // 2 + 1, orig_h // 2 + 1],
                opaque_pixels=1,
                processing_time_ms=round((time.perf_counter() - start_time) * 1000, 2),
                status="micro_crop",
            )

        # 1. Inspect existing alpha channel
        has_usable_alpha = False
        rgba_img: Optional[Image.Image] = None

        if img.mode == "RGBA" and not self.simulate_opaque:
            alpha = img.split()[3]
            extrema = alpha.getextrema()  # (min, max)
            # If min < 255 and max > 0, we have genuine transparency
            if extrema[0] < 250 and extrema[1] > 0:
                has_usable_alpha = True
                rgba_img = img

        if not has_usable_alpha:
            # Deterministic chroma/corner segmentation for RGB/solid backdrop
            rgb_img = img.convert("RGB")
            # Sample corner colors to determine background tone
            corners = [
                rgb_img.getpixel((0, 0)),
                rgb_img.getpixel((orig_w - 1, 0)),
                rgb_img.getpixel((0, orig_h - 1)),
                rgb_img.getpixel((orig_w - 1, orig_h - 1)),
            ]
            bg_r = int(sum(c[0] for c in corners) / 4)
            bg_g = int(sum(c[1] for c in corners) / 4)
            bg_b = int(sum(c[2] for c in corners) / 4)

            # Generate alpha mask by calculating color distance from background
            r, g, b = rgb_img.split()
            diff_r = ImageChops.difference(r, Image.new("L", (orig_w, orig_h), bg_r))
            diff_g = ImageChops.difference(g, Image.new("L", (orig_w, orig_h), bg_g))
            diff_b = ImageChops.difference(b, Image.new("L", (orig_w, orig_h), bg_b))

            # Combine differences: diff = max(dr, dg, db)
            diff = ImageChops.lighter(diff_r, diff_g)
            diff = ImageChops.lighter(diff, diff_b)

            # Threshold: color difference > 20 is product foreground
            alpha_mask = diff.point(lambda p: 255 if p > 20 else int((p / 20) * 255))
            # Smooth mask edge slightly
            alpha_mask = alpha_mask.filter(ImageFilter.GaussianBlur(radius=1))

            rgba_img = rgb_img.convert("RGBA")
            rgba_img.putalpha(alpha_mask)

        # Calculate metadata
        alpha_channel = rgba_img.split()[3]
        bbox = alpha_channel.getbbox() or (0, 0, orig_w, orig_h)
        total_pixels = orig_w * orig_h
        # Non-zero alpha pixels
        alpha_hist = alpha_channel.histogram()
        opaque_pixels = sum(alpha_hist[1:])
        alpha_coverage = round(opaque_pixels / total_pixels, 4) if total_pixels > 0 else 0.0

        buffer = io.BytesIO()
        rgba_img.save(buffer, format="PNG", optimize=True)
        cutout_bytes = buffer.getvalue()

        processing_time_ms = round((time.perf_counter() - start_time) * 1000, 2)
        metadata = CutoutMetadata(
            provider=self.provider_name,
            model_name=self.model_name,
            input_dimensions=[orig_w, orig_h],
            output_dimensions=[orig_w, orig_h],
            alpha_coverage=alpha_coverage,
            bounding_box=list(bbox),
            opaque_pixels=opaque_pixels,
            processing_time_ms=processing_time_ms,
            status="SUCCESS",
        )

        logger.info(
            f"Extracted product cutout ({orig_w}x{orig_h}, alpha coverage {alpha_coverage*100:.1f}%, "
            f"bbox {list(bbox)}) in {processing_time_ms}ms"
        )
        return cutout_bytes, metadata


_current_cutout_provider: Optional[ProductCutoutProvider] = None


def get_product_cutout_provider() -> ProductCutoutProvider:
    global _current_cutout_provider
    if _current_cutout_provider is None:
        _current_cutout_provider = DeterministicCutoutProvider()
    return _current_cutout_provider


def set_product_cutout_provider(provider: ProductCutoutProvider) -> None:
    global _current_cutout_provider
    _current_cutout_provider = provider
