from __future__ import annotations

import json
import logging
import re
from typing import List, Set

from langchain.prompts import PromptTemplate
from langchain_openai import ChatOpenAI
from pydantic import SecretStr
from pydantic import ValidationError

from app.core.logging import log_llm_prompt_stats
from app.models.schemas import ExtractionResult

logger = logging.getLogger(__name__)

_TICKER_RE = re.compile(r"\$([A-Z]{1,5})(?=\b|[\s.,;:!?])")


class TickerTopicService:
    """Extract tickers per chunk.

    Uses a hybrid approach:
    - regex extraction for explicit $TICKER patterns
    - LLM extraction to infer tickers from company names and produce categorized keypoints
    """

    def __init__(self, *, openai_api_key: str, model: str, temperature: float) -> None:
        self._model = model
        self._llm = ChatOpenAI(api_key=SecretStr(openai_api_key), model=model, temperature=temperature)

        self._prompt = PromptTemplate(
            input_variables=["chunk_text"],
            template=(
                "You are an expert financial analyst.\n"
                "Task: From the transcript chunk below, extract up to 10 tickers (plus optional MARKET) and write concise, transcript-grounded keypoints.\n"
                "Focus on HIGH-SIGNAL items: risks, opportunities, and catalysts/events (earnings, guidance changes, product launches, M&A, lawsuits, regulation, macro releases like CPI/FOMC/jobs, rate cuts/hikes).\n"
                "If a statement is uncertain, preserve the uncertainty (e.g., 'Speaker expects/might/could ...').\n\n"
                "Transcript chunk (verbatim):\n"
                "<chunk>\n"
                "{chunk_text}\n"
                "</chunk>\n\n"
                "Output requirements:\n"
                "- Output ONE valid JSON object only (no markdown/code fences, no commentary).\n"
                "- JSON schema: {{\"ticker_topic_pairs\": [ ... ]}}.\n"
                "- Each item in ticker_topic_pairs must be:\n"
                "  {{\"ticker\": \"AAPL\", \"positive_keypoints\": [...], \"negative_keypoints\": [...], \"neutral_keypoints\": [...]}}\n"
                "- ticker: uppercase letters only, 1-5 chars (no '$'). Use ticker \"MARKET\" for macro/market-wide items.\n"
                "- Keypoints: short bullet-like strings. Prefer numbers + direction + timeframe/date when present.\n"
                "- Categorize: upside/opportunities in positive_keypoints; risks/headwinds in negative_keypoints; dated facts/events (if not clearly +/-) in neutral_keypoints.\n"
                "- Include explicit $TICKER mentions. Infer ticker from company name only when you are confident; otherwise omit the ticker rather than guessing.\n"
                "- If there are no relevant tickers or macro items, return {{\"ticker_topic_pairs\": []}}.\n\n"
                "Example output (shape only):\n"
                "{{\n"
                "  \"ticker_topic_pairs\": [\n"
                "    {{\"ticker\": \"AAPL\", \"positive_keypoints\": [\"Speaker says iPhone demand improved\"], \"negative_keypoints\": [], \"neutral_keypoints\": [\"Earnings scheduled for Jan 30\"]}},\n"
                "    {{\"ticker\": \"MARKET\", \"positive_keypoints\": [], \"negative_keypoints\": [\"Speaker warns CPI print could push yields higher\"], \"neutral_keypoints\": []}}\n"
                "  ]\n"
                "}}"
            ),
        )

    def extract(self, chunk_text: str) -> ExtractionResult:
        """Extract tickers with categorized keypoints."""
        regex_tickers: Set[str] = {m.group(1) for m in _TICKER_RE.finditer(chunk_text or "")}

        llm_result = None
        try:
            formatted_prompt = self._prompt.format(
                chunk_text=(chunk_text or "")[:12000],
            )
            log_llm_prompt_stats(
                logger,
                model=self._model,
                label="ticker_topic_extraction",
                prompt=formatted_prompt,
                extra={
                    "chunk_chars": len(chunk_text or ""),
                    "regex_tickers_count": len(regex_tickers),
                },
            )
            msg = self._llm.invoke(formatted_prompt)
            llm_result = msg.content
        except Exception:
            logger.exception("Ticker/topic LLM call failed")

        if llm_result:
            parsed = self._safe_json(str(llm_result))
            if parsed:
                try:
                    normalized = self._normalize_extraction_dict(parsed, regex_tickers)
                    er = ExtractionResult.model_validate(normalized)
                    # Validate we got pairs
                    if er.ticker_topic_pairs:
                        return er
                except ValidationError as e:
                    logger.warning("Ticker/topic output failed validation: %s", e)

        # Fallback: regex tickers with no keypoints
        return ExtractionResult(
            ticker_topic_pairs=[
                {
                    "ticker": t,
                    "positive_keypoints": [],
                    "negative_keypoints": [],
                    "neutral_keypoints": [],
                }
                for t in sorted(regex_tickers)
            ],
            tickers=sorted(regex_tickers),  # legacy field
        )

    @staticmethod
    def _normalize_extraction_dict(payload: dict, regex_tickers: Set[str]) -> dict:
        """Normalize a loosely-correct LLM payload into the expected schema.

        - ticker_topic_pairs: array of {ticker, positive_keypoints, negative_keypoints, neutral_keypoints} objects
        - tickers: strip '$', whitespace, uppercase, keep 1-5 alpha (or 'MARKET' for market-wide topics)
        - positive_keypoints: bullish claims (max 4 per ticker)
        - negative_keypoints: bearish claims (max 4 per ticker)
        - neutral_keypoints: neutral/factual claims (max 4 per ticker)
        """
        raw_pairs = payload.get("ticker_topic_pairs") if isinstance(payload, dict) else None
        
        normalized_pairs: List[dict] = []
        seen_tickers: Set[str] = set()
        
        if isinstance(raw_pairs, list):
            for pair in raw_pairs[:10]:  # max 10 pairs per chunk
                if not isinstance(pair, dict):
                    continue
                
                raw_ticker = pair.get("ticker", "")
                ticker = str(raw_ticker).strip().upper()
                if ticker.startswith("$"):
                    ticker = ticker[1:]
                # Allow 'MARKET' as a special ticker for macro/market-wide topics
                if ticker == "MARKET":
                    pass  # Valid special ticker
                elif not ticker or not re.fullmatch(r"[A-Z]{1,5}", ticker):
                    continue
                
                # Deduplicate tickers within same chunk
                if ticker in seen_tickers:
                    continue
                seen_tickers.add(ticker)
                
                # Validate categorized keypoints (max 4 each, non-empty)
                positive_keypoints: List[str] = []
                negative_keypoints: List[str] = []
                neutral_keypoints: List[str] = []

                for key_name, out_list in (
                    ("positive_keypoints", positive_keypoints),
                    ("negative_keypoints", negative_keypoints),
                    ("neutral_keypoints", neutral_keypoints),
                ):
                    raw_kps = pair.get(key_name, [])
                    if not isinstance(raw_kps, list):
                        continue
                    for kp in raw_kps[:4]:
                        kp_str = str(kp).strip()
                        if kp_str:
                            out_list.append(kp_str)

                normalized_pairs.append(
                    {
                    "ticker": ticker,
                    "positive_keypoints": positive_keypoints,
                    "negative_keypoints": negative_keypoints,
                    "neutral_keypoints": neutral_keypoints,
                    }
                )
        
        # Merge in any regex-detected tickers not in LLM output
        for ticker in regex_tickers:
            if ticker not in seen_tickers:
                normalized_pairs.append({
                    "ticker": ticker,
                    "positive_keypoints": [],
                    "negative_keypoints": [],
                    "neutral_keypoints": [],
                })
                seen_tickers.add(ticker)
        
        # Legacy field for backward compatibility
        all_tickers = sorted(seen_tickers)
        return {
            "ticker_topic_pairs": normalized_pairs,
            "tickers": all_tickers,  # legacy
        }

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
            parsed = json.loads(candidate)
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None


