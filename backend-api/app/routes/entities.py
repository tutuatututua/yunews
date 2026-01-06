from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Query
from supabase import create_client

from app.settings import settings

router = APIRouter(prefix="/entities", tags=["entities"])


def _client():
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


@router.get("/{symbol}/chunks")
def chunks_for_entity(
    symbol: str,
    date_: date | None = Query(default=None, alias="date"),
    limit: int = Query(default=100, ge=1, le=500),
    include_anomalous: bool = Query(default=True),
    anomaly_threshold: float = Query(default=0.7, ge=0.0, le=1.0),
) -> dict:
    """Returns claim-level chunks mentioning a ticker symbol.

    This filters `chunk_features.entities` (JSONB) using a conservative `contains` match.
    """
    sym = (symbol or "").strip().upper()
    if not sym:
        raise HTTPException(status_code=400, detail="symbol is required")

    try:
        q = (
            _client()
            .table("chunk_features")
            .select(
                "chunk_id,entities,sentiment_label,sentiment_score,fact_score,opinion_score,speculation_score,computed_at,"
                "chunks!inner(market_date,channel_title,start_seconds,end_seconds,claim,topic,stance,"
                "videos(video_url,video_id,channel_title,title)),"
                "chunk_anomalies(final_anomaly_score,flags,explanation,computed_at)"
            )
            .contains("entities", [{"type": "ticker", "symbol": sym}])
            .order("computed_at", desc=True)
            .limit(limit)
        )

        if date_ is not None:
            q = q.eq("chunks.market_date", date_.isoformat())

        if not include_anomalous:
            q = q.lt("chunk_anomalies.final_anomaly_score", anomaly_threshold)

        resp = q.execute()
        return {"data": resp.data}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
