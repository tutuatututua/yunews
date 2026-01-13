/**
 * Formatting helpers live here to keep UI components pure.
 * This file should stay dependency-free and easy to test.
 */

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function formatCompactNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  try {
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
  } catch {
    return String(n)
  }
}

export function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)))
}

export function parseDays(raw: string | null, fallback: number): number {
  const n = raw ? Number(raw) : NaN
  if (!Number.isFinite(n)) return fallback
  return clampInt(n, 1, 365)
}
