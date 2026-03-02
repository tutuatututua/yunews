import { useQuery } from '@tanstack/react-query'

import { fetchDailySummaries, fetchDailySummary, fetchLatestDailySummary } from './api'

export function useLatestDailySummary() {
  return useQuery({
    queryKey: ['daily', 'latest'],
    queryFn: fetchLatestDailySummary,
  })
}

export function useDailySummary(marketDate?: string | null) {
  const key = marketDate ? marketDate : 'latest'
  return useQuery({
    queryKey: ['daily', key],
    queryFn: () => (marketDate ? fetchDailySummary(marketDate) : fetchLatestDailySummary()),
    refetchOnWindowFocus: !marketDate,
    refetchOnMount: marketDate ? false : 'always',
  })
}

export function useDailySummariesList(limit: number = 120) {
  return useQuery({
    queryKey: ['daily', 'list', limit],
    queryFn: () => fetchDailySummaries(limit),
  })
}
