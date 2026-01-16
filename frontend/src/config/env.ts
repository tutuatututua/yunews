/**
 * Runtime configuration.
 *
 * Important: only `VITE_*` variables are exposed to the browser in Vite.
 * Keep this module free of side effects (no logging).
 */

const DEFAULT_BACKEND_BASE_URL_DEV = 'http://localhost:8080'
const DEFAULT_BACKEND_BASE_URL_PROD = '/api'

function normalizeBaseUrl(input: string): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null

  // Allow relative API prefixes like "/api" for same-origin deployments.
  // This is useful behind Nginx on EC2 to avoid CORS and port management.
  if (raw.startsWith('/')) {
    // Disallow protocol-relative URLs ("//example.com").
    if (raw.startsWith('//')) return null
    return raw.replace(/\/+$/, '')
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  // Browser fetch only supports a subset of schemes.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  // Avoid surprising credentials-in-URL patterns.
  if (url.username || url.password) return null

  // Normalize: no trailing slash.
  const normalized = url.toString().replace(/\/+$/, '')
  return normalized
}

/**
 * Returns the backend base URL (e.g. `https://api.example.com`).
 * Falls back to localhost for local development.
 */
export function getBackendBaseUrl(): string {
  const candidate = import.meta.env.VITE_BACKEND_BASE_URL
  const normalized = normalizeBaseUrl(candidate)
  if (normalized) return normalized

  // In local dev we generally run the API on localhost:8080.
  // In production (e.g. EC2 + Nginx) default to a same-origin "/api" proxy.
  return import.meta.env.DEV ? DEFAULT_BACKEND_BASE_URL_DEV : DEFAULT_BACKEND_BASE_URL_PROD
}
