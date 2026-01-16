import React from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import { queryClient } from './app/queryClient'
import { TimeZoneProvider } from './app/timeZone'
import HomePage from './pages/HomePage'
import TickerPage from './pages/TickerPage'
import VideoInsightsPage from './pages/VideoInsightsPage'

function LegacyInfographicRedirect() {
  const location = useLocation()
  return <Navigate to={`/ticker${location.search || ''}`} replace />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TimeZoneProvider>
        <BrowserRouter>
          <AppShell>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/infographic" element={<LegacyInfographicRedirect />} />
              <Route path="/ticker" element={<TickerPage />} />
              <Route path="/videos" element={<VideoInsightsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
      </TimeZoneProvider>
    </QueryClientProvider>
  )
}
