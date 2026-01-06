from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

from langchain.prompts import PromptTemplate
from langchain_openai import ChatOpenAI
from pydantic import SecretStr
from pydantic import ValidationError

from app.models.schemas import AggregatedSummary, ChunkSummary

logger = logging.getLogger(__name__)


class SummarizationService:
    """Summarize transcript chunks and aggregate by (video_id, ticker, topic)."""

    def __init__(self, *, openai_api_key: str, model: str, temperature: float) -> None:
        self._llm = ChatOpenAI(api_key=SecretStr(openai_api_key), model=model, temperature=temperature)

        self._chunk_prompt = PromptTemplate(
            input_variables=["chunk_text", "tickers", "topics"],
            template=(
                "You are a precise financial summarizer.\n"
                "Summarize the transcript chunk with a focus on the provided tickers/topics.\n\n"
                "Constraints:\n"
                "- Return STRICT JSON only. No markdown.\n"
                "- bullets: concise bullet points (max 6).\n"
                "- financial_claims: concrete claims, numbers, catalysts (max 6).\n"
                "- opinions_vs_facts: short lines that distinguish opinion vs fact (max 6).\n\n"
                "Tickers: {tickers}\n"
                "Topics: {topics}\n\n"
                "Chunk:\n{chunk_text}\n\n"
                "JSON schema:\n"
                "{{\n  \"bullets\": [" "\"...\"" "],\n  \"financial_claims\": [" "\"...\"" "],\n  \"opinions_vs_facts\": [" "\"Opinion: ... | Fact: ...\"" "]\n}}"
            ),
        )

        self._agg_prompt = PromptTemplate(
            input_variables=["ticker", "topic", "items"],
            template=(
                "You are aggregating multiple chunk summaries for a single (ticker, topic).\n"
                "Create a structured view: bull case, bear case, risks.\n\n"
                "Constraints:\n"
                "- Return STRICT JSON only. No markdown.\n"
                "- Each field is an array of concise bullets (max 8 each).\n"
                "- Avoid duplicating bullets.\n\n"
                "Ticker: {ticker}\n"
                "Topic: {topic}\n\n"
                "Chunk summaries (JSON list):\n{items}\n\n"
                "JSON schema:\n"
                "{{\n  \"bull_case\": [\"...\"],\n  \"bear_case\": [\"...\"],\n  \"risks\": [\"...\"]\n}}"
            ),
        )

    def summarize_chunk(self, *, chunk_text: str, tickers: List[str], topics: List[str]) -> ChunkSummary:
        try:
            msg = self._llm.invoke(
                self._chunk_prompt.format(
                    chunk_text=(chunk_text or "")[:12000],
                    tickers=", ".join(tickers) if tickers else "(none)",
                    topics=", ".join(topics) if topics else "(none)",
                )
            )
            parsed = self._safe_json(str(msg.content))
            if parsed:
                return ChunkSummary.model_validate(parsed)
        except ValidationError:
            logger.warning("Chunk summary JSON failed validation")
        except Exception:
            logger.exception("Chunk summarization failed")

        return ChunkSummary(bullets=[], financial_claims=[], opinions_vs_facts=[])

    def aggregate(self, *, ticker: str, topic: str, chunk_summaries: List[Dict[str, Any]]) -> AggregatedSummary:
        try:
            msg = self._llm.invoke(
                self._agg_prompt.format(
                    ticker=ticker,
                    topic=topic,
                    items=json.dumps(chunk_summaries, ensure_ascii=False)[:20000],
                )
            )
            parsed = self._safe_json(str(msg.content))
            if parsed:
                return AggregatedSummary.model_validate(parsed)
        except ValidationError:
            logger.warning("Aggregate summary JSON failed validation")
        except Exception:
            logger.exception("Aggregation failed")

        return AggregatedSummary(bull_case=[], bear_case=[], risks=[])

    @staticmethod
    def _safe_json(text: str) -> dict | None:
        text = (text or "").strip()
        if not text:
            return None
        first = text.find("{")
        last = text.rfind("}")
        if first == -1 or last == -1 or last <= first:
            return None
        candidate = text[first : last + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            return None
