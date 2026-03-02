from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, cast

from app.schemas.query_plan import QueryPlan

logger = logging.getLogger(__name__)


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
    "- First decide if the question is stock-related (stocks/companies/markets/business news). If it is not, set is_stock_related=false.\n"
    "- If you are unsure whether the question is stock-related, set is_stock_related=true.\n"
    "- Do NOT add facts or assume tickers/time ranges not implied by the user.\n"
    "- Always include rewritten_prompt as a non-empty string. If you are unsure about filters, set them to null and keep rewritten_prompt close to the original.\n"
    "- If the user's question is a follow-up (short/ambiguous like 'what about guidance?' or uses 'it/they/that'), use recent_history (both user and assistant) to resolve the subject and include the resolved subject in rewritten_prompt.\n"
    "- If the follow-up implies the SAME primary ticker(s) as recent_history, carry those forward into tickers rather than dropping them.\n"
    "\n"
    "Ticker guidance:\n"
    "- Set tickers only if the user clearly references a specific stock ticker/company (e.g. '$AAPL', 'AAPL', 'Tesla/TSLA').\n"
    "- If the user mentions a company name but you are not fully confident of the exact ticker, keep tickers=null (do NOT mark is_stock_related=false just because you can't map it).\n"
    "- If multiple tickers are central to the question (e.g. comparisons), set tickers=[...] (up to 3).\n"
    "- If only one ticker is central, set tickers=['AAPL'].\n"
    "- If unsure, set tickers=null.\n"
    "Return a JSON object with keys:\n"
    "- is_stock_related: boolean\n"
    "- rewritten_prompt: string\n"
    "- tickers: array of uppercase tickers like ['AAPL','MSFT'] (no '$') or null\n"
)


class QueryPlannerService:
    def __init__(self, *, openai_api_key: str, model: str) -> None:
        self._openai_api_key = (openai_api_key or "").strip()
        self._model = (model or "").strip()

    def plan_query(self, *, question: str, history: list[dict] | None) -> QueryPlan | None:
        """Generate a QueryPlan via OpenAI."""

        if not self._openai_api_key or not self._model:
            return None

        try:
            from openai import OpenAI

            client = OpenAI(api_key=self._openai_api_key)

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
                self._model,
                _clip(question, 240),
                len(history_bits),
            )

            messages: list[dict[str, Any]] = [
                {"role": "system", "content": _PLANNER_SYSTEM},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ]

            resp = client.chat.completions.create(
                model=self._model,
                messages=cast(Any, messages),
                temperature=0.0,
            )

            content = (resp.choices[0].message.content or "").strip()
            if not content:
                logger.info("QueryPlanner empty response")
                return None

            logger.info("QueryPlanner raw=%s", _clip(content, 1200))

            try:
                data = json.loads(content)
            except Exception:
                logger.info("QueryPlanner invalid JSON=%s", _clip(content, 500))
                return None

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

                # If the model is unsure/omits is_stock_related, default to True.
                if data.get("is_stock_related") is None:
                    data["is_stock_related"] = True

                if not isinstance(data.get("is_stock_related"), bool):
                    logger.info(
                        "QueryPlanner invalid is_stock_related=%s",
                        _clip(str(data.get("is_stock_related")), 200),
                    )
                    return None

                # If not stock-related, force tickers=null for safety/consistency.
                if data.get("is_stock_related") is False:
                    data["tickers"] = None

            if not isinstance(data, dict):
                return None

            try:
                plan = QueryPlan.model_validate(data)
            except Exception:
                logger.info("QueryPlanner invalid schema=%s", _clip(str(data), 500))
                return None

            # Final sanity: rewritten_prompt must exist and be non-empty.
            if not plan.rewritten_prompt.strip():
                logger.info("QueryPlanner missing rewritten_prompt")
                return None

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
            return None
