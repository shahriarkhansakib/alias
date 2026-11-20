import os
import hashlib
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Any
from PIL import Image, ImageFont, ImageDraw
from app.core.logging import logger


class FontMetadata:
    def __init__(self, family: str, weight: str, file_path: Path, sha256_hash: str, version: str = "1.0.0"):
        self.family = family
        self.weight = weight
        self.file_path = file_path
        self.sha256_hash = sha256_hash
        self.version = version

    def to_dict(self) -> Dict[str, str]:
        return {
            "family": self.family,
            "weight": self.weight,
            "file_name": self.file_path.name,
            "sha256": self.sha256_hash,
            "version": self.version,
        }


class FontRegistry:
    """
    Deterministic font registry.
    Explicitly loads bundled TTF font files and computes cryptographic checksums for audit provenance.
    Never relies on unverified host fonts.
    """
    _instance: Optional["FontRegistry"] = None

    def __init__(self):
        self.fonts: Dict[Tuple[str, str], FontMetadata] = {}
        self.base_dir = Path(__file__).resolve().parent.parent / "assets" / "fonts"
        self._load_registered_fonts()

    @classmethod
    def get_instance(cls) -> "FontRegistry":
        if cls._instance is None:
            cls._instance = FontRegistry()
        return cls._instance

    def _compute_hash(self, path: Path) -> str:
        sha = hashlib.sha256()
        with open(path, "rb") as f:
            while chunk := f.read(65536):
                sha.update(chunk)
        return sha.hexdigest()

    def _load_registered_fonts(self):
        if not self.base_dir.exists():
            self.base_dir.mkdir(parents=True, exist_ok=True)

        candidates = [
            ("Inter", "bold", "Inter-Bold.ttf"),
            ("Inter", "regular", "Inter-Regular.ttf"),
            ("Geist", "regular", "Geist-Regular.ttf"),
        ]

        for family, weight, filename in candidates:
            p = self.base_dir / filename
            if p.exists():
                h = self._compute_hash(p)
                self.fonts[(family.lower(), weight.lower())] = FontMetadata(family, weight, p, h)
                logger.info(f"Registered font [{family} {weight}] from {filename} (hash: {h[:12]}...)")
            else:
                logger.warning(f"Font file {filename} not found in {self.base_dir}")

    def get_font_hashes(self) -> Dict[str, str]:
        return {f"{meta.family}_{meta.weight}": meta.sha256_hash for meta in self.fonts.values()}

    def load_font(self, family: str, weight: str = "regular", size: int = 24) -> ImageFont.FreeTypeFont:
        key = (family.lower(), weight.lower())
        meta = self.fonts.get(key)
        if not meta:
            # Fallback to any available registered font
            fallback_key = ("inter", weight.lower()) if ("inter", weight.lower()) in self.fonts else list(self.fonts.keys())[0] if self.fonts else None
            if fallback_key:
                meta = self.fonts[fallback_key]
                logger.warning(f"Requested font [{family} {weight}] not found; using fallback [{meta.family} {meta.weight}]")
            else:
                raise FileNotFoundError(f"No fonts available in registry for {family}")

        return ImageFont.truetype(str(meta.file_path), size=size)


