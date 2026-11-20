from pathlib import Path
from app.core.config import settings
from app.core.logging import logger
from app.demo.sample_assets import (
    generate_demo_smartwatch_png,
    generate_opaque_sample_jpg,
    generate_low_res_sample_png,
)


def seed_demo_assets() -> None:
    demo_dir = Path(settings.LOCAL_STORAGE_PATH) / "demo"
    demo_dir.mkdir(parents=True, exist_ok=True)

    smartfit_path = demo_dir / "smartfit_x1.png"
    if not smartfit_path.exists():
        smartfit_path.write_bytes(generate_demo_smartwatch_png())
        logger.info(f"Seeded demo smartwatch asset: {smartfit_path}")

    opaque_path = demo_dir / "opaque_watch.jpg"
    if not opaque_path.exists():
        opaque_path.write_bytes(generate_opaque_sample_jpg())

    lowres_path = demo_dir / "low_res_watch.png"
    if not lowres_path.exists():
        lowres_path.write_bytes(generate_low_res_sample_png())

    corrupt_path = demo_dir / "corrupt_watch.png"
    if not corrupt_path.exists():
        corrupt_path.write_bytes(b"\x89PNG\r\n\x1a\ncorrupted_data_chunk_not_valid_ihdr")
