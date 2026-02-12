import { QueryClient } from '@tanstack/react-query'
import { persistQueryClient } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'

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
      // Keep cached query data around longer to avoid re-fetching during navigation.
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
})

// Persist the query cache so a full page refresh doesn't immediately re-fetch the same data.
// Safe default: short maxAge to prevent stale data lingering too long.
if (typeof window !== 'undefined') {
  const persister = createSyncStoragePersister({
    storage: window.localStorage,
    key: 'yunews-react-query',
  })

  persistQueryClient({
    queryClient,
    persister,
    maxAge: 10 * 60_000,
    buster: 'v1',
  })
}
