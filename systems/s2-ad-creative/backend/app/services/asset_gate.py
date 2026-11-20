import io
import mimetypes
from pathlib import Path
import httpx
from typing import Optional, Dict, Any, Tuple
from PIL import Image

from app.core.logging import logger
from app.schemas.validation import (
    ValidationReport,
    ValidationCheckItem,
    ValidationStatus,
    ValidationSeverity,
    AssetValidationResponse,
)
from app.services.security_validator import validate_url_safety

# Constraints
MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024  # 15 MB
MIN_RESOLUTION_WIDTH = 400
MIN_RESOLUTION_HEIGHT = 400
RECOMMENDED_MIN_DIMENSION = 800
MAX_DOWNLOAD_TIMEOUT_SECONDS = 8.0
MAX_REDIRECTS = 3

ALLOWED_MAGIC_SIGNATURES = {
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
    b"RIFF": "image/webp",  # WebP begins with RIFF....WEBP
}


class AssetGateService:
    """
    Validates product assets before they enter the creative pipeline.
    Enforces SSRF prevention, download bounds, corruption verification,
    resolution standards, and alpha/cutout transparency inspection.
    """

    async def validate_url_and_asset(
        self,
        url: str,
        require_transparency: bool = True,
        allow_local_demo: bool = True,
    ) -> AssetValidationResponse:
        checks = []
        errors = []
        warnings = []
        asset_metadata: Dict[str, Any] = {"url": url}

        # 1. SSRF & URL Security Gate
        is_safe, sec_code, sec_msg = validate_url_safety(url, allow_local_demo=allow_local_demo)
        if not is_safe:
            checks.append(
                ValidationCheckItem(
                    code=sec_code or "SSRF_CHECK_FAILED",
                    message=sec_msg or "URL failed security validation checks.",
                    severity=ValidationSeverity.ERROR,
                    passed=False,
                )
            )
            errors.append(sec_msg or "Security validation failed.")
            report = ValidationReport(
                status=ValidationStatus.FAIL,
                gate_name="Asset Gate",
                summary="URL rejected by security and SSRF safeguards.",
                checks=checks,
                errors=errors,
                warnings=warnings,
            )
            return AssetValidationResponse(is_valid=False, status=ValidationStatus.FAIL, report=report)

        checks.append(
            ValidationCheckItem(
                code="SSRF_SAFETY_PASSED",
                message="Target URL verified safe from SSRF and private network access.",
                severity=ValidationSeverity.INFO,
                passed=True,
            )
        )

        # 2. Secure Download with bounds and redirect validation
        download_result, download_err = await self._secure_download(url, allow_local_demo=allow_local_demo)
        if download_err:
            checks.append(
                ValidationCheckItem(
                    code="DOWNLOAD_FAILED",
                    message=download_err,
                    severity=ValidationSeverity.ERROR,
                    passed=False,
                )
            )
            errors.append(download_err)
            report = ValidationReport(
                status=ValidationStatus.FAIL,
                gate_name="Asset Gate",
                summary="Asset download failed.",
                checks=checks,
                errors=errors,
                warnings=warnings,
            )
            return AssetValidationResponse(is_valid=False, status=ValidationStatus.FAIL, report=report)

        raw_bytes, final_url, content_type_header = download_result
        file_size = len(raw_bytes)
        asset_metadata["file_size_bytes"] = file_size
        asset_metadata["final_url"] = final_url

        checks.append(
            ValidationCheckItem(
                code="ASSET_DOWNLOAD_SUCCESS",
                message=f"Successfully downloaded asset ({file_size / 1024:.1f} KB).",
                severity=ValidationSeverity.INFO,
                passed=True,
                metadata={"file_size_bytes": file_size},
            )
        )

        # 3. Content Type & Magic Byte Validation
        detected_mime = self._detect_mime_type(raw_bytes)
        asset_metadata["detected_mime"] = detected_mime
        asset_metadata["content_type_header"] = content_type_header

        if not detected_mime:
            err = "Unrecognized or unsupported image file signature. Expected PNG, JPEG, or WebP."
            checks.append(
                ValidationCheckItem(
                    code="UNSUPPORTED_MIME_TYPE",
                    message=err,
                    severity=ValidationSeverity.ERROR,
                    passed=False,
                )
            )
            errors.append(err)
            report = ValidationReport(
                status=ValidationStatus.FAIL,
                gate_name="Asset Gate",
                summary="Unsupported image format.",
                checks=checks,
                errors=errors,
                warnings=warnings,
            )
            return AssetValidationResponse(is_valid=False, status=ValidationStatus.FAIL, report=report)

        checks.append(
            ValidationCheckItem(
                code="MIME_TYPE_VALID",
                message=f"Verified genuine {detected_mime} file content.",
                severity=ValidationSeverity.INFO,
                passed=True,
                metadata={"mime_type": detected_mime},
            )
        )

        # 4. Image Integrity & Corruption Detection
        img, img_err = self._inspect_image_integrity(raw_bytes)
        if img_err or not img:
            checks.append(
                ValidationCheckItem(
                    code="IMAGE_CORRUPTION_DETECTED",
                    message=img_err or "Image file is corrupt or truncated.",
                    severity=ValidationSeverity.ERROR,
                    passed=False,
                )
            )
            errors.append(img_err or "Corrupted image file.")
            report = ValidationReport(
                status=ValidationStatus.FAIL,
                gate_name="Asset Gate",
                summary="Corrupted or invalid image file.",
                checks=checks,
                errors=errors,
                warnings=warnings,
            )
            return AssetValidationResponse(is_valid=False, status=ValidationStatus.FAIL, report=report)

        width, height = img.size
        mode = img.mode
        asset_metadata["width"] = width
        asset_metadata["height"] = height
        asset_metadata["mode"] = mode

        checks.append(
            ValidationCheckItem(
                code="INTEGRITY_CHECK_PASSED",
                message="Image decompressed cleanly without corruption.",
                severity=ValidationSeverity.INFO,
                passed=True,
            )
        )

        # 5. Resolution & Aspect Ratio Standards
        if width < MIN_RESOLUTION_WIDTH or height < MIN_RESOLUTION_HEIGHT:
            res_err = (
                f"Resolution {width}x{height} is too low. "
                f"Minimum required is {MIN_RESOLUTION_WIDTH}x{MIN_RESOLUTION_HEIGHT}px."
            )
            checks.append(
                ValidationCheckItem(
                    code="INSUFFICIENT_RESOLUTION",
                    message=res_err,
                    severity=ValidationSeverity.ERROR,
                    passed=False,
                    metadata={"width": width, "height": height},
                )
            )
            errors.append(res_err)
        else:
            is_suboptimal = width < RECOMMENDED_MIN_DIMENSION and height < RECOMMENDED_MIN_DIMENSION
            if is_suboptimal:
                warn_msg = (
                    f"Resolution {width}x{height} is acceptable but below recommended {RECOMMENDED_MIN_DIMENSION}px. "
                    "Creative sharpness may be impacted on high-DPI displays."
                )
                checks.append(
                    ValidationCheckItem(
                        code="SUBOPTIMAL_RESOLUTION",
                        message=warn_msg,
                        severity=ValidationSeverity.WARNING,
                        passed=True,
                        metadata={"width": width, "height": height},
                    )
                )
                warnings.append(warn_msg)
            else:
                checks.append(
                    ValidationCheckItem(
                        code="RESOLUTION_PASSED",
                        message=f"Optimal resolution verified ({width}x{height}px).",
                        severity=ValidationSeverity.INFO,
                        passed=True,
                        metadata={"width": width, "height": height},
                    )
                )

        aspect_ratio = width / height
        asset_metadata["aspect_ratio"] = round(aspect_ratio, 3)
        if aspect_ratio > 4.0 or aspect_ratio < 0.25:
            aspect_warn = f"Extreme aspect ratio ({aspect_ratio:.2f}:1) detected. May complicate advertising layouts."
            checks.append(
                ValidationCheckItem(
                    code="EXTREME_ASPECT_RATIO",
                    message=aspect_warn,
                    severity=ValidationSeverity.WARNING,
                    passed=True,
                    metadata={"aspect_ratio": aspect_ratio},
                )
            )
            warnings.append(aspect_warn)

        # 6. Alpha & Cutout Transparency Inspection
        transparency_info = self._analyze_transparency(img)
        asset_metadata.update(transparency_info)

        has_alpha_channel = transparency_info["has_alpha_channel"]
        transparency_percent = transparency_info["transparency_percent"]

        if require_transparency:
            if not has_alpha_channel:
                alpha_err = (
                    f"Image mode '{mode}' has no alpha transparency channel. "
                    "A transparent cutout (PNG or WebP with alpha) is required for product compositing."
                )
                checks.append(
                    ValidationCheckItem(
                        code="NO_ALPHA_CHANNEL",
                        message=alpha_err,
                        severity=ValidationSeverity.ERROR,
                        passed=False,
                        metadata=transparency_info,
                    )
                )
                errors.append(alpha_err)
            elif transparency_percent < 5.0:
                opaque_err = (
                    f"Image contains an alpha channel, but only {transparency_percent:.1f}% is transparent. "
                    "The product appears to lack a background cutout and is fully opaque."
                )
                checks.append(
                    ValidationCheckItem(
                        code="OPAQUE_CUTOUT_DETECTED",
                        message=opaque_err,
                        severity=ValidationSeverity.ERROR,
                        passed=False,
                        metadata=transparency_info,
                    )
                )
                errors.append(opaque_err)
            else:
                checks.append(
                    ValidationCheckItem(
                        code="TRANSPARENT_CUTOUT_VERIFIED",
                        message=(
                            f"Verified transparent product cutout ({transparency_percent:.1f}% transparent background, "
                            f"bounding box: {transparency_info.get('cutout_bbox')})."
                        ),
                        severity=ValidationSeverity.INFO,
                        passed=True,
                        metadata=transparency_info,
                    )
                )
        else:
            checks.append(
                ValidationCheckItem(
                    code="TRANSPARENCY_CHECK_SKIPPED",
                    message="Transparency verification bypassed per request options.",
                    severity=ValidationSeverity.INFO,
                    passed=True,
                )
            )

        # Final Verdict
        if errors:
            status = ValidationStatus.FAIL
            summary = f"Asset Gate rejected the product image with {len(errors)} blocking issue(s)."
            is_valid = False
        elif warnings:
            status = ValidationStatus.WARNING
            summary = f"Asset Gate accepted the product image with {len(warnings)} non-blocking warning(s)."
            is_valid = True
        else:
            status = ValidationStatus.PASS
            summary = "Asset Gate successfully validated the product image. All checks passed."
            is_valid = True

        report = ValidationReport(
            status=status,
            gate_name="Asset Gate",
            summary=summary,
            checks=checks,
            errors=errors,
            warnings=warnings,
        )

        return AssetValidationResponse(
            is_valid=is_valid,
            status=status,
            report=report,
            asset_metadata=asset_metadata,
        )

    async def _secure_download(
        self,
        url: str,
        allow_local_demo: bool = False,
    ) -> Tuple[Optional[Tuple[bytes, str, str]], Optional[str]]:
        current_url = url
        redirect_count = 0
        CHUNK_SIZE = 64 * 1024  # 64 KB chunks

        # When running in local development or test suites, resolve internal /storage/ demo URLs directly
        if allow_local_demo and "/storage/" in current_url:
            try:
                from app.providers.storage_provider import get_storage_provider
                storage = get_storage_provider()
                storage_key = current_url.split("/storage/", 1)[-1].split("?")[0].strip("/")
                if await storage.exists(storage_key):
                    data = await storage.get_bytes(storage_key)
                    ext = Path(storage_key).suffix.lower()
                    mime = "image/png" if ext == ".png" else ("image/jpeg" if ext in (".jpg", ".jpeg") else "application/octet-stream")
                    return (data, current_url, mime), None
            except Exception as e:
                logger.warning(f"Direct storage resolution for local demo URL '{current_url}' failed: {e}")

        async with httpx.AsyncClient(timeout=MAX_DOWNLOAD_TIMEOUT_SECONDS, follow_redirects=False) as client:
            while redirect_count <= MAX_REDIRECTS:
                # Re-validate destination URL against SSRF before every request/redirect
                is_safe, sec_code, sec_msg = validate_url_safety(current_url, allow_local_demo=allow_local_demo)
                if not is_safe:
                    return None, f"Redirect to prohibited target blocked: {sec_msg}"

                try:
                    async with client.stream("GET", current_url, headers={"User-Agent": "AliasImgGen-AssetGate/1.0"}) as res:
                        # Check for redirect
                        if res.is_redirect:
                            location = res.headers.get("location")
                            if not location:
                                return None, "HTTP redirect response without Location header."
                            # Resolve relative redirect
                            current_url = str(httpx.URL(current_url).join(location))
                            redirect_count += 1
                            continue

                        if res.status_code != 200:
                            return None, f"Server returned HTTP {res.status_code} ({res.reason_phrase})."

                        # Check declared Content-Length header if present
                        content_length = res.headers.get("content-length")
                        if content_length and int(content_length) > MAX_FILE_SIZE_BYTES:
                            return None, f"File size exceeds maximum permitted limit ({MAX_FILE_SIZE_BYTES / (1024*1024):.0f}MB)."

                        # Secure streaming: read in bounded chunks without buffering arbitrarily large responses
                        downloaded_chunks: List[bytes] = []
                        cumulative_bytes = 0

                        async for chunk in res.aiter_bytes(chunk_size=CHUNK_SIZE):
                            cumulative_bytes += len(chunk)
                            if cumulative_bytes > MAX_FILE_SIZE_BYTES:
                                return None, f"Downloaded content exceeds maximum permitted limit ({MAX_FILE_SIZE_BYTES / (1024*1024):.0f}MB)."
                            downloaded_chunks.append(chunk)

                        content = b"".join(downloaded_chunks)
                        content_type = res.headers.get("content-type", "")
                        return (content, current_url, content_type), None

                except httpx.TimeoutException:
                    return None, f"Download timed out after {MAX_DOWNLOAD_TIMEOUT_SECONDS}s."
                except httpx.RequestError as e:
                    return None, f"Network error during download: {str(e)}"

            return None, f"Exceeded maximum redirect limit of {MAX_REDIRECTS}."

    def _detect_mime_type(self, data: bytes) -> Optional[str]:
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if data.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if data.startswith(b"RIFF") and b"WEBP" in data[:16]:
            return "image/webp"
        return None

    def _inspect_image_integrity(self, data: bytes) -> Tuple[Optional[Image.Image], Optional[str]]:
        try:
            # First verify without full decompression
            test_stream = io.BytesIO(data)
            verify_img = Image.open(test_stream)
            verify_img.verify()

            # Second open for actual decoding and property inspection
            load_stream = io.BytesIO(data)
            img = Image.open(load_stream)
            img.load()  # Catches truncated streams
            return img, None
        except Exception as e:
            logger.warning(f"Image integrity check failure: {e}")
            return None, f"Image decode failure: {str(e)}"

    def _analyze_transparency(self, img: Image.Image) -> Dict[str, Any]:
        has_alpha_channel = False
        transparency_percent = 0.0
        cutout_bbox = None

        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            has_alpha_channel = True
            rgba_img = img.convert("RGBA")
            alpha = rgba_img.getchannel("A")

            # Calculate transparency percentage
            total_pixels = img.width * img.height
            if total_pixels > 0:
                if hasattr(alpha, "get_flattened_data"):
                    alpha_data = alpha.get_flattened_data()
                else:
                    alpha_data = alpha.getdata()
                transparent_count = sum(1 for p in alpha_data if p < 128)
                transparency_percent = (transparent_count / total_pixels) * 100.0

            # Bounding box of non-transparent content
            cutout_bbox = alpha.getbbox()

        return {
            "has_alpha_channel": has_alpha_channel,
            "transparency_percent": round(transparency_percent, 2),
            "cutout_bbox": list(cutout_bbox) if cutout_bbox else None,
        }


asset_gate_service = AssetGateService()
