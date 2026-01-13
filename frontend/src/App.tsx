import React from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import { queryClient } from './app/queryClient'
import HomePage from './pages/HomePage'
import InfographicPage from './pages/InfographicPage'
import VideoInsightsPage from './pages/VideoInsightsPage'

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/infographic" element={<InfographicPage />} />
            <Route path="/videos" element={<VideoInsightsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
