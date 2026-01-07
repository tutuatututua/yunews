from __future__ import annotations

import json
import logging
import re
from typing import List, Set

from langchain.prompts import PromptTemplate
from langchain_openai import ChatOpenAI
from pydantic import SecretStr
from pydantic import ValidationError

from app.models.schemas import ExtractionResult, Topic

logger = logging.getLogger(__name__)

_TICKER_RE = re.compile(r"\$([A-Z]{1,5})(?=\b|[\s.,;:!?])")

_ALLOWED_TOPICS: List[Topic] = [
    "Earnings",
    "Valuation",
    "Macro",
    "Technical",
    "Risk",
    "LongTerm",
    "ShortTerm",
]


class TickerTopicService:
    """Extract tickers and topics per chunk.

    Uses a hybrid approach:
    - regex extraction for explicit $TICKER patterns
    - LLM extraction to infer tickers from company names and classify topics
    """

    def __init__(self, *, openai_api_key: str, model: str, temperature: float) -> None:
        self._llm = ChatOpenAI(api_key=SecretStr(openai_api_key), model=model, temperature=temperature)

        self._prompt = PromptTemplate(
        input_variables=["chunk_text", "topics"],
        template=(
            "You are an expert financial analyst.\n"
            "Given a transcript chunk, extract stock tickers and classify topics.\n\n"
            "Rules:\n"
            "- Return STRICT JSON only. No markdown.\n"
            "- tickers: array of uppercase tickers WITHOUT '$'.\n"
            "- Include tickers explicitly mentioned with $ (e.g., $AAPL) and infer tickers from company names when reasonable.\n"
            "- If uncertain, omit rather than guessing.\n"
            "- topics must be a subset of: {topics}.\n\n"
            "Chunk:\n{chunk_text}\n\n"
            "JSON schema:\n"
            "{{\n  \"tickers\": [\"AAPL\"],\n  \"topics\": [\"Earnings\", \"Risk\"]\n}}"
        ),
    )


    def extract(self, chunk_text: str) -> ExtractionResult:
        tickers: Set[str] = {m.group(1) for m in _TICKER_RE.finditer(chunk_text or "")}

        llm_result = None
        try:
            msg = self._llm.invoke(self._prompt.format(chunk_text=chunk_text[:12000],
                                                       topics=json.dumps(_ALLOWED_TOPICS)))
            llm_result = msg.content
        except Exception:
            logger.exception("Ticker/topic LLM call failed")

        if llm_result:
            parsed = self._safe_json(str(llm_result))
            if parsed:
                try:
                    er = ExtractionResult.model_validate(parsed)
                    tickers.update([t.strip().upper() for t in er.tickers if t.strip()])
                    # topics already validated by Literal
                    return ExtractionResult(tickers=sorted(tickers), topics=er.topics)
                except ValidationError:
                    logger.warning("Ticker/topic output failed validation")

        # Fallback: regex tickers only, no topics
        return ExtractionResult(tickers=sorted(tickers), topics=[])

    @staticmethod
    def _safe_json(text: str) -> dict | None:
        text = (text or "").strip()
        if not text:
            return None

        # Strip any accidental leading/trailing prose
        first = text.find("{")
        last = text.rfind("}")
        if first == -1 or last == -1 or last <= first:
            return None

        candidate = text[first : last + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            return None
