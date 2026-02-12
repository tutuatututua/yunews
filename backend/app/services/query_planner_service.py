from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any
from typing import cast

from app.schemas.query_plan import QueryPlan

logger = logging.getLogger(__name__)


_FINANCE_HINTS: tuple[str, ...] = (
    "stock",
    "stocks",
    "share",
    "shares",
    "price",
    "valuation",
    "market cap",
    "earnings",
    "guidance",
    "revenue",
    "profit",
    "loss",
    "margin",
    "quarter",
    "q1",
    "q2",
    "q3",
    "q4",
    "ipo",
    "sec",
    "10-k",
    "10q",
    "10-q",
    "form 4",
    "buyback",
    "dividend",
    "merger",
    "acquisition",
    "m&a",
    "analyst",
    "upgrade",
    "downgrade",
    "target price",
    "guidance",
    "ceo",
    "cfo",
    "balance sheet",
    "cash flow",
    "bond",
    "yield",
    "rates",
    "interest rate",
    "fed",
    "inflation",
    "cpi",
    "ppi",
    "jobs report",
    "unemployment",
    "gdp",
    "market",
    "nasdaq",
    "nyse",
)


def _guess_stock_related(text: str) -> bool:
    q = (text or "").strip()
    if not q:
        return False

    ql = q.lower()
    if ql in {"hi", "hello", "hey", "thanks", "thank you", "ok", "okay", "cool"}:
        return False

    # Strong ticker hints.
    if re.search(r"\$[A-Za-z]{1,5}\b", q):
        return True
    if re.search(r"\b(?:NASDAQ|NYSE|AMEX)\s*:\s*[A-Za-z]{1,5}\b", q, flags=re.IGNORECASE):
        return True
    if re.search(r"\bticker\s*[:=]?\s*\$?[A-Za-z]{1,5}\b", q, flags=re.IGNORECASE):
        return True
    if re.search(r"\([A-Za-z]{2,5}\)", q):
        return True

    # Keyword hints.
    return any(hint in ql for hint in _FINANCE_HINTS)


def _clip(s: str, n: int = 600) -> str:
    s = (s or "").strip()
    if len(s) <= n:
        return s
    return s[:n] + "…"


_PLANNER_SYSTEM = (
    "You are a query planner for a retrieval-augmented news assistant. "
    "Your job is to rewrite the user's question into a concise retrieval query and extract optional filters.\n"
    "Rules:\n"
    "- Output ONLY valid JSON (no markdown, no commentary).\n"
    "- First decide if the question is stock-related (stocks/companies/markets/business news). If it is not, set is_stock_related=false and tickers=null.\n"
    "- Do NOT add facts or assume tickers/time ranges not implied by the user.\n"
    "- Always include rewritten_prompt as a non-empty string. If you are unsure about filters, set them to null and keep rewritten_prompt close to the original.\n"
    "- If the user's question is a follow-up (short/ambiguous like 'what about guidance?' or uses 'it/they/that'), use recent_history (both user and assistant) to resolve the subject and include the resolved subject in rewritten_prompt.\n"
    "- If the follow-up implies the SAME primary ticker(s) as recent_history, carry those forward into tickers rather than dropping them.\n"
    "\n"
    "Ticker guidance:\n"
    "- Set tickers only if the user clearly references a specific stock ticker/company (e.g. '$AAPL', 'AAPL', 'Tesla/TSLA').\n"
    "- If multiple tickers are central to the question (e.g. comparisons), set tickers=[...] (up to 3).\n"
    "- If only one ticker is central, set tickers=['AAPL'].\n"
    "- If unsure, set tickers=null.\n"
    "Return a JSON object with keys:\n"
    "- is_stock_related: boolean\n"
    "- rewritten_prompt: string\n"
    "- tickers: array of uppercase tickers like ['AAPL','MSFT'] (no '$') or null\n"
)


