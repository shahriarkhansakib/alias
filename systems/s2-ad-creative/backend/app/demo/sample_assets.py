import io
from pathlib import Path
from typing import Dict, Any
from PIL import Image, ImageDraw


def generate_demo_smartwatch_png() -> bytes:
    """
    Procedurally renders a clean, genuine transparent PNG cutout of the SmartFit X1 smartwatch (800x800).
    Has true alpha transparency around the watch straps and chassis.
    """
    width, height = 800, 800
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Top and bottom silicone straps (dark charcoal)
    strap_color = (30, 36, 48, 255)
    strap_highlight = (45, 54, 72, 255)
    # Top strap
    draw.rounded_rectangle([330, 80, 470, 290], radius=16, fill=strap_color)
    draw.rectangle([340, 90, 350, 270], fill=strap_highlight)
    # Bottom strap
    draw.rounded_rectangle([330, 510, 470, 720], radius=16, fill=strap_color)
    draw.rectangle([340, 530, 350, 710], fill=strap_highlight)

    # 2. Watch chassis outer bezel (metallic navy/graphite)
    bezel_color = (20, 24, 33, 255)
    draw.ellipse([250, 250, 550, 550], fill=bezel_color, outline=(70, 85, 110, 255), width=4)

    # 3. Outer ring accent (electric blue)
    draw.ellipse([270, 270, 530, 530], fill=(12, 16, 24, 255), outline=(37, 99, 235, 255), width=3)

    # 4. Watch face display screen (deep OLED black)
    draw.ellipse([285, 285, 515, 515], fill=(8, 10, 16, 255))

    # 5. UI Elements on screen: digital clock, heart rate arc, battery bar
    # Heart rate accent arc
    draw.arc([310, 310, 490, 490], start=140, end=300, fill=(239, 68, 68, 255), width=5)
    # Battery accent arc
    draw.arc([320, 320, 480, 480], start=30, end=110, fill=(16, 185, 129, 255), width=4)

    # Center dial circle
    draw.ellipse([385, 385, 415, 415], fill=(37, 99, 235, 255))

    # Crown button on side (right)
    draw.rounded_rectangle([545, 380, 562, 420], radius=4, fill=(55, 65, 81, 255), outline=(80, 95, 120, 255), width=2)

    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


def generate_opaque_sample_jpg() -> bytes:
    """Creates a fully opaque 800x800 JPEG (no alpha channel)."""
    img = Image.new("RGB", (800, 800), (240, 240, 245))
    draw = ImageDraw.Draw(img)
    draw.ellipse([250, 250, 550, 550], fill=(30, 40, 60))
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG")
    return buffer.getvalue()


def generate_low_res_sample_png() -> bytes:
    """Creates a low resolution 200x200 PNG (insufficient resolution)."""
    img = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([50, 50, 150, 150], fill=(20, 20, 30, 255))
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


SMARTFIT_X1_DEMO_BRIEF: Dict[str, Any] = {
    "brand": {
        "name": "SmartFit",
        "logo_url": None,
        "colors": ["#2563EB", "#111827", "#10B981"],
        "font_family": "Inter",
    },
    "product": {
        "name": "SmartFit X1",
        "category": "Smart Wearables",
        "sku": "SMARTFIT-X1-BLK",
        "offer": {
            "price": 4999.0,
            "original_price": 6499.0,
            "currency": "BDT",
            "discount_percent": 23.0,
            "promo_code": "FIT23",
        },
        "features": [
            "7-day battery life on a single charge",
            "Continuous heart-rate & SpO2 tracking",
            "Advanced sleep stages monitoring",
            "5 ATM water resistance up to 50 meters",
            "Ultra-crisp 1.4-inch AMOLED display",
        ],
    },
    "images": [
        {
            "url": "http://127.0.0.1:8000/api/v1/storage/demo/smartfit_x1.png",
            "asset_type": "primary_product",
            "description": "SmartFit X1 front facing product cutout with transparent background",
        }
    ],
    "campaign": {
        "name": "SmartFit X1 Launch Bangladesh",
        "objective": "product_sales",
        "platforms": ["instagram", "facebook", "linkedin"],
        "target_audience": "Urban fitness enthusiasts, young professionals, and health-conscious commuters aged 22-40.",
    },
    "approved_claims": [
        "7-day battery life",
        "Heart-rate tracking with medical-grade optical sensor",
        "Sleep tracking analysis",
        "AMOLED crystal clear touchscreen",
        "Water resistant to 50 meters",
    ],
    "copy": {
        "headline": "Track Every Move. Elevate Every Day.",
        "subheadline": "7-day battery life with real-time biometric fitness monitoring.",
        "cta": "Shop Now",
    },
}
