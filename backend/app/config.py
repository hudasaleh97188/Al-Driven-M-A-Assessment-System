"""
config.py
---------
Centralised application settings.
Reads from environment variables with sensible defaults.
"""

import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parent.parent          # backend/
DATA_DIR    = BACKEND_DIR / "data"
LOG_DIR     = BACKEND_DIR / "logs"
DB_PATH     = DATA_DIR / "deallens.db"

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Google Cloud / Vertex AI
# ---------------------------------------------------------------------------
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "rag-project-485016")
VERTEX_LOCATION = os.getenv("VERTEX_LOCATION", "global")
PRIMARY_MODEL   = os.getenv("PRIMARY_MODEL", "gemini-3.1-pro-preview")

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
SERVER_HOST = os.getenv("SERVER_HOST", "0.0.0.0")
SERVER_PORT = int(os.getenv("SERVER_PORT", "5050"))
