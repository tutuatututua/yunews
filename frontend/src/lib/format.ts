/**
 * Formatting helpers live here to keep UI components pure.
 * This file should stay dependency-free and easy to test.
 */

export function formatDateTime(iso: string, opts?: { timeZone?: string | null; shiftMinutes?: number | null }): string {
  try {
    if (!iso) return '—'
    const timeZone = opts?.timeZone ?? undefined
    const shiftMinutes = opts?.shiftMinutes ?? 0
    const baseMs = Date.parse(iso)
    const d = Number.isFinite(baseMs) ? new Date(baseMs + (Number(shiftMinutes) || 0) * 60_000) : new Date(iso)
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timeZone || undefined,
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
