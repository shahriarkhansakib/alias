import io
import pytest
from PIL import Image
from unittest.mock import patch, AsyncMock

from app.services.asset_gate import asset_gate_service
from app.services.security_validator import validate_url_safety
from app.demo.sample_assets import (
    generate_demo_smartwatch_png,
    generate_opaque_sample_jpg,
    generate_low_res_sample_png,
)


@pytest.mark.asyncio
async def test_valid_transparent_png():
    valid_png_bytes = generate_demo_smartwatch_png()

    with patch.object(
        asset_gate_service,
        "_secure_download",
        return_value=((valid_png_bytes, "https://example.com/watch.png", "image/png"), None),
    ), patch("app.services.asset_gate.validate_url_safety", return_value=(True, None, None)):
        res = await asset_gate_service.validate_url_and_asset("https://example.com/watch.png")
        assert res.is_valid is True
        assert res.status in ("PASS", "WARNING")
        assert res.asset_metadata["has_alpha_channel"] is True
        assert res.asset_metadata["transparency_percent"] > 20.0
        assert res.asset_metadata["width"] == 800
        assert res.asset_metadata["height"] == 800


@pytest.mark.asyncio
async def test_non_transparent_image():
    opaque_bytes = generate_opaque_sample_jpg()

    with patch.object(
        asset_gate_service,
        "_secure_download",
        return_value=((opaque_bytes, "https://example.com/opaque.jpg", "image/jpeg"), None),
    ), patch("app.services.asset_gate.validate_url_safety", return_value=(True, None, None)):
        res = await asset_gate_service.validate_url_and_asset("https://example.com/opaque.jpg", require_transparency=True)
        assert res.is_valid is False
        assert res.status == "FAIL"
        assert any("no alpha transparency channel" in err for err in res.report.errors)


@pytest.mark.asyncio
async def test_corrupt_image():
    corrupt_bytes = b"\x89PNG\r\n\x1a\ncorrupt_random_binary_garbage_stream"

    with patch.object(
        asset_gate_service,
        "_secure_download",
        return_value=((corrupt_bytes, "https://example.com/corrupt.png", "image/png"), None),
    ), patch("app.services.asset_gate.validate_url_safety", return_value=(True, None, None)):
        res = await asset_gate_service.validate_url_and_asset("https://example.com/corrupt.png")
        assert res.is_valid is False
        assert res.status == "FAIL"
        assert any("corrupt" in err.lower() or "decode" in err.lower() for err in res.report.errors)


@pytest.mark.asyncio
async def test_unsupported_mime_type():
    pdf_bytes = b"%PDF-1.4\n%...\n"

    with patch.object(
        asset_gate_service,
        "_secure_download",
        return_value=((pdf_bytes, "https://example.com/doc.pdf", "application/pdf"), None),
    ), patch("app.services.asset_gate.validate_url_safety", return_value=(True, None, None)):
        res = await asset_gate_service.validate_url_and_asset("https://example.com/doc.pdf")
        assert res.is_valid is False
        assert res.status == "FAIL"
        assert any("Unsupported image format" in res.report.summary for _ in [1])


@pytest.mark.asyncio
async def test_insufficient_resolution():
    lowres_bytes = generate_low_res_sample_png()  # 200x200

    with patch.object(
        asset_gate_service,
        "_secure_download",
        return_value=((lowres_bytes, "https://example.com/tiny.png", "image/png"), None),
    ), patch("app.services.asset_gate.validate_url_safety", return_value=(True, None, None)):
        res = await asset_gate_service.validate_url_and_asset("https://example.com/tiny.png")
        assert res.is_valid is False
        assert res.status == "FAIL"
        assert any("Resolution 200x200 is too low" in err for err in res.report.errors)


@pytest.mark.asyncio
async def test_image_with_opaque_alpha_channel():
    # RGBA mode, but 100% of alpha is 255 (no actual cutout)
    img = Image.new("RGBA", (500, 500), (255, 100, 50, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    opaque_rgba_bytes = buf.getvalue()

    with patch.object(
        asset_gate_service,
        "_secure_download",
        return_value=((opaque_rgba_bytes, "https://example.com/fake_alpha.png", "image/png"), None),
    ), patch("app.services.asset_gate.validate_url_safety", return_value=(True, None, None)):
        res = await asset_gate_service.validate_url_and_asset("https://example.com/fake_alpha.png", require_transparency=True)
        assert res.is_valid is False
        assert res.status == "FAIL"
        assert any("fully opaque" in err for err in res.report.errors)


@pytest.mark.asyncio
async def test_unusual_aspect_ratio_generates_warning():
    # 2400x400 (aspect ratio 6:1) with alpha and valid >=400px dimensions
    img = Image.new("RGBA", (2400, 400), (0, 0, 0, 0))
    # Draw non-transparent box in center
    for x in range(600, 1800):
        for y in range(100, 300):
            img.putpixel((x, y), (20, 40, 60, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    with patch.object(
        asset_gate_service,
        "_secure_download",
        return_value=((buf.getvalue(), "https://example.com/wide.png", "image/png"), None),
    ), patch("app.services.asset_gate.validate_url_safety", return_value=(True, None, None)):
        res = await asset_gate_service.validate_url_and_asset("https://example.com/wide.png")
        assert res.is_valid is True
        assert res.status == "WARNING"
        assert any("Extreme aspect ratio" in w for w in res.report.warnings)


def test_ssrf_safety_validator_blocks_internal_ips():
    # Localhost
    safe, code, _ = validate_url_safety("http://localhost:8000/secret")
    assert safe is False
    assert "PROHIBITED" in code or "INSECURE" in code

    # Loopback IP
    safe, code, _ = validate_url_safety("https://127.0.0.1/admin")
    assert safe is False
    assert "LOOPBACK" in code or "PROHIBITED" in code

    # AWS/GCP cloud metadata IP
    safe, code, _ = validate_url_safety("https://169.254.169.254/latest/meta-data")
    assert safe is False
    assert "LINK_LOCAL" in code or "PROHIBITED" in code

    # Insecure HTTP
    safe, code, _ = validate_url_safety("http://example.com/image.png")
    assert safe is False
    assert code == "INSECURE_SCHEME"


@pytest.mark.asyncio
async def test_oversized_file():
    with patch.object(
        asset_gate_service,
        "_secure_download",
        return_value=(None, "File size exceeds maximum permitted limit (15MB)."),
    ), patch("app.services.asset_gate.validate_url_safety", return_value=(True, None, None)):
        res = await asset_gate_service.validate_url_and_asset("https://example.com/huge.png")
        assert res.is_valid is False
        assert res.status == "FAIL"
        assert any("File size exceeds" in err for err in res.report.errors)


@pytest.mark.asyncio
async def test_unreachable_url():
    with patch.object(
        asset_gate_service,
        "_secure_download",
        return_value=(None, "Network error during download: Connection refused"),
    ), patch("app.services.asset_gate.validate_url_safety", return_value=(True, None, None)):
        res = await asset_gate_service.validate_url_and_asset("https://example.com/down.png")
        assert res.is_valid is False
        assert res.status == "FAIL"
        assert any("Network error" in err for err in res.report.errors)
