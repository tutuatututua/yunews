import { useQuery } from '@tanstack/react-query'

import type { EntityChunkRow } from '../../types'
import { fetchEntityChunks, fetchTopMovers } from './api'

export function useEntityChunks(
  symbol: string | null,
  opts?: { days?: number; limit?: number },
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ['entityChunks', symbol ?? null, opts?.days ?? null, opts?.limit ?? null],
    queryFn: () => (symbol ? fetchEntityChunks(symbol, opts) : Promise.resolve([] as EntityChunkRow[])),
    enabled: !!symbol && enabled,
  })
}

export function useTopMovers(anchorDate: string | undefined, days: number, limit: number = 8, enabled: boolean = true) {
  return useQuery({
    queryKey: ['topMovers', anchorDate ?? null, days, limit],
    queryFn: () => fetchTopMovers({ date: anchorDate, days, limit }),
    enabled,
  })
}
