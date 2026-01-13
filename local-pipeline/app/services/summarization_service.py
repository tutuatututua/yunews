from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Any, Dict, List, Optional

from langchain.prompts import PromptTemplate
from langchain_openai import ChatOpenAI
from pydantic import SecretStr
from pydantic import ValidationError

from app.core.logging import log_llm_prompt_stats
from app.models.schemas import AggregatedSummary, ChunkSummary, DailyOverallSummary, VideoOverallSummary

logger = logging.getLogger(__name__)


class SummarizationService:
    """Summarize transcript chunks and aggregate by ticker."""

    def __init__(self, *, openai_api_key: str, model: str, temperature: float) -> None:
        self._model = model
        self._llm = ChatOpenAI(api_key=SecretStr(openai_api_key), model=model, temperature=temperature)

        self._agg_prompt = PromptTemplate(
            input_variables=["ticker", "items"],
            template=(
                "Aggregate chunk keypoints for ONE ticker.\n"
                "Return a SINGLE JSON object only (no markdown, no code fences, no extra text).\n"
                "Use double quotes for all keys/strings; no trailing commas.\n"
                "Rules: each field is an array of concise, de-duplicated bullets (max 10).\n"
                "Do not mention other tickers unless it is essential context for this ticker (prefer omitting).\n"
                "Do not invent facts; omit uncertainty.\n"
                "All array items must be plain strings.\n"
                "Always include all keys in the schema; use empty arrays when needed.\n\n"
                "Ticker: {ticker}\n"
                "Chunk summaries (JSON list of objects with keys: positive, negative, neutral):\n"
                "{items}\n\n"
                "Schema: {{\"positive\":[...],\"negative\":[...],\"neutral\":[...]}}"
            ),
        )

        self._agg_video_prompt = PromptTemplate(
            input_variables=["items"],
            template=(
                "Aggregate chunk keypoints for MULTIPLE tickers in ONE pass.\n"
                "Return a SINGLE JSON object only (no markdown, no code fences, no extra text).\n"
                "Use double quotes for all keys/strings; no trailing commas.\n"
                "Rules: each field is an array of concise, de-duplicated bullets (max 10).\n"
                "Do not invent facts; omit uncertainty.\n"
                "All array items must be plain strings.\n"
                "Always include all keys in the schema; use empty arrays when needed.\n"
                "Do not create or rename tickers; only output tickers provided in the input.\n\n"
                "Input items (JSON list; each has keys: ticker, chunk_summaries where each chunk summary has keys: positive, negative, neutral):\n"
                "{items}\n\n"
                "Schema: {{\"items\":[{{\"ticker\":...,\"positive\":[...],\"negative\":[...],\"neutral\":[...]}}]}}"
            ),
        )

        self._video_from_agg_prompt = PromptTemplate(
            input_variables=["title", "channel", "items"],
            template=(
                "Summarize a video using ONLY the aggregated ticker summaries below.\n"
                "Return a SINGLE JSON object only (no markdown fences, no extra text).\n"
                "Use double quotes for all keys/strings; no trailing commas.\n"
                "Do not invent facts/tickers; omit uncertainty.\n"
                "Only include bullets you are confident are supported by the aggregated items.\n"
                "Only include the MOST IMPORTANT / market-moving items; omit minor details.\n"
                "If there are more candidates than the max allowed, choose the top items by importance.\n"
                "summary_markdown is markdown BUT must not contain curly braces.\n"
                "overall_explanation is plain text (max 5 sentences).\n"
                "movers: ONLY include the MOST IMPORTANT movers; the key tickers driving the story (max 5).\n"
                "movers: each item has keys: symbol, direction (up|down|mixed), reason (max 5 sentences).\n"
                "movers: do NOT include MARKET.\n"
                "risks/opportunities are concise bullets (max 10 each).\n"
                "events are catalysts mentioned in the aggregated items (max 10).\n"
                "Each event: date (YYYY-MM-DD or null), timeframe (e.g., 'next week'/'Q1' or null), description, tickers (subset of tickers).\n"
                "key_points are the top takeaways (max 10) AND must not repeat any item in risks, opportunities, or event descriptions.\n"
                "If something fits better as a risk/opportunity/event, put it there and do NOT include it in key_points.\n"
                "sentiment is bullish|bearish|mixed|neutral or null.\n"
                "If unclear, set sentiment to null.\n"
                "Always include ALL keys in the schema; use empty string/list/null when needed.\n\n"
                "Title: {title}\n"
                "Channel: {channel}\n\n"
                "Aggregated items (JSON list of objects with keys: ticker, summary (positive/negative/neutral arrays)):\n"
                "{items}\n\n"
                "Schema: {{\"summary_markdown\":...,\"overall_explanation\":...,\"movers\":[{{\"symbol\":...,\"direction\":...,\"reason\":...}}],\"risks\":[...],\"opportunities\":[...],\"key_points\":[...],\"sentiment\":null,\"events\":[{{\"date\":null,\"timeframe\":null,\"description\":...,\"tickers\":[...]}}]}}"
            ),
        )

        self._daily_prompt = PromptTemplate(
            input_variables=["market_date", "items"],
            template=(
                "Create a daily market summary from the provided video inputs.\n"
                "Return a SINGLE JSON object only (no markdown fences, no extra text).\n"
                "Use double quotes for all keys/strings; no trailing commas.\n"
                "Use ONLY inputs; do not invent facts/tickers/numbers. Omit uncertainty.\n"
                "Only include bullets you are confident are supported by the inputs.\n"
                "overall_summarize is plain text (max 5 sentences), a concise TL;DR for the day.\n"
                "summary_markdown is markdown BUT must not contain curly braces.\n"
                "Deduplicate bullets; keep concise.\n\n"
                "Title must be exactly: Market Summary — {market_date}\n"
                "movers: ONLY include the MOST IMPORTANT movers; skip minor/unclear movers; if none are clearly supported, return an empty array.\n"
                "movers: each item is symbol + direction (up|down|mixed) + 1-sentence reason (max 5 items no hype).\n"
                "risks/opportunities: max 12 bullets each.\n"
                "Always include ALL keys in the schema; use empty string/list when needed.\n\n"
                "Market date (UTC): {market_date}\n"
                "Video inputs (JSON list; keys: title,tickers,overall_explanation,key_points,risks,opportunities):\n"
                "{items}\n\n"
                "Schema: {{\"title\":...,\"overall_summarize\":...,\"summary_markdown\":...,\"movers\":[{{\"symbol\":...,\"direction\":...,\"reason\":...}}],\"risks\":[...],\"opportunities\":[...]}}"
            ),
        )

    def aggregate(self, *, ticker: str, chunk_summaries: List[Dict[str, Any]]) -> AggregatedSummary:
        try:
            # Keep JSON valid; cap size by limiting number of items rather than truncating mid-JSON.
            safe_items_json = self._json_dumps_with_char_limit(chunk_summaries or [], max_chars=20000)
            prompt = self._agg_prompt.format(
                ticker=ticker,
                items=safe_items_json,
            )
            log_llm_prompt_stats(
                logger,
                model=self._model,
                label="aggregate",
                prompt=prompt,
                extra={
                    "ticker": ticker,
                    "items_chars": len(safe_items_json),
                    "items_count": len(chunk_summaries or []),
                },
            )
            msg = self._llm.invoke(
                prompt
            )
            parsed = self._safe_json(str(msg.content))
            if parsed:
                return AggregatedSummary.model_validate(parsed)
        except ValidationError:
            logger.warning("Aggregate summary JSON failed validation")
        except Exception:
            logger.exception("Aggregation failed")

        return AggregatedSummary(positive=[], negative=[], neutral=[])

    def aggregate_video_tickers(
        self,
        *,
        grouped_chunk_summaries: Dict[str, List[Dict[str, Any]]],
        max_chars: int = 22000,
        max_tickers: int = 25,
        max_chunks_per_ticker: int = 10,
    ) -> Dict[str, AggregatedSummary]:
        """Aggregate chunk keypoints for all tickers in a video in a single LLM call.

        Returns a mapping of TICKER -> AggregatedSummary. If the model output is invalid,
        returns an empty mapping (caller should fall back to deterministic aggregation).
        """

        if not grouped_chunk_summaries:
            return {}

        # Prefer the most-mentioned tickers (more chunks => more signal) if we must cap.
        tickers_sorted = sorted(
            grouped_chunk_summaries.keys(),
            key=lambda t: (-len(grouped_chunk_summaries.get(t) or []), str(t)),
        )
        tickers_sorted = tickers_sorted[: max_tickers if max_tickers > 0 else len(tickers_sorted)]

        items: List[Dict[str, Any]] = []
        for t in tickers_sorted:
            cs = grouped_chunk_summaries.get(t) or []
            if max_chunks_per_ticker > 0:
                cs = cs[:max_chunks_per_ticker]
            items.append(
                {
                    "ticker": str(t).strip().upper(),
                    "chunk_summaries": cs,
                }
            )

        try:
            items_json = self._json_dumps_with_char_limit(items, max_chars=max_chars)
            prompt = self._agg_video_prompt.format(items=items_json)
            log_llm_prompt_stats(
                logger,
                model=self._model,
                label="aggregate_video_tickers",
                prompt=prompt,
                extra={
                    "items_chars": len(items_json),
                    "tickers_count": len(items),
                    "max_tickers": max_tickers,
                    "max_chunks_per_ticker": max_chunks_per_ticker,
                },
            )
            msg = self._llm.invoke(prompt)
            parsed = self._safe_json(str(msg.content))
            if not parsed:
                return {}

            raw_items = parsed.get("items")
            if not isinstance(raw_items, list):
                return {}

            out: Dict[str, AggregatedSummary] = {}
            for it in raw_items:
                if not isinstance(it, dict):
                    continue
                ticker = (it.get("ticker") or "").strip().upper()
                if not ticker:
                    continue
                try:
                    out[ticker] = AggregatedSummary.model_validate(it)
                except ValidationError:
                    continue

            return out
        except Exception:
            logger.exception("Video-level aggregation failed")
            return {}

    def summarize_video_overall_from_aggregates(
        self,
        *,
        title: str,
        channel: str,
        aggregated_items: List[Dict[str, Any]],
        max_chars: int = 20000,
    ) -> VideoOverallSummary:
        """Create an overall per-video summary from aggregated (ticker, topic) summaries.

        This is cheaper than summarizing the full transcript because inputs are already condensed.
        """

        try:
            items_json = self._json_dumps_with_char_limit(aggregated_items or [], max_chars=max_chars)
            prompt = self._video_from_agg_prompt.format(
                title=(title or "")[:300],
                channel=(channel or "")[:200],
                items=items_json,
            )
            log_llm_prompt_stats(
                logger,
                model=self._model,
                label="summarize_video_overall_from_aggregates",
                prompt=prompt,
                extra={
                    "items_chars": len(items_json),
                    "items_count": len(aggregated_items or []),
                },
            )
            msg = self._llm.invoke(
                prompt
            )
            parsed = self._safe_json(str(msg.content))
            if parsed:
                video = VideoOverallSummary.model_validate(parsed)
                self._postprocess_video_overall_summary(video)
                return video
        except ValidationError:
            logger.warning("Video overall (from aggregates) JSON failed validation")
        except Exception:
            logger.exception("Video overall (from aggregates) summarization failed")

        return VideoOverallSummary(summary_markdown="", key_points=[], tickers=[], sentiment=None)

    def summarize_daily_overall(
        self,
        *,
        market_date: date,
        video_items: List[Dict[str, Any]],
        max_chars: int = 22000,
    ) -> DailyOverallSummary:
        """Create an overall per-day summary from multiple per-video summaries."""

        try:
            items_json = self._json_dumps_with_char_limit(video_items, max_chars=max_chars)
            prompt = self._daily_prompt.format(
                market_date=market_date.isoformat(),
                items=items_json,
            )
            log_llm_prompt_stats(
                logger,
                model=self._model,
                label="summarize_daily_overall",
                prompt=prompt,
                extra={
                    "items_chars": len(items_json),
                    "items_count": len(video_items or []),
                },
            )
            msg = self._llm.invoke(
                prompt
            )
            parsed = self._safe_json(str(msg.content))
            if parsed:
                daily = DailyOverallSummary.model_validate(parsed)
                if not (daily.title or "").strip():
                    daily.title = f"Market Summary — {market_date.isoformat()}"
                return daily
        except Exception:
            logger.exception("Daily overall summarization failed")

        return DailyOverallSummary(
            title=f"Market Summary — {market_date.isoformat()}",
            overall_summarize="",
            summary_markdown="",
            movers=[],
            risks=[],
            opportunities=[],
        )

    @staticmethod
    def _json_dumps_with_char_limit(items: List[Any], *, max_chars: int) -> str:
        """Serialize to JSON while respecting a rough character budget.

        Important: This keeps the JSON structurally valid. We prefer limiting the number
        of items rather than truncating the serialized string mid-object.
        """

        if max_chars <= 0:
            return "[]"

        # Fast path: whole list fits.
        try:
            s = json.dumps(items or [], ensure_ascii=False)
            if len(s) <= max_chars:
                return s
        except Exception:
            # If serialization fails, degrade gracefully.
            return "[]"

        # Slow path: include as many items as fit.
        kept: List[Any] = []
        for it in items or []:
            candidate = kept + [it]
            try:
                s2 = json.dumps(candidate, ensure_ascii=False)
            except Exception:
                continue
            if len(s2) > max_chars:
                break
            kept.append(it)

        return json.dumps(kept, ensure_ascii=False)

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
            parsed = json.loads(candidate)
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None

    @staticmethod
    def _normalize_bullet(text: str) -> str:
        """Normalize a bullet/event description for loose de-duplication."""

        s = (text or "").strip().lower()
        if not s:
            return ""

        # Collapse whitespace and remove most punctuation so similar bullets match.
        s = re.sub(r"\s+", " ", s)
        s = re.sub(r"[^a-z0-9$%\s.\-/]", "", s)
        return s.strip()

    @classmethod
    def _dedupe_string_list(cls, items: List[str] | None, *, max_items: int | None = None) -> List[str]:
        seen: set[str] = set()
        out: List[str] = []
        for raw in items or []:
            s = str(raw).strip()
            if not s:
                continue
            key = cls._normalize_bullet(s)
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(s)
            if max_items is not None and len(out) >= max_items:
                break
        return out

    @classmethod
    def _postprocess_video_overall_summary(cls, video: VideoOverallSummary) -> None:
        """Ensure key_points do not duplicate other fields.

        This is a safety net in case the model repeats items across keys.
        """

        # Dedupe within each list first.
        video.risks = cls._dedupe_string_list(video.risks, max_items=10)
        video.opportunities = cls._dedupe_string_list(video.opportunities, max_items=10)

        # Dedupe movers by symbol (keep first), and normalize symbols.
        seen_symbols: set[str] = set()
        deduped_movers = []
        for mv in getattr(video, "movers", []) or []:
            sym = (getattr(mv, "symbol", "") or "").strip().upper()
            if not sym:
                continue
            if sym in seen_symbols:
                continue
            seen_symbols.add(sym)
            mv.symbol = sym
            deduped_movers.append(mv)
            if len(deduped_movers) >= 5:
                break
        video.movers = deduped_movers

        # Dedupe events by description.
        seen_event_desc: set[str] = set()
        deduped_events = []
        for ev in video.events or []:
            desc = (getattr(ev, "description", "") or "").strip()
            key = cls._normalize_bullet(desc)
            if not key or key in seen_event_desc:
                continue
            seen_event_desc.add(key)
            deduped_events.append(ev)
            if len(deduped_events) >= 10:
                break
        video.events = deduped_events

        # Ensure tickers contains mover/event tickers; keep MARKET only if it's the only ticker.
        tickers: list[str] = []
        for t in (video.tickers or []):
            s = str(t or "").strip().upper()
            if s and s not in tickers:
                tickers.append(s)

        for mv in video.movers or []:
            s = (getattr(mv, "symbol", "") or "").strip().upper()
            if s and s not in tickers:
                tickers.append(s)

        for ev in video.events or []:
            for t in getattr(ev, "tickers", []) or []:
                s = str(t or "").strip().upper()
                if s and s not in tickers:
                    tickers.append(s)

        non_market = [t for t in tickers if t != "MARKET"]
        video.tickers = non_market or (["MARKET"] if "MARKET" in tickers else [])

        # Remove key_points that repeat risks/opportunities/events.
        blocked: set[str] = set()
        blocked.update(cls._normalize_bullet(x) for x in (video.risks or []))
        blocked.update(cls._normalize_bullet(x) for x in (video.opportunities or []))
        blocked.update(cls._normalize_bullet(getattr(ev, "description", "") or "") for ev in (video.events or []))

        key_points = cls._dedupe_string_list(video.key_points, max_items=None)
        filtered = [kp for kp in key_points if cls._normalize_bullet(kp) not in blocked]
        video.key_points = filtered[:10]
