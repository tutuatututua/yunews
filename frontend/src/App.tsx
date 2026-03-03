import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import { queryClient } from './app/queryClient'
import { TimeZoneProvider } from './app/timeZone'
import HomePage from './pages/HomePage'
import ChatPage from './pages/ChatPage'
import RecommendationPage from './pages/RecommendationPage'
import TickerPage from './pages/TickerPage'
import VideoInsightsPage from './pages/VideoInsightsPage'
import { Analytics } from '@vercel/analytics/react'
import React from 'react'
import { getBackendBaseUrl } from './config/env'

function LegacyInfographicRedirect() {
  const location = useLocation()
  return <Navigate to={`/infographic${location.search || ''}`} replace />
}

function VisitTrackerOnce() {
  const location = useLocation()
  const sentRef = React.useRef(false)

  React.useEffect(() => {
    if (sentRef.current) return
    sentRef.current = true

    const base = (getBackendBaseUrl() || '').replace(/\/+$/, '')
    if (!base) return

    const referrer = (() => {
      try {
        return document.referrer || undefined
      } catch {
        return undefined
      }
    })()

    // Best-effort: ignore failures (adblock/network/etc).
    fetch(`${base}/track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ path: location.pathname || '/', search: location.search || '', referrer }),
      keepalive: true,
    }).catch(() => {})
  }, [location.pathname, location.search])

  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TimeZoneProvider>
        <BrowserRouter>
          <VisitTrackerOnce />
          <AppShell>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/infographic" element={<TickerPage />} />
              <Route path="/ticker" element={<LegacyInfographicRedirect />} />
              <Route path="/recomendation" element={<Navigate to="/recommendations" replace />} />
              <Route path="/recommendations" element={<RecommendationPage />} />
              <Route path="/videos" element={<VideoInsightsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
          <Analytics />
        </BrowserRouter>
      </TimeZoneProvider>
    </QueryClientProvider>
  )
}
