import io
from typing import Tuple, Dict, Any, List, Optional
from PIL import Image, ImageFilter, ImageStat
from app.schemas.background import (
    BackgroundQAResult,
    DiagnosticCheck,
    QAStatus,
)
from app.schemas.platform import PlatformCreativeSpec
from app.core.logging import logger


# -----------------------------------------------------------------------------
# ARCHITECTURAL NOTE & QA LIMITATIONS (PHASE 4.1 HARDENING):
# The current Background QA is deterministic heuristic QA. It is suitable for
# structural and obvious-artifact checks, but it is NOT semantic proof that
# an AI-generated image contains no text, logos, products, or unwanted objects.
#
# Real diffusion/image generative models in production may require stronger
# semantic QA (such as multi-modal Vision LLMs or dedicated OCR detectors)
# in a future phase.
# -----------------------------------------------------------------------------


class BackgroundQAService:
    """
    Deterministic Background QA Engine.
    Evaluates generated backgrounds before product compositing and typography rendering.
    Enforces quality, dimension accuracy, negative space availability, and artifact absence.

    NOTE: This is deterministic heuristic QA (structural and obvious-artifact detection),
    not semantic computer vision or OCR proof.
    """

    @classmethod
    def evaluate(
        cls,
        image_bytes: bytes,
        platform_spec: PlatformCreativeSpec,
    ) -> BackgroundQAResult:
        issues: List[str] = []
        warnings: List[str] = []
        retry_guidances: List[str] = []

        # ---------------------------------------------------------
        # Check A: Dimensions, Aspect Ratio, Image Format & Health
        # ---------------------------------------------------------
        dimension_check = cls._check_dimensions(image_bytes, platform_spec)
        if not dimension_check.passed:
            issues.append(f"Dimension check failed: {dimension_check.details}")
            retry_guidances.append(f"Generate canvas strictly with exact dimensions {platform_spec.target_width}x{platform_spec.target_height}.")

        # If image cannot even be decoded, fail immediately with all checks marked failed
        if "corrupt" in dimension_check.details.lower():
            failed_check = DiagnosticCheck(
                passed=False,
                score=0.0,
                severity=QAStatus.FAIL,
                details="Cannot execute image QA on corrupted image bytes",
            )
            return BackgroundQAResult(
                status=QAStatus.FAIL,
                overall_score=0.0,
                dimension_check=dimension_check,
                text_artifact_check=failed_check,
                watermark_check=failed_check,
                extra_object_check=failed_check,
                negative_space_check=failed_check,
                product_safe_zone_check=failed_check,
                brightness_check=failed_check,
                issues=issues,
                warnings=warnings,
                retry_guidance="Regenerate valid uncorrupted image stream.",
            )

        img = Image.open(io.BytesIO(image_bytes))
        w, h = img.size

        # Coordinates for safe zones
        text_slot = platform_spec.text_safe_region
        prod_slot = platform_spec.product_safe_region

        text_box = (
            int(w * text_slot.x),
            int(h * text_slot.y),
            int(w * (text_slot.x + text_slot.width)),
            int(h * (text_slot.y + text_slot.height)),
        )

        prod_box = (
            int(w * prod_slot.x),
            int(h * prod_slot.y),
            int(w * (prod_slot.x + prod_slot.width)),
            int(h * (prod_slot.y + prod_slot.height)),
        )

        # Grayscale and edge transformations
        gray = img.convert("L")
        edges = gray.filter(ImageFilter.FIND_EDGES)

        # ---------------------------------------------------------
        # Check B: Text Detection / Artifact Detection
        # ---------------------------------------------------------
        text_check = cls._check_text_artifacts(gray, edges, text_box)
        if not text_check.passed:
            issues.append(f"Text artifact check failed: {text_check.details}")
            retry_guidances.append("Remove all typography-like shapes, letters, numbers, signage, labels, and UI-like elements.")
        elif text_check.severity == QAStatus.WARNING:
            warnings.append(f"Text artifact warning: {text_check.details}")

        # ---------------------------------------------------------
        # Check C: Logo / Watermark Detection
        # ---------------------------------------------------------
        watermark_check = cls._check_watermarks(edges, w, h)
        if not watermark_check.passed:
            issues.append(f"Watermark check failed: {watermark_check.details}")
            retry_guidances.append("Remove all corner marks, signatures, or watermark-like artifacts.")
        elif watermark_check.severity == QAStatus.WARNING:
            warnings.append(f"Watermark warning: {watermark_check.details}")

        # ---------------------------------------------------------
        # Check D: Extra Object / Replica Detection
        # ---------------------------------------------------------
        extra_object_check = cls._check_extra_objects(edges, prod_box)
        if not extra_object_check.passed:
            issues.append(f"Extra object check failed: {extra_object_check.details}")
            retry_guidances.append("Clear the designated product-safe area to leave an empty unobstructed stage.")
        elif extra_object_check.severity == QAStatus.WARNING:
            warnings.append(f"Extra object warning: {extra_object_check.details}")

        # ---------------------------------------------------------
        # Check E: Negative Space in Text-Safe Zone
        # ---------------------------------------------------------
        neg_space_check = cls._check_negative_space(edges, text_box)
        if not neg_space_check.passed:
            issues.append(f"Negative space check failed: {neg_space_check.details}")
            retry_guidances.append("Increase visual simplicity and reduce high-frequency details in the text-safe region.")
        elif neg_space_check.severity == QAStatus.WARNING:
            warnings.append(f"Negative space warning: {neg_space_check.details}")

        # ---------------------------------------------------------
        # Check F: Product-Safe Region Clutter
        # ---------------------------------------------------------
        prod_zone_check = cls._check_product_safe_zone(edges, prod_box)
        if not prod_zone_check.passed:
            issues.append(f"Product safe zone check failed: {prod_zone_check.details}")
            retry_guidances.append("Eliminate high-frequency texture and clutter in the product stage zone.")
        elif prod_zone_check.severity == QAStatus.WARNING:
            warnings.append(f"Product safe zone warning: {prod_zone_check.details}")

        # ---------------------------------------------------------
        # Check G: Brightness / Contrast Suitability for Typography
        # ---------------------------------------------------------
        brightness_check = cls._check_brightness_contrast(gray, text_box)
        if not brightness_check.passed:
            issues.append(f"Brightness check failed: {brightness_check.details}")
            retry_guidances.append("Reduce glare and balance luminance in the text-safe region for later typography legibility.")
        elif brightness_check.severity == QAStatus.WARNING:
            warnings.append(f"Brightness warning: {brightness_check.details}")

        # ---------------------------------------------------------
        # Overall Score & Status Aggregation
        # ---------------------------------------------------------
        checks = [
            (dimension_check, 0.20),
            (text_check, 0.20),
            (neg_space_check, 0.20),
            (prod_zone_check, 0.15),
            (watermark_check, 0.10),
            (extra_object_check, 0.10),
            (brightness_check, 0.05),
        ]
        raw_score = sum(c.score * weight for c, weight in checks)

        if any(c.severity == QAStatus.FAIL for c, _ in checks):
            overall_status = QAStatus.FAIL
            overall_score = min(round(raw_score, 2), 0.55)
        elif any(c.severity == QAStatus.WARNING for c, _ in checks):
            overall_status = QAStatus.WARNING
            overall_score = min(round(raw_score, 2), 0.84)
        else:
            overall_status = QAStatus.PASS
            overall_score = max(round(raw_score, 2), 0.88)

        retry_guidance = "; ".join(retry_guidances) if retry_guidances else None

        logger.info(
            f"Background QA evaluation complete: status={overall_status.value}, "
            f"score={overall_score:.2f}, issues={len(issues)}, warnings={len(warnings)}"
        )

        return BackgroundQAResult(
            status=overall_status,
            overall_score=overall_score,
            dimension_check=dimension_check,
            text_artifact_check=text_check,
            watermark_check=watermark_check,
            extra_object_check=extra_object_check,
            negative_space_check=neg_space_check,
            product_safe_zone_check=prod_zone_check,
            brightness_check=brightness_check,
            issues=issues,
            warnings=warnings,
            retry_guidance=retry_guidance,
        )

    # -------------------------------------------------------------
    # Internal Diagnostic Evaluators
    # -------------------------------------------------------------

    @staticmethod
    def _check_dimensions(image_bytes: bytes, spec: PlatformCreativeSpec) -> DiagnosticCheck:
        try:
            img = Image.open(io.BytesIO(image_bytes))
            w, h = img.size
            fmt = img.format or "PNG"
        except Exception as e:
            return DiagnosticCheck(
                passed=False,
                score=0.0,
                severity=QAStatus.FAIL,
                details=f"Corrupted or invalid image stream: {str(e)}",
            )

        if fmt.upper() not in ("PNG", "JPEG", "JPG", "WEBP"):
            return DiagnosticCheck(
                passed=False,
                score=0.3,
                severity=QAStatus.FAIL,
                details=f"Unsupported format '{fmt}'. Must be PNG, JPEG, or WEBP.",
            )

        width_ok = (w == spec.target_width)
        height_ok = (h == spec.target_height)

        actual_ratio = w / h
        expected_ratio = spec.target_width / spec.target_height
        ratio_diff = abs(actual_ratio - expected_ratio) / expected_ratio

        if width_ok and height_ok and ratio_diff < 0.005:
            return DiagnosticCheck(
                passed=True,
                score=1.0,
                severity=QAStatus.PASS,
                details=f"Dimensions exact ({w}x{h}, {spec.aspect_ratio})",
                metrics={"width": w, "height": h, "aspect_ratio": spec.aspect_ratio},
            )

        if ratio_diff > 0.05 or not (width_ok and height_ok):
            return DiagnosticCheck(
                passed=False,
                score=0.4,
                severity=QAStatus.FAIL,
                details=f"Dimension mismatch: got {w}x{h}, expected {spec.target_width}x{spec.target_height}",
                metrics={"width": w, "height": h, "target_width": spec.target_width, "target_height": spec.target_height},
            )

        return DiagnosticCheck(
            passed=True,
            score=0.85,
            severity=QAStatus.WARNING,
            details=f"Minor ratio discrepancy: {w}x{h} differs slightly from target {spec.target_width}x{spec.target_height}",
            metrics={"width": w, "height": h},
        )

    @staticmethod
    def _check_text_artifacts(gray: Image.Image, edges: Image.Image, text_box: Tuple[int, int, int, int]) -> DiagnosticCheck:
        """
        Deterministic detection of readable letters, numbers, fake labels, and UI glyphs.
        """
        crop_edges = edges.crop(text_box)
        stat = ImageStat.Stat(crop_edges)
        edge_mean = stat.mean[0]
        edge_max = stat.extrema[0][1]

        # In a text artifact, high-contrast character edges create strong localized contours
        # with peak edge values = 255 and edge_mean >= 1.0 within the text zone
        crop_gray = gray.crop(text_box)
        gray_stat = ImageStat.Stat(crop_gray)
        gray_stddev = gray_stat.stddev[0]

        # Measure text-like glyph patterns (sharp contrast transitions between foreground character and background)
        if edge_max >= 250 and edge_mean >= 0.9 and gray_stddev > 15:
            # High probability of rendered letters/signage
            return DiagnosticCheck(
                passed=False,
                score=0.2,
                severity=QAStatus.FAIL,
                details="Detected high-contrast text-like artifacts or glyphs in the scene",
                metrics={"edge_mean": round(edge_mean, 2), "edge_max": edge_max, "stddev": round(gray_stddev, 2)},
            )

        if edge_max >= 200 and edge_mean >= 0.6:
            return DiagnosticCheck(
                passed=True,
                score=0.7,
                severity=QAStatus.WARNING,
                details="Potential minor glyph-like pattern detected in text zone",
                metrics={"edge_mean": round(edge_mean, 2), "edge_max": edge_max},
            )

        return DiagnosticCheck(
            passed=True,
            score=1.0,
            severity=QAStatus.PASS,
            details="No text-like artifacts, letters, or glyphs detected",
            metrics={"edge_mean": round(edge_mean, 2), "edge_max": edge_max},
        )

    @staticmethod
    def _check_watermarks(edges: Image.Image, w: int, h: int) -> DiagnosticCheck:
        """
        Detects corner watermarks, signatures, or brand emblems.
        """
        corners = [
            ("bottom-right", (int(w * 0.85), int(h * 0.90), w, h)),
            ("bottom-left", (0, int(h * 0.90), int(w * 0.15), h)),
            ("top-right", (int(w * 0.85), 0, w, int(h * 0.10))),
        ]

        for corner_name, box in corners:
            crop_corner = edges.crop(box)
            stat = ImageStat.Stat(crop_corner)
            edge_mean = stat.mean[0]
            edge_max = stat.extrema[0][1]

            if edge_max >= 240 and edge_mean >= 5.0:
                return DiagnosticCheck(
                    passed=False,
                    score=0.2,
                    severity=QAStatus.FAIL,
                    details=f"Detected probable watermark or logo signature in {corner_name} corner",
                    metrics={"corner": corner_name, "edge_mean": round(edge_mean, 2), "edge_max": edge_max},
                )
            if edge_max >= 180 and edge_mean >= 3.0:
                return DiagnosticCheck(
                    passed=True,
                    score=0.75,
                    severity=QAStatus.WARNING,
                    details=f"Possible subtle mark detected in {corner_name} corner",
                    metrics={"corner": corner_name, "edge_mean": round(edge_mean, 2)},
                )

        return DiagnosticCheck(
            passed=True,
            score=1.0,
            severity=QAStatus.PASS,
            details="No corner watermarks or signatures detected",
        )

    @staticmethod
    def _check_extra_objects(edges: Image.Image, prod_box: Tuple[int, int, int, int]) -> DiagnosticCheck:
        """
        Detects unwanted commercial objects or prominent replicas occupying the product-safe stage.
        """
        crop_prod = edges.crop(prod_box)
        stat = ImageStat.Stat(crop_prod)
        edge_mean = stat.mean[0]
        edge_max = stat.extrema[0][1]

        # An extra commercial object drawn on the empty stage produces hard bounding edges (edge_max = 255)
        # and high localized edge concentration
        if edge_max >= 250 and edge_mean >= 0.8:
            return DiagnosticCheck(
                passed=False,
                score=0.3,
                severity=QAStatus.FAIL,
                details="Prominent foreground object or commercial replica detected occupying the product-safe area",
                metrics={"edge_mean": round(edge_mean, 2), "edge_max": edge_max},
            )

        return DiagnosticCheck(
            passed=True,
            score=1.0,
            severity=QAStatus.PASS,
            details="Product-safe stage is clean and unobstructed for future compositing",
            metrics={"edge_mean": round(edge_mean, 2)},
        )

    @staticmethod
    def _check_negative_space(edges: Image.Image, text_box: Tuple[int, int, int, int]) -> DiagnosticCheck:
        """
        Evaluates whether the required text-safe region has sufficient empty space (low edge density).
        """
        crop_edges = edges.crop(text_box)
        stat = ImageStat.Stat(crop_edges)
        edge_density = stat.mean[0]

        if edge_density > 35.0:
            return DiagnosticCheck(
                passed=False,
                score=0.25,
                severity=QAStatus.FAIL,
                details=f"Text-safe region has excessive edge density/texture clutter ({edge_density:.1f} > 35.0)",
                metrics={"edge_density": round(edge_density, 2)},
            )
        if edge_density > 15.0:
            return DiagnosticCheck(
                passed=True,
                score=0.75,
                severity=QAStatus.WARNING,
                details=f"Moderate visual texture in text-safe region ({edge_density:.1f})",
                metrics={"edge_density": round(edge_density, 2)},
            )

        return DiagnosticCheck(
            passed=True,
            score=1.0,
            severity=QAStatus.PASS,
            details=f"Text-safe region has excellent negative space (edge density {edge_density:.2f})",
            metrics={"edge_density": round(edge_density, 2)},
        )

    @staticmethod
    def _check_product_safe_zone(edges: Image.Image, prod_box: Tuple[int, int, int, int]) -> DiagnosticCheck:
        """
        Evaluates visual clutter in the region reserved for the physical product.
        """
        crop_edges = edges.crop(prod_box)
        stat = ImageStat.Stat(crop_edges)
        edge_density = stat.mean[0]

        if edge_density > 45.0:
            return DiagnosticCheck(
                passed=False,
                score=0.3,
                severity=QAStatus.FAIL,
                details=f"Product-safe zone is heavily cluttered ({edge_density:.1f} > 45.0)",
                metrics={"edge_density": round(edge_density, 2)},
            )
        if edge_density > 25.0:
            return DiagnosticCheck(
                passed=True,
                score=0.8,
                severity=QAStatus.WARNING,
                details=f"Product-safe zone has moderate texture ({edge_density:.1f})",
                metrics={"edge_density": round(edge_density, 2)},
            )

        return DiagnosticCheck(
            passed=True,
            score=1.0,
            severity=QAStatus.PASS,
            details=f"Product-safe zone is clear and optimal for compositing (edge density {edge_density:.2f})",
            metrics={"edge_density": round(edge_density, 2)},
        )

    @staticmethod
    def _check_brightness_contrast(gray: Image.Image, text_box: Tuple[int, int, int, int]) -> DiagnosticCheck:
        """
        Evaluates whether the designated text-safe area is suitable for later typography contrast.
        """
        crop_gray = gray.crop(text_box)
        stat = ImageStat.Stat(crop_gray)
        mean_bright = stat.mean[0]
        stddev = stat.stddev[0]

        if mean_bright > 235.0:
            return DiagnosticCheck(
                passed=False,
                score=0.3,
                severity=QAStatus.FAIL,
                details=f"Text-safe area has blinding brightness/glare ({mean_bright:.1f} > 235.0), unreadable for text",
                metrics={"mean_brightness": round(mean_bright, 2), "stddev": round(stddev, 2)},
            )

        if stddev > 80.0:
            return DiagnosticCheck(
                passed=True,
                score=0.7,
                severity=QAStatus.WARNING,
                details=f"High contrast variability in text-safe area (stddev {stddev:.1f})",
                metrics={"mean_brightness": round(mean_bright, 2), "stddev": round(stddev, 2)},
            )

        return DiagnosticCheck(
            passed=True,
            score=1.0,
            severity=QAStatus.PASS,
            details=f"Text-safe area has consistent, legible luminance (mean {mean_bright:.1f}, stddev {stddev:.1f})",
            metrics={"mean_brightness": round(mean_bright, 2), "stddev": round(stddev, 2)},
        )
