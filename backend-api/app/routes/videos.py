from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Query
from supabase import create_client

from app.settings import settings

router = APIRouter(prefix="/videos", tags=["videos"])


def _client():
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


@router.get("")
def list_videos(
    date_: date | None = Query(default=None, alias="date"),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict:
    try:
        q = (
            _client()
            .table("videos")
            .select(
                "id,video_id,title,channel_title,published_at,video_url,thumbnail_url,view_count,like_count,comment_count,duration_seconds"
            )
            .order("published_at", desc=True)
            .limit(limit)
        )
        if date_ is not None:
            start = date_.isoformat() + "T00:00:00+00:00"
            end = date_.isoformat() + "T23:59:59+00:00"
            q = q.gte("published_at", start).lte("published_at", end)

        resp = q.execute()
        return {"data": resp.data}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{video_id}")
def get_video(video_id: str) -> dict:
    try:
        supa = _client()
        v_resp = supa.table("videos").select("*").eq("id", video_id).limit(1).execute()
        video = v_resp.data[0] if v_resp.data else None
        if not video:
            return {"data": None}

        tr_resp = supa.table("transcripts").select("id,transcript_text,transcript_language").eq("video_id", video_id).limit(1).execute()
        transcript = tr_resp.data[0] if tr_resp.data else None

        vs_resp = supa.table("video_summaries").select("id,summary_markdown,key_points,tickers,sentiment,model,summarized_at").eq("video_id", video_id).limit(1).execute()
        summary = vs_resp.data[0] if vs_resp.data else None

        return {"data": {"video": video, "transcript": transcript, "summary": summary}}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
