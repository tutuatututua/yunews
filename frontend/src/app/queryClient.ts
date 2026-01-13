import { QueryClient } from '@tanstack/react-query'

/**
 * Central react-query configuration.
 * - Conservative retries (fintech UX: fail fast, show clear errors)
 * - Short stale time to keep UI fresh without over-fetching
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})
