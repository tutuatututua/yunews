import React from 'react'

const STORAGE_KEY = 'yunews.timeZone'
const SHIFT_MINUTES_KEY = 'yunews.timeShiftMinutes'

export const ET_OFFSET_MODE = 'et-offset'

export type TimeZoneSetting = 'local' | 'UTC' | typeof ET_OFFSET_MODE | string

export type TimeZoneState = {
  timeZone: TimeZoneSetting
  /**
   * Only applied when timeZone === 'et-offset'.
   * Positive values push time forward.
   */
  timeShiftMinutes: number
  setTimeZone: (tz: TimeZoneSetting) => void
  setTimeShiftMinutes: (minutes: number) => void
}

const TimeZoneContext = React.createContext<TimeZoneState | null>(null)

function isValidIanaTimeZone(tz: string): boolean {
  const raw = String(tz || '').trim()
  if (!raw) return false
  try {
    // Throws RangeError for invalid time zones.
    Intl.DateTimeFormat(undefined, { timeZone: raw }).format(0)
    return true
  } catch {
    return false
  }
}

function normalizeTimeZoneSetting(input: unknown): TimeZoneSetting {
  const raw = String(input ?? '').trim()
  if (!raw) return 'local'
  if (raw === 'local' || raw === 'UTC' || raw === ET_OFFSET_MODE) return raw
  return isValidIanaTimeZone(raw) ? raw : 'local'
}

function readInitialTimeZone(): TimeZoneSetting {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return normalizeTimeZoneSetting(raw)
  } catch {
    // ignore
  }
  return 'local'
}

function readInitialTimeShiftMinutes(): number {
  try {
    const raw = localStorage.getItem(SHIFT_MINUTES_KEY)
    const parsed = raw ? Number(raw) : NaN
    if (Number.isFinite(parsed)) return Math.max(-24 * 60, Math.min(24 * 60, Math.trunc(parsed)))
  } catch {
    // ignore
  }
  return 0
}

export function TimeZoneProvider(props: { children: React.ReactNode }) {
  const [timeZone, setTimeZoneState] = React.useState<TimeZoneSetting>(() => readInitialTimeZone())
  const [timeShiftMinutes, setTimeShiftMinutesState] = React.useState<number>(() => readInitialTimeShiftMinutes())

  const setTimeZone = React.useCallback((tz: TimeZoneSetting) => {
    const next = normalizeTimeZoneSetting(tz)
    setTimeZoneState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }, [])

  const setTimeShiftMinutes = React.useCallback((minutes: number) => {
    const clamped = Math.max(-24 * 60, Math.min(24 * 60, Math.trunc(minutes)))
    setTimeShiftMinutesState(clamped)
    try {
      localStorage.setItem(SHIFT_MINUTES_KEY, String(clamped))
    } catch {
      // ignore
    }
  }, [])

  const value = React.useMemo<TimeZoneState>(
    () => ({ timeZone, timeShiftMinutes, setTimeZone, setTimeShiftMinutes }),
    [timeZone, timeShiftMinutes, setTimeZone, setTimeShiftMinutes],
  )

  return <TimeZoneContext.Provider value={value}>{props.children}</TimeZoneContext.Provider>
}

export function useTimeZone(): TimeZoneState {
  const ctx = React.useContext(TimeZoneContext)
  if (!ctx) throw new Error('useTimeZone must be used within TimeZoneProvider')
  return ctx
}

export function resolveTimeZoneForIntl(setting: TimeZoneSetting): string | undefined {
  if (setting === 'local') return undefined
  if (setting === ET_OFFSET_MODE) return 'America/New_York'
  return setting
}

/**
 * Returns the effective shift minutes for the given setting.
 * Currently only applies to ET_OFFSET_MODE.
 */
export function resolveTimeShiftMinutes(setting: TimeZoneSetting, timeShiftMinutes: number): number {
  if (setting !== ET_OFFSET_MODE) return 0
  if (!Number.isFinite(timeShiftMinutes)) return 0
  return Math.max(-24 * 60, Math.min(24 * 60, Math.trunc(timeShiftMinutes)))
}

export function timeZoneLabel(setting: TimeZoneSetting, opts?: { timeShiftMinutes?: number }): string {
  if (setting === 'local') return 'Local'
  if (setting === 'UTC') return 'UTC'
  if (setting === ET_OFFSET_MODE) {
    const minutes = resolveTimeShiftMinutes(setting, opts?.timeShiftMinutes ?? 0)
    if (!minutes) return 'ET'
    const sign = minutes > 0 ? '+' : '-'
    const abs = Math.abs(minutes)
    const hours = Math.floor(abs / 60)
    const mins = abs % 60
    return mins ? `ET ${sign}${hours}h ${mins}m` : `ET ${sign}${hours}h`
  }
  return setting
}