def plan_query(*, question: str, history: list[dict] | None, openai_api_key: str, model: str) -> QueryPlan | None:
    """
    Generate a QueryPlan via OpenAI.
    """


    def _fallback_plan() -> QueryPlan:
        # Minimal, safe default that preserves the user's question without making
        # retrieval depend on chat continuity.
        q = (question or "").strip()
        return QueryPlan(
            is_stock_related=_guess_stock_related(q),
            rewritten_prompt=q or "(no question)",
            tickers=None,
        )


    try:
        from openai import OpenAI

        client = OpenAI(api_key=openai_api_key.strip())

        now = datetime.now(timezone.utc).isoformat()
        history_bits: list[str] = []
        for m in (history or [])[-6:]:
            if not isinstance(m, dict):
                continue
            role = str(m.get("role") or "").strip()
            content = str(m.get("content") or "").strip()
            if role in ("user", "assistant") and content:
                history_bits.append(f"{role}: {content[:500]}")

        user_payload: dict[str, Any] = {
            "now_utc": now,
            "question": question,
            "recent_history": history_bits,
        }

        logger.info(
            "QueryPlanner start model=%s question=%s history_msgs=%s",
            model,
            _clip(question, 240),
            len(history_bits),
        )

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": _PLANNER_SYSTEM},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
        ]

        resp = client.chat.completions.create(
            model=model,
            messages=cast(Any, messages),
            temperature=0.0,
        )

        content = (resp.choices[0].message.content or "").strip()
        if not content:
            logger.info("QueryPlanner empty response")
            return _fallback_plan()

        logger.info("QueryPlanner raw=%s", _clip(content, 1200))

        try:
            data = json.loads(content)
        except Exception:
            logger.info("QueryPlanner invalid JSON=%s", _clip(content, 500))
            return _fallback_plan()

        # Backward-compatible input normalization:
        # - older prompts/models may return {"ticker": "AAPL"}. Convert to tickers=[...].
        # - older prompts/models may return {"rewritten_query": "..."}. Convert to rewritten_prompt.
        if isinstance(data, dict):
            raw_tickers = data.get("tickers")
            raw_ticker = data.get("ticker")
            if (not raw_tickers) and raw_ticker:
                data["tickers"] = [raw_ticker]

            if (not data.get("rewritten_prompt")) and data.get("rewritten_query"):
                data["rewritten_prompt"] = data.get("rewritten_query")

            # If the model omitted rewritten_prompt entirely, fall back to the user's question.
            if not data.get("rewritten_prompt"):
                data["rewritten_prompt"] = (question or "").strip()

            # If the model returned is_stock_related as a string, coerce it.
            raw_is_stock = data.get("is_stock_related")
            if isinstance(raw_is_stock, str):
                v = raw_is_stock.strip().lower()
                if v in ("true", "false"):
                    data["is_stock_related"] = v == "true"

            # If the model omitted is_stock_related, infer from the prompt/question.
            if data.get("is_stock_related") is None:
                basis = str(data.get("rewritten_prompt") or question or "")
                data["is_stock_related"] = _guess_stock_related(basis)

            # If not stock-related, force tickers=null for safety/consistency.
            if data.get("is_stock_related") is False:
                data["tickers"] = None

        if not isinstance(data, dict):
            return _fallback_plan()

        try:
            plan = QueryPlan.model_validate(data)
        except Exception:
            logger.info("QueryPlanner invalid schema=%s", _clip(str(data), 500))
            return _fallback_plan()

        # Final sanity: rewritten_prompt must exist and be non-empty.
        if not plan.rewritten_prompt.strip():
            logger.info("QueryPlanner missing rewritten_prompt")
            return _fallback_plan()

        # Normalize tickers.
        if not getattr(plan, "is_stock_related", True):
            plan.tickers = None
        elif getattr(plan, "tickers", None):
            seen: set[str] = set()
            norm: list[str] = []
            for t in (plan.tickers or []):
                sym = str(t).strip().upper().lstrip("$")
                if not sym or sym in seen:
                    continue
                seen.add(sym)
                norm.append(sym)
                if len(norm) >= 3:
                    break
            plan.tickers = norm or None

        logger.info(
            "QueryPlanner plan stock_related=%s tickers=%s rewritten=%s",
            getattr(plan, "is_stock_related", True),
            getattr(plan, "tickers", None),
            _clip(getattr(plan, "rewritten_prompt", ""), 300),
        )

        return plan
    except Exception as exc:
        logger.info("QueryPlanner failed: %s: %s", type(exc).__name__, str(exc)[:200])
        return _fallback_plan()
