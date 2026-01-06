import React, { useEffect, useMemo, useState } from 'react'
import { fetchLatestDailySummary, fetchVideoDetail, fetchVideos } from './api'
import type { DailySummary, VideoDetail, VideoListItem } from './types'

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default function App() {
  const [daily, setDaily] = useState<DailySummary | null>(null)
  const [videos, setVideos] = useState<VideoListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<VideoDetail | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const selectedVideo = useMemo(
    () => videos.find((v: VideoListItem) => v.id === selectedId) || null,
    [videos, selectedId],
  )

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const d = await fetchLatestDailySummary()
        if (!alive) return
        setDaily(d)
        const v = await fetchVideos(d?.market_date)
        if (!alive) return
        setVideos(v)
      } catch (e: any) {
        if (!alive) return
        setError(e?.message || 'Failed to load')
      } finally {
        if (!alive) return
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setDetail(null)
        if (!selectedId) return
        const d = await fetchVideoDetail(selectedId)
        if (!alive) return
        setDetail(d)
      } catch (e: any) {
        if (!alive) return
        setError(e?.message || 'Failed to load video')
      }
    })()
    return () => {
      alive = false
    }
  }, [selectedId])

  return (
    <div className="container">
      <div className="header">
        <h1>yuNews</h1>
        <div className="muted small">Backend: {import.meta.env.VITE_BACKEND_BASE_URL || 'http://localhost:8080'}</div>
      </div>

      {loading && <div className="muted">Loading…</div>}
      {error && <div className="card">Error: {error}</div>}

      <div className="grid">
        <div className="card">
          <h2>Daily Market Summary</h2>
          {!daily && <div className="muted">No daily summary found.</div>}
          {daily && (
            <>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{daily.title}</div>
              <div className="muted small" style={{ marginBottom: 10 }}>
                {daily.market_date} • Generated {formatDateTime(daily.generated_at)} • Model {daily.model}
              </div>
              <pre>{daily.summary_markdown}</pre>

              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Movers</div>
                {daily.movers?.length ? (
                  daily.movers.map((m: DailySummary['movers'][number], idx: number) => (
                    <div key={idx} className="small" style={{ marginBottom: 6 }}>
                      <b>{m.symbol}</b> ({m.direction}): {m.reason}
                    </div>
                  ))
                ) : (
                  <div className="muted small">None</div>
                )}
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Risks</div>
                {daily.risks?.length ? (
                  daily.risks.map((r: string, idx: number) => (
                    <div key={idx} className="small" style={{ marginBottom: 6 }}>
                      - {r}
                    </div>
                  ))
                ) : (
                  <div className="muted small">None</div>
                )}
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Opportunities</div>
                {daily.opportunities?.length ? (
                  daily.opportunities.map((o: string, idx: number) => (
                    <div key={idx} className="small" style={{ marginBottom: 6 }}>
                      - {o}
                    </div>
                  ))
                ) : (
                  <div className="muted small">None</div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2>Videos</h2>
          {!videos.length && <div className="muted">No videos found for this day.</div>}

          {videos.map((v: VideoListItem) => (
            <div className="videoRow" key={v.id}>
              {v.thumbnail_url ? (
                <img className="thumb" src={v.thumbnail_url} alt="thumbnail" />
              ) : (
                <div className="thumb" />
              )}
              <div className="videoMeta">
                <a className="videoTitle" href={v.video_url} target="_blank" rel="noreferrer">
                  {v.title}
                </a>
                <div className="muted small">
                  {v.channel_title || 'Unknown channel'} • {formatDateTime(v.published_at)}
                </div>
                <div className="muted small">
                  Views: {v.view_count ?? '—'} • Likes: {v.like_count ?? '—'} • Comments: {v.comment_count ?? '—'}
                </div>
                <div>
                  <button className="button" onClick={() => setSelectedId(v.id)} disabled={selectedId === v.id}>
                    {selectedId === v.id ? 'Selected' : 'View summary'}
                  </button>
                </div>
              </div>
            </div>
          ))}

          {selectedVideo && (
            <div style={{ marginTop: 14 }}>
              <h2>Selected Video</h2>
              <div className="muted small" style={{ marginBottom: 8 }}>
                {selectedVideo.title}
              </div>

              {!detail && <div className="muted">Loading detail…</div>}
              {detail && (
                <>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Video Summary</div>
                  {detail.summary ? (
                    <>
                      <div className="muted small" style={{ marginBottom: 8 }}>
                        Model {detail.summary.model} • {formatDateTime(detail.summary.summarized_at)}
                      </div>
                      <pre>{detail.summary.summary_markdown}</pre>
                      <div style={{ marginTop: 10 }} className="small">
                        <b>Tickers:</b> {detail.summary.tickers?.length ? detail.summary.tickers.join(', ') : '—'}
                      </div>
                      <div style={{ marginTop: 6 }} className="small">
                        <b>Sentiment:</b> {detail.summary.sentiment || '—'}
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontWeight: 700, marginBottom: 6 }}>Key Points</div>
                        {detail.summary.key_points?.length ? (
                          detail.summary.key_points.map((kp: string, idx: number) => (
                            <div key={idx} className="small" style={{ marginBottom: 6 }}>
                              - {kp}
                            </div>
                          ))
                        ) : (
                          <div className="muted small">None</div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="muted">No summary stored for this video.</div>
                  )}

                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>Transcript (preview)</div>
                    {detail.transcript ? (
                      <pre>{detail.transcript.transcript_text.slice(0, 2500)}{detail.transcript.transcript_text.length > 2500 ? '…' : ''}</pre>
                    ) : (
                      <div className="muted">No transcript stored for this video.</div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
