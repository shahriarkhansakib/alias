import io
from typing import List, Dict, Any
from PIL import Image, ImageStat

from app.schemas.background import QAStatus, DiagnosticCheck
from app.schemas.platform import PlatformCreativeSpec
from app.schemas.composite import CompositeQAResult, PixelPlacementResult
from app.core.logging import logger


class CompositeQAService:
    """
    Deterministic Composite QA Engine.
    Evaluates the composited advertisement creative before Phase 6 typography and rendering.
    Enforces dimensional fidelity, product visibility, safe-region compliance, and alpha blending health.
    """

    @classmethod
    def evaluate(
        cls,
        composite_bytes: bytes,
        platform_spec: PlatformCreativeSpec,
        placement: PixelPlacementResult,
    ) -> CompositeQAResult:
        issues: List[str] = []
        warnings: List[str] = []

        # -------------------------------------------------------------
        # 1. Dimension & Readability Check
        # -------------------------------------------------------------
        try:
            img = Image.open(io.BytesIO(composite_bytes))
            w, h = img.size
            fmt = img.format or "PNG"
        except Exception as e:
            logger.error(f"Failed to decode composited image: {str(e)}")
            failed_check = DiagnosticCheck(
                passed=False,
                score=0.0,
                severity=QAStatus.FAIL,
                details=f"Cannot decode composited image bytes: {str(e)}",
            )
            return CompositeQAResult(
                status=QAStatus.FAIL,
                overall_score=0.0,
                dimension_check=failed_check,
                placement_check=failed_check,
                visibility_check=failed_check,
                boundary_check=failed_check,
                integrity_check=failed_check,
                issues=[f"Corrupt composited image stream: {str(e)}"],
                warnings=[],
                diagnostics={"error": str(e)},
            )

        dimension_passed = (w == platform_spec.target_width and h == platform_spec.target_height)
        if dimension_passed:
            dimension_check = DiagnosticCheck(
                passed=True,
                score=1.0,
                severity=QAStatus.PASS,
                details=f"Exact platform dimensions ({w}x{h}, {platform_spec.aspect_ratio})",
                metrics={"width": w, "height": h, "target_width": platform_spec.target_width, "target_height": platform_spec.target_height},
            )
        else:
            dimension_check = DiagnosticCheck(
                passed=False,
                score=0.3,
                severity=QAStatus.FAIL,
                details=f"Dimension mismatch: got {w}x{h}, expected {platform_spec.target_width}x{platform_spec.target_height}",
                metrics={"width": w, "height": h, "target_width": platform_spec.target_width, "target_height": platform_spec.target_height},
            )
            issues.append(dimension_check.details)

        # -------------------------------------------------------------
        # 2. Boundary & Canvas Containment Check
        # -------------------------------------------------------------
        in_canvas = (
            placement.x >= 0
            and placement.y >= 0
            and (placement.x + placement.width) <= w
            and (placement.y + placement.height) <= h
        )
        if in_canvas:
            boundary_check = DiagnosticCheck(
                passed=True,
                score=1.0,
                severity=QAStatus.PASS,
                details=f"Product box ({placement.x}, {placement.y}, {placement.width}x{placement.height}) is fully inside canvas",
                metrics={"x": placement.x, "y": placement.y, "width": placement.width, "height": placement.height},
            )
        else:
            boundary_check = DiagnosticCheck(
                passed=False,
                score=0.2,
                severity=QAStatus.FAIL,
                details=f"Product overflowed canvas bounds: x+w={placement.x + placement.width} (canvas={w}), y+h={placement.y + placement.height} (canvas={h})",
                metrics={"x": placement.x, "y": placement.y, "width": placement.width, "height": placement.height},
            )
            issues.append(boundary_check.details)

        # -------------------------------------------------------------
        # 3. Product-Safe Region Compliance Check
        # -------------------------------------------------------------
        safe_slot = platform_spec.product_safe_region
        safe_x0 = int(w * safe_slot.x)
        safe_y0 = int(h * safe_slot.y)
        safe_x1 = int(w * (safe_slot.x + safe_slot.width))
        safe_y1 = int(h * (safe_slot.y + safe_slot.height))

        # Check overlap margin
        prod_x0 = placement.x
        prod_y0 = placement.y
        prod_x1 = placement.x + placement.width
        prod_y1 = placement.y + placement.height

        # Allow slight padding/breathing tolerance (5% of canvas)
        tolerance_x = int(w * 0.06)
        tolerance_y = int(h * 0.06)
        within_safe_zone = (
            prod_x0 >= (safe_x0 - tolerance_x)
            and prod_y0 >= (safe_y0 - tolerance_y)
            and prod_x1 <= (safe_x1 + tolerance_x)
            and prod_y1 <= (safe_y1 + tolerance_y)
        )

        if within_safe_zone:
            placement_check = DiagnosticCheck(
                passed=True,
                score=1.0,
                severity=QAStatus.PASS,
                details="Product placed within designated product-safe region without blocking text zone",
                metrics={"safe_bounds": [safe_x0, safe_y0, safe_x1, safe_y1], "prod_bounds": [prod_x0, prod_y0, prod_x1, prod_y1]},
            )
        else:
            placement_check = DiagnosticCheck(
                passed=False,
                score=0.5,
                severity=QAStatus.WARNING,
                details="Product extends slightly beyond the designated product-safe zone",
                metrics={"safe_bounds": [safe_x0, safe_y0, safe_x1, safe_y1], "prod_bounds": [prod_x0, prod_y0, prod_x1, prod_y1]},
            )
            warnings.append(placement_check.details)

        # -------------------------------------------------------------
        # 4. Product Visibility & Detail Check
        # -------------------------------------------------------------
        prod_crop = img.crop((prod_x0, prod_y0, prod_x1, prod_y1)).convert("L")
        stat = ImageStat.Stat(prod_crop)
        stddev = stat.stddev[0]
        mean_val = stat.mean[0]

        # A real product layer has high standard deviation / visual contrast across its area
        if stddev > 10.0 and 5.0 < mean_val < 250.0:
            visibility_check = DiagnosticCheck(
                passed=True,
                score=1.0,
                severity=QAStatus.PASS,
                details=f"Product is prominently visible with distinct contrast (mean={mean_val:.1f}, stddev={stddev:.1f})",
                metrics={"mean": round(mean_val, 2), "stddev": round(stddev, 2)},
            )
        elif stddev <= 5.0:
            visibility_check = DiagnosticCheck(
                passed=False,
                score=0.3,
                severity=QAStatus.FAIL,
                details=f"Product region has abnormally flat/blank pixels (stddev={stddev:.1f} <= 5.0), indicating alpha dropout",
                metrics={"mean": round(mean_val, 2), "stddev": round(stddev, 2)},
            )
            issues.append(visibility_check.details)
        else:
            visibility_check = DiagnosticCheck(
                passed=True,
                score=0.75,
                severity=QAStatus.WARNING,
                details=f"Product region has low luminance contrast (stddev={stddev:.1f})",
                metrics={"mean": round(mean_val, 2), "stddev": round(stddev, 2)},
            )
            warnings.append(visibility_check.details)

        # -------------------------------------------------------------
        # 5. Output Integrity & Opacity Check
        # -------------------------------------------------------------
        # Final ad output must be fully opaque without holes
        is_opaque = (img.mode == "RGB" or (img.mode == "RGBA" and img.split()[3].getextrema()[0] == 255))
        if is_opaque:
            integrity_check = DiagnosticCheck(
                passed=True,
                score=1.0,
                severity=QAStatus.PASS,
                details="Composited canvas is fully opaque and ready for final rendering",
                metrics={"mode": img.mode},
            )
        else:
            integrity_check = DiagnosticCheck(
                passed=False,
                score=0.4,
                severity=QAStatus.FAIL,
                details=f"Unexpected transparent pixels found in final composited canvas (mode={img.mode})",
                metrics={"mode": img.mode},
            )
            issues.append(integrity_check.details)

        # -------------------------------------------------------------
        # Overall Score Aggregation
        # -------------------------------------------------------------
        checks = [
            (dimension_check, 0.25),
            (boundary_check, 0.25),
            (visibility_check, 0.25),
            (placement_check, 0.15),
            (integrity_check, 0.10),
        ]
        raw_score = sum(c.score * weight for c, weight in checks)

        if any(c.severity == QAStatus.FAIL for c, _ in checks):
            status = QAStatus.FAIL
            overall_score = min(round(raw_score, 2), 0.50)
        elif any(c.severity == QAStatus.WARNING for c, _ in checks):
            status = QAStatus.WARNING
            overall_score = min(round(raw_score, 2), 0.85)
        else:
            status = QAStatus.PASS
            overall_score = max(round(raw_score, 2), 0.95)

        logger.info(
            f"Composite QA evaluated: status={status.value}, score={overall_score}, "
            f"issues={len(issues)}, warnings={len(warnings)}"
        )

        return CompositeQAResult(
            status=status,
            overall_score=overall_score,
            dimension_check=dimension_check,
            placement_check=placement_check,
            visibility_check=visibility_check,
            boundary_check=boundary_check,
            integrity_check=integrity_check,
            issues=issues,
            warnings=warnings,
            diagnostics={
                "canvas_dimensions": [w, h],
                "product_box": [placement.x, placement.y, placement.width, placement.height],
                "safe_zone": [safe_x0, safe_y0, safe_x1, safe_y1],
            },
        )
