"""
logging_config.py
-----------------
Loguru configuration for the DealLens backend.

Features:
  - Console + daily rolling file sinks
  - Per-request ``request_id`` injected via contextvars for full traceability
  - Structured format: timestamp | level | module:function:line | request_id | message
  - DB-change events logged at INFO level with a ``[DB_WRITE]`` tag

Call ``setup_logging()`` once at application startup.
Use ``bind_request_id()`` in middleware to tag every log line with the request ID.
"""

import sys
import uuid
from contextvars import ContextVar

from loguru import logger

from app.config import LOG_DIR

# ---------------------------------------------------------------------------
# Context variable for per-request traceability
# ---------------------------------------------------------------------------

_request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")


def bind_request_id(request_id: str | None = None) -> str:
    """
    Set (or auto-generate) a request ID for the current async context.
    Returns the ID so callers can include it in HTTP response headers.
    """
    rid = request_id or uuid.uuid4().hex[:12]
    _request_id_ctx.set(rid)
    return rid


def get_request_id() -> str:
    """Retrieve the current request ID (defaults to ``-`` outside a request)."""
    return _request_id_ctx.get()


# ---------------------------------------------------------------------------
# Custom format function
# ---------------------------------------------------------------------------

def _format_record(record: dict) -> str:
    """Build a log line that always includes the request ID."""
    rid = _request_id_ctx.get()
    record["extra"]["rid"] = rid
    return (
        "{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | "
        "{name}:{function}:{line} | rid={extra[rid]} | "
        "{message}\n"
    )


def _console_format(record: dict) -> str:
    """Colourised console variant."""
    rid = _request_id_ctx.get()
    record["extra"]["rid"] = rid
    return (
        "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
        "<dim>rid={extra[rid]}</dim> | "
        "<level>{message}</level>\n"
    )


# ---------------------------------------------------------------------------
# Public setup
# ---------------------------------------------------------------------------

def setup_logging() -> None:
    """Configure loguru with console + daily rolling file sinks."""
    # Remove default handler to avoid duplicate console output
    logger.remove()

    # Console sink – INFO and above (clean output)
    logger.add(
        sys.stdout,
        level="INFO",
        format=_console_format,
        colorize=True,
    )

    # File sink – daily rotation, 30-day retention, DEBUG for full detail
    logger.add(
        str(LOG_DIR / "deallens_{time:YYYY-MM-DD}.log"),
        rotation="00:00",
        retention="30 days",
        level="DEBUG",
        format=_format_record,
        enqueue=True,  # thread-safe writes
    )

    logger.info("Loguru logging initialised – logs dir: {}", str(LOG_DIR))
