import type { DailySummary } from '../../types'
import { apiGet } from '../../api/client'

export async function fetchLatestDailySummary(): Promise<DailySummary | null> {
  const r = await apiGet<{ data: DailySummary | null }>(`/daily-summaries/latest`)
  return r.data
}

export async function fetchDailySummary(marketDate: string): Promise<DailySummary | null> {
  const safe = encodeURIComponent(marketDate)
  const r = await apiGet<{ data: DailySummary | null }>(`/daily-summaries/${safe}`)
  return r.data
}

export async function fetchDailySummaries(limit: number = 120): Promise<DailySummary[]> {
  const qs = new URLSearchParams()
  qs.set('limit', String(limit))
  const r = await apiGet<{ data: DailySummary[] }>(`/daily-summaries?${qs.toString()}`)
  return r.data
}
