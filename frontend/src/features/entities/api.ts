import type { EntityChunkRow, TopMover } from '../../types'
import { apiGet } from '../../api/client'

export async function fetchEntityChunks(
  symbol: string,
  opts?: { days?: number; limit?: number },
): Promise<EntityChunkRow[]> {
  const qs = new URLSearchParams()
  if (opts?.days != null) qs.set('days', String(opts.days))
  if (opts?.limit != null) qs.set('limit', String(opts.limit))

  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const r = await apiGet<{ data: EntityChunkRow[] }>(
    `/entities/${encodeURIComponent(symbol)}/chunks${suffix}`,
  )
  return r.data
}

export async function fetchTopMovers(opts?: {
  days?: number
  limit?: number
  date?: string
}): Promise<TopMover[]> {
  const qs = new URLSearchParams()
  if (opts?.date) qs.set('date', opts.date)
  if (opts?.days != null) qs.set('days', String(opts.days))
  if (opts?.limit != null) qs.set('limit', String(opts.limit))

  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const r = await apiGet<{ data: TopMover[] }>(`/entities/top-movers${suffix}`)
  return r.data
}