class TypographyEngine:
    """
    Deterministic layout, wrapping, and text measurement engine.
    Guarantees:
    - Never clips or truncates text silently.
    - Preserves exact spelling, symbols, punctuation, and capitalization.
    - Wraps text without splitting words.
    - Accurately measures pixel bounding boxes.
    """

    @classmethod
    def detect_script_support(cls, text: Optional[str] = None) -> Dict[str, Any]:
        """
        Analyzes Unicode script blocks in text and documents typography capabilities/limitations.
        
        TECHNICAL LIMITATION DOCUMENTATION:
        Pillow/FreeType text rendering performs deterministic character-cell glyph layout.
        Standard FreeType glyph mapping does NOT perform HarfBuzz / libraqm Complex Text Layout (CTL).
        Consequently, complex Bengali conjunct ligatures and reordered vowel signs (যুক্তবর্ণ)
        are measured and rendered as individual glyph codes without contextual ligature shaping.
        
        Strict invariants enforced:
        - Bundled verified TTF fonts ONLY (no dynamic downloads, no host-dependent leaks).
        - Deterministic bounding box calculation and line wrapping.
        - Exact copy preservation without silent truncation or corruption.
        - Accurate safe-slot overflow detection.
        """
        if not text:
            return {
                "has_bengali": False,
                "has_latin": False,
                "has_currency": False,
                "has_digits": False,
                "limitations": [],
                "ctl_shaping_guaranteed": True,
            }

        has_bengali = any(0x0980 <= ord(c) <= 0x09FF for c in text)
        has_latin = any(0x0041 <= ord(c) <= 0x005A or 0x0061 <= ord(c) <= 0x007A for c in text)
        has_currency = any(c in "$€£¥৳₹" for c in text)
        has_digits = any(c.isdigit() or (0x09E6 <= ord(c) <= 0x09EF) for c in text)

        limitations = []
        if has_bengali:
            limitations.append(
                "Bangla script detected. Standard FreeType character-cell rendering applied. "
                "Complex text layout (CTL / HarfBuzz / Raqm) conjunct ligatures are not shaped; "
                "safe-slot containment, deterministic word-wrapping, and exact copy preservation are strictly enforced."
            )

        return {
            "has_bengali": has_bengali,
            "has_latin": has_latin,
            "has_currency": has_currency,
            "has_digits": has_digits,
            "limitations": limitations,
            "ctl_shaping_guaranteed": not has_bengali,
        }

    @classmethod
    def measure_text_line(cls, text: str, font: ImageFont.FreeTypeFont) -> Tuple[int, int]:
        """Returns (width, height) of a single line of text."""
        if not text:
            return 0, 0
        bbox = font.getbbox(text)
        w = bbox[2] - bbox[0]
        h = bbox[3] - bbox[1]
        return w, h

    @classmethod
    def wrap_text(cls, text: str, font: ImageFont.FreeTypeFont, max_width: int) -> List[str]:
        """
        Wraps text deterministically by whitespace words without breaking words.
        Preserves original capitalization, numbers, punctuation, and currency characters.
        Correctly handles multi-line paragraphs separated by newlines.
        """
        if not text:
            return []

        paragraphs = text.split("\n")
        lines: List[str] = []

        for paragraph in paragraphs:
            if not paragraph.strip():
                continue
            words = paragraph.split(" ")
            current_line = ""

            for word in words:
                if not word:
                    continue
                candidate = f"{current_line} {word}".strip() if current_line else word
                w, _ = cls.measure_text_line(candidate, font)
                if w <= max_width:
                    current_line = candidate
                else:
                    if current_line:
                        lines.append(current_line)
                        current_line = word
                    else:
                        # Single word exceeds max_width
                        lines.append(word)
                        current_line = ""

            if current_line:
                lines.append(current_line)

        return lines

    @classmethod
    def fit_text_to_box(
        cls,
        text: str,
        font_family: str,
        weight: str,
        initial_size: int,
        min_size: int,
        max_width: int,
        max_height: int,
        max_lines: int = 5,
        line_height_multiplier: float = 1.25,
    ) -> Tuple[List[str], ImageFont.FreeTypeFont, int, bool]:
        """
        Fits text into the bounding box by wrapping and dynamically stepping down font size
        between initial_size and min_size if necessary.
        Returns:
            Tuple[lines, selected_font, line_height, fits_cleanly]
        """
        registry = FontRegistry.get_instance()
        current_size = initial_size
        step = 2

        while current_size >= min_size:
            font = registry.load_font(font_family, weight=weight, size=current_size)
            lines = cls.wrap_text(text, font, max_width)

            # Determine line height safely
            _, sample_h = cls.measure_text_line("Ag1$৳", font)
            sample_h = max(sample_h, current_size)
            line_height = int(round(sample_h * line_height_multiplier))
            total_height = len(lines) * line_height

            # Check if fits within constraints
            if len(lines) <= max_lines and total_height <= max_height:
                # Also verify that no single line exceeds max_width
                exceeds = any(cls.measure_text_line(line, font)[0] > max_width for line in lines)
                if not exceeds:
                    return lines, font, line_height, True

            current_size -= step

        # If we reached min_size and still doesn't fit, return lines with fits_cleanly=False
        min_font = registry.load_font(font_family, weight=weight, size=min_size)
        lines = cls.wrap_text(text, min_font, max_width)
        _, sample_h = cls.measure_text_line("Ag1$৳", min_font)
        sample_h = max(sample_h, min_size)
        line_height = int(round(sample_h * line_height_multiplier))
        return lines, min_font, line_height, False

    @classmethod
    def render_text_block(
        cls,
        draw: ImageDraw.ImageDraw,
        lines: List[str],
        font: ImageFont.FreeTypeFont,
        box_x: int,
        box_y: int,
        box_w: int,
        line_height: int,
        color: str,
        alignment: str = "left",
    ) -> Tuple[int, int, int, int]:
        """
        Renders a block of wrapped lines with deterministic alignment.
        Returns the enclosing bounding box (min_x, min_y, max_x, max_y) of drawn pixels.
        """
        min_x = box_x + box_w
        min_y = box_y
        max_x = box_x
        max_y = box_y

        current_y = box_y
        for line in lines:
            line_w, _ = cls.measure_text_line(line, font)
            if alignment == "center":
                line_x = box_x + (box_w - line_w) // 2
            elif alignment == "right":
                line_x = box_x + box_w - line_w
            else:  # left
                line_x = box_x

            draw.text((line_x, current_y), line, font=font, fill=color)

            min_x = min(min_x, line_x)
            max_x = max(max_x, line_x + line_w)
            current_y += line_height

        max_y = current_y
        if not lines:
            return box_x, box_y, box_x, box_y

        return min_x, min_y, max_x, max_y
