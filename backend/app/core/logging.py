from __future__ import annotations

import logging
from typing import Final


_DEFAULT_FORMAT: Final[str] = "%(levelname)s %(asctime)s %(name)s %(message)s"


def configure_logging(*, level: str = "INFO") -> None:
    """Configure Python logging once.

    Uvicorn/Gunicorn may also configure handlers; this keeps local + container runs consistent.
    """

    # If handlers already exist, don't clobber them (common under Gunicorn/Uvicorn workers).
    root = logging.getLogger()
    if root.handlers:
        root.setLevel(level)
        return

    logging.basicConfig(level=level, format=_DEFAULT_FORMAT)
