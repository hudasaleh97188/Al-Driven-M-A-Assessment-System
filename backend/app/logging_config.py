"""
logging_config.py
-----------------
Loguru configuration for the DealLens backend.
Call ``setup_logging()`` once at application startup.
"""

import sys
from loguru import logger
from app.config import LOG_DIR


def setup_logging() -> None:
    """Configure loguru with console + daily rolling file sinks."""
    # Remove default handler to avoid duplicate console output
    logger.remove()

    # Console sink – DEBUG and above
    logger.add(
        sys.stdout,
        level="DEBUG",
        format=(
            "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
            "<level>{level: <8}</level> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
            "<level>{message}</level>"
        ),
        colorize=True,
    )

    # File sink – daily rotation, 30-day retention, DEBUG for full detail
    logger.add(
        str(LOG_DIR / "deallens_{time:YYYY-MM-DD}.log"),
        rotation="00:00",
        retention="30 days",
        level="DEBUG",
        format=(
            "{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | "
            "{name}:{function}:{line} | {message}"
        ),
        enqueue=True,  # thread-safe writes
    )

    logger.info("Loguru logging initialised – logs → {}", str(LOG_DIR))
