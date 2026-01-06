from __future__ import annotations

import logging
import os
import sys
from typing import Optional


def configure_logging(level: Optional[str] = None) -> None:
    """Configure structured-ish console logging.

    - Default level: INFO
    - Override with LOG_LEVEL env var or function argument
    """

    resolved_level = (level or os.getenv("LOG_LEVEL") or "INFO").upper()

    logging.basicConfig(
        level=getattr(logging, resolved_level, logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[logging.StreamHandler(sys.stdout)],
    )

    # Reduce noisy loggers
    for noisy in [
        "httpx",
        "urllib3",
        "supabase",
        "postgrest",
        "openai",
        "transformers",
        "huggingface_hub",
    ]:
        logging.getLogger(noisy).setLevel(logging.WARNING)
