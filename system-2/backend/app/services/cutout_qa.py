import io
from typing import List
from PIL import Image

from app.schemas.background import QAStatus
from app.schemas.composite import CutoutQAResult
from app.core.logging import logger


class CutoutQAService:
    """
    Deterministic QA service for validating extracted product cutouts before compositing.
    Enforces alpha channel presence, non-transparency, bounding box sanity, and proper framing.
    """

    @classmethod
    def evaluate(cls, cutout_bytes: bytes) -> CutoutQAResult:
        issues: List[str] = []
        warnings: List[str] = []

        # 1. Readability & Decode Check
        try:
            img = Image.open(io.BytesIO(cutout_bytes))
            w, h = img.size
            img_format = img.format or "PNG"
        except Exception as e:
            logger.error(f"Cutout image decoding failed: {str(e)}")
            return CutoutQAResult(
                status=QAStatus.FAIL,
                overall_score=0.0,
                is_readable=False,
                has_alpha=False,
                alpha_coverage=0.0,
                bounding_box=[0, 0, 0, 0],
                opaque_pixel_count=0,
                issues=[f"Corrupted or invalid cutout stream: {str(e)}"],
                warnings=[],
                details="Cutout byte stream cannot be decoded",
            )

        if w <= 0 or h <= 0:
            return CutoutQAResult(
                status=QAStatus.FAIL,
                overall_score=0.0,
                is_readable=True,
                has_alpha=False,
                alpha_coverage=0.0,
                bounding_box=[0, 0, 0, 0],
                opaque_pixel_count=0,
                issues=[f"Invalid cutout dimensions: {w}x{h}"],
                warnings=[],
                details="Cutout dimensions must be strictly positive",
            )

        # 2. RGBA Mode & Alpha Channel Check
        if img.mode != "RGBA":
            issues.append(f"Cutout must be in 'RGBA' mode with alpha channel, got mode '{img.mode}'")
            return CutoutQAResult(
                status=QAStatus.FAIL,
                overall_score=0.2,
                is_readable=True,
                has_alpha=False,
                alpha_coverage=1.0,
                bounding_box=[0, 0, w, h],
                opaque_pixel_count=w * h,
                issues=issues,
                warnings=[],
                details="Missing alpha transparency channel",
            )

        alpha_channel = img.split()[3]
        alpha_extrema = alpha_channel.getextrema()  # (min, max)

        # 3. Completely Transparent Check
        if alpha_extrema[1] == 0:
            issues.append("Cutout is completely transparent (all alpha = 0)")
            return CutoutQAResult(
                status=QAStatus.FAIL,
                overall_score=0.0,
                is_readable=True,
                has_alpha=True,
                alpha_coverage=0.0,
                bounding_box=[0, 0, 0, 0],
                opaque_pixel_count=0,
                issues=issues,
                warnings=[],
                details="Alpha channel is 100% empty/transparent",
            )

        # 4. Completely Opaque Check (Warning or Non-blocking advisory if expected transparency)
        if alpha_extrema[0] == 255:
            warnings.append("Cutout is completely opaque (no transparent background detected)")

        # 5. Bounding Box & Alpha Coverage Calculation
        bbox = alpha_channel.getbbox()
        if not bbox:
            issues.append("No non-transparent bounding box found")
            return CutoutQAResult(
                status=QAStatus.FAIL,
                overall_score=0.0,
                is_readable=True,
                has_alpha=True,
                alpha_coverage=0.0,
                bounding_box=[0, 0, 0, 0],
                opaque_pixel_count=0,
                issues=issues,
                warnings=warnings,
                details="Empty product bounding box",
            )

        bbox_w = bbox[2] - bbox[0]
        bbox_h = bbox[3] - bbox[1]
        total_pixels = w * h
        hist = alpha_channel.histogram()
        opaque_pixel_count = sum(hist[1:])  # alpha > 0
        alpha_coverage = opaque_pixel_count / total_pixels

        # 6. Extreme Cropping / Microscopic Product Check
        if bbox_w < max(10, int(w * 0.05)) or bbox_h < max(10, int(h * 0.05)) or alpha_coverage < 0.01:
            issues.append(
                f"Cutout product occupies an abnormally small area ({bbox_w}x{bbox_h} in {w}x{h} canvas, "
                f"alpha coverage {alpha_coverage*100:.2f}%) indicating accidental extreme crop"
            )

        # 7. Extreme Oversize / Edge Clamping (warn if product touches all 4 edges solidly)
        if bbox[0] == 0 and bbox[1] == 0 and bbox[2] == w and bbox[3] == h and alpha_coverage > 0.98:
            warnings.append("Product cutout touches all image borders with over 98% opacity")

        # Score & Status Aggregation
        if issues:
            status = QAStatus.FAIL
            overall_score = 0.25
        elif warnings:
            status = QAStatus.WARNING
            overall_score = 0.82
        else:
            status = QAStatus.PASS
            overall_score = 0.98

        details = f"Cutout valid ({w}x{h}, alpha coverage {alpha_coverage*100:.1f}%, bbox {list(bbox)})"
        logger.info(f"Cutout QA evaluated: status={status.value}, score={overall_score}, issues={len(issues)}")

        return CutoutQAResult(
            status=status,
            overall_score=overall_score,
            is_readable=True,
            has_alpha=True,
            alpha_coverage=round(alpha_coverage, 4),
            bounding_box=list(bbox),
            opaque_pixel_count=opaque_pixel_count,
            issues=issues,
            warnings=warnings,
            details=details,
        )
