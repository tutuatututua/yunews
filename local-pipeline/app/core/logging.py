from __future__ import annotations

import logging
import os
import sys
from typing import Any, Dict, Optional


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


def log_llm_prompt_stats(
    logger: logging.Logger,
    *,
    model: str | None,
    label: str,
    prompt: str,
    extra: Dict[str, Any] | None = None,
) -> None:
    """Log basic prompt sizing stats (chars + tokens when possible).

    - Token count uses tiktoken when available; otherwise logs an approximate heuristic.
    - Safe to call even if logging is disabled or tiktoken is not installed.
    """

    if not logger.isEnabledFor(logging.INFO):
        return

    prompt = prompt or ""
    chars = len(prompt)

    # Cheap, dependency-free heuristic (often ~4 chars/token for English).
    approx_tokens = (chars + 3) // 4

    tokens: int | None = None
    try:
        import tiktoken  # type: ignore

        try:
            enc = tiktoken.encoding_for_model(model or "")
        except Exception:
            enc = tiktoken.get_encoding("cl100k_base")
        tokens = len(enc.encode(prompt))
    except Exception:
        tokens = None

    payload: Dict[str, Any] = {
        "label": label,
        "model": model,
        "prompt_chars": chars,
        "prompt_tokens": tokens,
        "prompt_tokens_approx": approx_tokens,
    }
    if extra:
        payload.update(extra)

    # Structured-ish logging without requiring JSON logger config.
    logger.info("LLM prompt stats: %s", payload)
