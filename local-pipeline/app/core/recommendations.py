from __future__ import annotations

import re
from typing import Any

_RECOMMENDATION_TITLE_RE = re.compile(
    r"\b("
    r"recommend(?:s|ed|ing|ation)?"
    r"|recomend(?:s|ed|ing|ation)?"
    r"|buy(?:ing)?"
    r"|stock\s+picks?"
    r"|picks?"
    r"|top\s+stocks?"
    r"|best\s+stocks?"
    r"|this\s+stock\b.{0,40}\b(?:will|can|could|is\s+going\s+to)\s+(?:grow|rise|soar|surge|rally|explode|moon|double|(?:[2-9]|10)x)\b"
    r"|all+in?"
    r")\b",
    re.IGNORECASE,
)
_RECOMMENDATION_TITLE_EXCLUDE_RE = re.compile(
    r"\b(don't\s+buy|do\s+not\s+buy|sell|short|avoid)\b",
    re.IGNORECASE,
)


def is_recommendation_title(title: Any) -> bool:
    """Heuristic classifier for "recommendation"-style videos.

    This is intentionally simple and cheap: it is used to decide whether to
    store lightweight events in `youtuber_recommendations`.
    """

    text = str(title or "").strip()
    if not text:
        return False

    include = _RECOMMENDATION_TITLE_RE.search(text) is not None
    if not include:
        return False

    # Titles can contain both "buy" and "avoid" (e.g., "3 stocks to buy and 2 to avoid").
    # In those mixed cases we still want to treat the video as recommendation-style,
    # and let downstream per-ticker filters decide what to store.
    return True
