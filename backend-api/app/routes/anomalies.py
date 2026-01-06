from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Query
from supabase import create_client

from app.settings import settings

router = APIRouter(tags=["anomalies"])


def _client():
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


@router.get("/daily-summaries/{market_date}/anomalies")
def daily_anomalies(
    market_date: date,
    limit: int = Query(default=30, ge=1, le=200),
    threshold: float = Query(default=0.7, ge=0.0, le=1.0),
) -> dict:
    """Returns anomalous chunks for the given day.

    Data comes from claim-level tables:
    - chunks
    - chunk_anomalies
    - chunk_features
    - videos
    """
    try:
        # Query chunks and embed related rows via FK relationships.
        # PostgREST will expose relationships because chunk_* tables reference chunks(id).
        resp = (
            _client()
            .table("chunks")
            .select(
                "id,market_date,channel_title,start_seconds,end_seconds,claim,topic,stance,"
                "videos(video_url,video_id,channel_title,title),"
                "chunk_anomalies(final_anomaly_score,embedding_outlier_score,sentiment_deviation_score,llm_speculation_score,flags,explanation,computed_at),"
                "chunk_features(entities,sentiment_label,sentiment_score,fact_score,opinion_score,speculation_score)"
            )
            .eq("market_date", market_date.isoformat())
            .gte("chunk_anomalies.final_anomaly_score", threshold)
            .order("final_anomaly_score", desc=True, foreign_table="chunk_anomalies")
            .limit(limit)
            .execute()
        )
        return {"data": resp.data}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
