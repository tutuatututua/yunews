import React from 'react'
import { Clock, Globe2, Search, X } from 'lucide-react'
import { ET_OFFSET_MODE, resolveTimeShiftMinutes, resolveTimeZoneForIntl, timeZoneLabel, useTimeZone } from '../../app/timeZone'
import { cn } from '../../lib/cn'
import styles from './TimeZoneMenu.module.css'

function getDetectedIanaTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz ? String(tz) : null
  } catch {
    return null
  }
}

function supportedTimeZones(): string[] {
  try {
    const maybe = (Intl as any).supportedValuesOf?.('timeZone')
    if (Array.isArray(maybe) && maybe.every((v) => typeof v === 'string')) return maybe
  } catch {
    // ignore
  }

  // Small, high-signal fallback list for browsers without `Intl.supportedValuesOf`.
  return [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Phoenix',
    'America/Toronto',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Paris',
    'Europe/Warsaw',
    'Africa/Johannesburg',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
  ]
}

function formatOffsetLabel(minutes: number): string {
  const m = Math.trunc(Number(minutes) || 0)
  if (!m) return '0m'
  const sign = m > 0 ? '+' : '-'
  const abs = Math.abs(m)
  const hours = Math.floor(abs / 60)
  const mins = abs % 60
  if (!hours) return `${sign}${mins}m`
  if (!mins) return `${sign}${hours}h`
  return `${sign}${hours}h ${mins}m`
}

export function TimeZoneMenu(props: { className?: string }) {
  const { timeZone, timeShiftMinutes, setTimeZone, setTimeShiftMinutes } = useTimeZone()

  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')

  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const detected = React.useMemo(() => getDetectedIanaTimeZone(), [])
  const tzList = React.useMemo(() => supportedTimeZones(), [])

  const effectiveShift = resolveTimeShiftMinutes(timeZone, timeShiftMinutes)
  const intlTimeZone = resolveTimeZoneForIntl(timeZone)

  const preview = React.useMemo(() => {
    try {
      const base = Date.now() + effectiveShift * 60_000
      return new Date(base).toLocaleString(undefined, {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: intlTimeZone || undefined,
      })
    } catch {
      return ''
    }
  }, [effectiveShift, intlTimeZone])

  const currentLabel = timeZoneLabel(timeZone, { timeShiftMinutes })

  React.useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }

    const onPointerDown = (e: MouseEvent | PointerEvent) => {
      const el = rootRef.current
      if (!el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      setOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return [] as string[]

    const direct = tzList.filter((z) => z.toLowerCase() === q)
    const prefix = tzList.filter((z) => z.toLowerCase().startsWith(q) && z.toLowerCase() !== q)
    const contains = tzList.filter((z) => !z.toLowerCase().startsWith(q) && z.toLowerCase().includes(q))

    return [...direct, ...prefix, ...contains].slice(0, 50)
  }, [query, tzList])

  const setQuick = (next: 'local' | 'UTC' | 'ET' | 'ET_OFFSET') => {
    if (next === 'local') {
      setTimeZone('local')
      return
    }
    if (next === 'UTC') {
      setTimeZone('UTC')
      return
    }
    if (next === 'ET') {
      setTimeZone('America/New_York')
      return
    }
    setTimeZone(ET_OFFSET_MODE)
  }

  return (
    <div className={cn(styles.root, props.className)} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={`Time zone: ${currentLabel}`}
      >
        <Globe2 size={16} />
        <span className={styles.triggerLabel}>{currentLabel}</span>
      </button>

      {open && (
        <div className={styles.popover} role="dialog" aria-label="Time zone settings">
          <div className={styles.headerRow}>
            <div className={styles.title}>
              <Clock size={16} />
              <span>Time zone</span>
            </div>
            <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close">
              <X size={16} />
            </button>
          </div>

          <div className={styles.previewRow}>
            <div className={styles.previewLeft}>
              <div className={styles.previewLabel}>Now</div>
              <div className={styles.previewValue}>{preview || '—'}</div>
            </div>
            {detected ? (
              <div className={styles.previewRight} title={`Detected from your device: ${detected}`}>
                Detected: <span className={styles.mono}>{detected}</span>
              </div>
            ) : null}
          </div>

          <div className={styles.quickGrid} aria-label="Quick time zones">
            <button
              type="button"
              className={cn(styles.quick, timeZone === 'local' && styles.quickActive)}
              onClick={() => setQuick('local')}
            >
              Local
            </button>
            <button
              type="button"
              className={cn(styles.quick, timeZone === 'UTC' && styles.quickActive)}
              onClick={() => setQuick('UTC')}
            >
              UTC
            </button>
            <button
              type="button"
              className={cn(styles.quick, timeZone === 'America/New_York' && styles.quickActive)}
              onClick={() => setQuick('ET')}
              title="Eastern Time (America/New_York)"
            >
              ET
            </button>
            <button
              type="button"
              className={cn(styles.quick, timeZone === ET_OFFSET_MODE && styles.quickActive)}
              onClick={() => setQuick('ET_OFFSET')}
              title="Eastern Time with manual offset"
            >
              ET + offset
            </button>
          </div>

          {timeZone === ET_OFFSET_MODE ? (
            <div className={styles.offsetCard} aria-label="ET offset">
              <div className={styles.offsetTop}>
                <div>
                  <div className={styles.offsetTitle}>Offset from ET</div>
                  <div className={styles.offsetHint}>Useful when you want “market day” in ET but display times shifted.</div>
                </div>
                <div className={styles.offsetValue}>{formatOffsetLabel(effectiveShift)}</div>
              </div>

              <input
                className={styles.range}
                type="range"
                min={-360}
                max={360}
                step={15}
                value={effectiveShift}
                onChange={(e) => setTimeShiftMinutes(Number(e.target.value))}
                aria-label="ET offset minutes"
              />

              <div className={styles.offsetActions}>
                <button type="button" className={styles.smallButton} onClick={() => setTimeShiftMinutes(effectiveShift - 15)}>
                  -15m
                </button>
                <button type="button" className={styles.smallButton} onClick={() => setTimeShiftMinutes(0)}>
                  Reset
                </button>
                <button type="button" className={styles.smallButton} onClick={() => setTimeShiftMinutes(effectiveShift + 15)}>
                  +15m
                </button>
              </div>
            </div>
          ) : null}

          <div className={styles.searchRow}>
            <Search size={16} className={styles.searchIcon} />
            <input
              ref={inputRef}
              className={styles.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search time zones (e.g. New_York, London, Tokyo, GMT)…"
              aria-label="Search time zones"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {!query.trim() ? (
            <div className={styles.searchHint}>
              Type to search all supported IANA zones. Pick one to override Local/UTC.
            </div>
          ) : results.length ? (
            <div className={styles.results} role="listbox" aria-label="Time zone results">
              {results.map((z) => (
                <button
                  key={z}
                  type="button"
                  className={cn(styles.result, timeZone === z && styles.resultActive)}
                  onClick={() => {
                    setTimeZone(z)
                    setQuery('')
                    setOpen(false)
                  }}
                >
                  <span className={styles.mono}>{z}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.searchHint}>No matches. Try an IANA name like “America/Los_Angeles”.</div>
          )}

          <div className={styles.footer}>
            <button
              type="button"
              className={styles.footerButton}
              onClick={() => {
                setTimeZone('local')
                setTimeShiftMinutes(0)
                setQuery('')
              }}
            >
              Reset to Local
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
