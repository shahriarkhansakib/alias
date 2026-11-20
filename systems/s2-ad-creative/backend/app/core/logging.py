import logging
import sys
from app.core.config import settings


def setup_logging():
    log_level = logging.DEBUG if settings.DEBUG else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s | %(levelname)-7s | %(name)s:%(funcName)s:%(lineno)d - %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    # Quiet overly chatty loggers if needed
    logging.getLogger("uvicorn.access").setLevel(logging.INFO)
    return logging.getLogger("alias_imggen")


logger = setup_logging()
