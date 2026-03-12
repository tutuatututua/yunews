import type { RecommendationOverlay } from '../../../types'
import RecommendationOverlayChart from '../RecommendationOverlayChart'
import { EmptyState, ErrorCallout } from '../../ui/Callout'
import { LoadingLine } from '../../ui/Loading'
import { cn } from '../../../lib/cn'
import { ui, util } from '../../../styles'
import styles from './RecommendationDashboard.module.css'

export type DashboardRecommendationGroup = {
  symbol: string
  count: number
  latestPublishedAtLabel: string | null
  latestTitle: string | null
  reasonTags: string[]
  avgNowPct: number | null
  avg7dPct: number | null
  avg30dPct: number | null
}

export type DashboardTickerItem = {
  symbol: string
  count: number
  isRecent: boolean
}

export type DashboardEventRow = {
  id: string
  title: string
  subtitle: string | null
  url: string | null
  thumbUrl: string | null
  nowPct: number | null
  day7Pct: number | null
  day30Pct: number | null
  keyPoints: string[]
}

type RecommendationDashboardProps = {
  errorMessage: string | null
  errorRequestId?: string | null
  recentLoading: boolean
  tickersLoading: boolean
  recentGroups: DashboardRecommendationGroup[]
  totalTickerCount: number
  totalRecentMentions: number
  selectedSymbol: string | null
  selectedRecentCount: number | null
  selectedLatestPublished: string | null
  tickerSearch: string
  onTickerSearchChange: (value: string) => void
  featuredTickers: DashboardTickerItem[]
  historyTickers: DashboardTickerItem[]
  hasTickerQuery: boolean
  windowKey: '1y' | '6m' | '3m' | '1m'
  onWindowChange: (value: '1y' | '6m' | '3m' | '1m') => void
  onSelectSymbol: (symbol: string) => void
  overlayLoading: boolean
  overlay: RecommendationOverlay | null
  avgNowPct: number | null
  avg7dPct: number | null
  avg30dPct: number | null
  eventRows: DashboardEventRow[]
}

const WINDOW_OPTIONS = [
  ['1y', '1 year'],
  ['6m', '6 months'],
  ['3m', '3 months'],
  ['1m', '1 month'],
] as const

function formatCountLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-'
  const pct = value * 100
  const digits = Math.abs(pct) < 1 ? 1 : 0
  const text = pct.toFixed(digits)
  return `${pct > 0 ? '+' : ''}${text}%`
}

function PerformancePill(props: { label: string; value: number | null | undefined }) {
  const { label, value } = props
  const isPositive = value != null && value > 0
  const isNegative = value != null && value < 0

  return (
    <span
      className={cn(
        styles.performancePill,
        isPositive && styles.performancePillPositive,
        isNegative && styles.performancePillNegative,
      )}
    >
      <span className={styles.performanceLabel}>{label}</span>
      <span>{formatPct(value)}</span>
    </span>
  )
}

function RecentRecommendationCard(props: {
  group: DashboardRecommendationGroup
  active: boolean
  onSelect: () => void
}) {
  const { group, active, onSelect } = props
  const reasons = group.reasonTags.slice(0, 2)

  return (
    <button
      type="button"
      className={cn(styles.recentCard, active && styles.recentCardActive)}
      aria-current={active ? 'true' : undefined}
      onClick={onSelect}
    >
      <div className={styles.recentCardTop}>
        <div className={styles.recommendationTicker}>{group.symbol}</div>
        <div className={styles.recentMentionCount}>{formatCountLabel(group.count, 'mention', 'mentions')}</div>
      </div>

      <div className={styles.recentKeywordRail} aria-label="Positive keywords">
        {reasons.length > 0 ? (
          reasons.map((reason) => (
            <span key={reason} className={styles.reasonTag}>
              {reason}
            </span>
          ))
        ) : (
          <span className={styles.reasonFallback}>No positive keywords</span>
        )}
      </div>
    </button>
  )
}

function TickerExplorerGroup(props: {
  title: string
  description: string
  items: DashboardTickerItem[]
  selectedSymbol: string | null
  onSelectSymbol: (symbol: string) => void
}) {
  const { title, description, items, selectedSymbol, onSelectSymbol } = props

  if (items.length === 0) return null

  return (
    <section className={styles.tickerGroup} aria-label={title}>

      <div className={styles.tickerList} role="list">
        {items.map((item) => {
          const active = selectedSymbol === item.symbol
          return (
            <button
              key={item.symbol}
              type="button"
              className={cn(styles.tickerOption, active && styles.tickerOptionActive)}
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelectSymbol(item.symbol)}
            >
              <div className={styles.tickerOptionSymbol}>{item.symbol}</div>
              <span className={styles.tickerOptionCount}>{item.count}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export default function RecommendationDashboard(props: RecommendationDashboardProps) {
  const {
    errorMessage,
    errorRequestId,
    recentLoading,
    tickersLoading,
    recentGroups,
    totalTickerCount,
    totalRecentMentions,
    selectedSymbol,
    selectedRecentCount,
    selectedLatestPublished,
    tickerSearch,
    onTickerSearchChange,
    featuredTickers,
    historyTickers,
    hasTickerQuery,
    windowKey,
    onWindowChange,
    onSelectSymbol,
    overlayLoading,
    overlay,
    avgNowPct,
    avg7dPct,
    avg30dPct,
    eventRows,
  } = props

  const allTickers = [...featuredTickers, ...historyTickers]
  const hasTickers = totalTickerCount > 0
  const selectedGroup = recentGroups.find((group) => group.symbol === selectedSymbol) || null
  const visibleTickerCount = allTickers.length
  const filterEmptyCopy = hasTickerQuery
    ? `No tickers match "${tickerSearch}".`
    : 'No tickers available.'

  return (
    <div className={styles.page}>
      {errorMessage && <ErrorCallout message={errorMessage} requestId={errorRequestId || undefined} />}

      {!tickersLoading && !hasTickers && (
        <EmptyState
          title="No recommendation events yet"
          body="Run the pipeline or wait for new videos to be ingested before recommendations can populate."
        />
      )}

      {(tickersLoading || hasTickers) && (
        <>
          <section className={cn(ui.card, styles.recentRailCard)} aria-label="Recent recommendations">
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionEyebrow}>Last 3 days</div>
                <h3 className={styles.sectionTitle}>Recent recommendations</h3>
              </div>
              <div className={styles.sectionMeta}>
                <span className={styles.metaChip}>{formatCountLabel(recentGroups.length, 'ticker', 'tickers')}</span>
                <span className={styles.metaChip}>{formatCountLabel(totalRecentMentions, 'mention', 'mentions')}</span>
              </div>
            </div>

            {recentLoading ? (
              <LoadingLine label="Loading recent recommendations..." />
            ) : recentGroups.length === 0 ? (
              <div className={cn(util.muted, util.small, styles.emptyCopy)}>
                No stocks were detected as recommendation-style picks in the last 3 days.
              </div>
            ) : (
              <div className={styles.recentRail} role="list" aria-label="Recent recommendation tickers">
                {recentGroups.map((group) => (
                  <RecentRecommendationCard
                    key={group.symbol}
                    group={group}
                    active={selectedSymbol === group.symbol}
                    onSelect={() => onSelectSymbol(group.symbol)}
                  />
                ))}
              </div>
            )}
          </section>

          <div className={styles.dashboardLayout}>
            <aside className={styles.sidebar}>
              <section className={cn(ui.card, styles.sidebarCard)} aria-label="Ticker explorer">
                <div className={styles.controlStack}>
                  <label className={styles.field} htmlFor="ticker-search">
                    <span className={styles.fieldLabel}>Search tickers</span>
                    <input
                      id="ticker-search"
                      className={styles.input}
                      value={tickerSearch}
                      onChange={(event) => onTickerSearchChange(event.target.value)}
                      placeholder="AAPL, NVDA, TSLA..."
                      inputMode="search"
                      autoComplete="off"
                    />
                  </label>

                  <div className={styles.sectionMeta}>
                    <span className={styles.metaChip}>{formatCountLabel(visibleTickerCount, 'ticker', 'tickers')}</span>
                  </div>
                </div>

                {tickersLoading ? (
                  <LoadingLine label="Loading recommendation universe..." />
                ) : visibleTickerCount === 0 ? (
                  <div className={cn(util.muted, util.small, styles.emptyCopy)} role="status">
                    {filterEmptyCopy}
                  </div>
                ) : (
                  <div className={styles.tickerExplorerBody}>
                    <TickerExplorerGroup
                      title="Archive coverage"
                      description="Older picks still available in the one-year history."
                      items={historyTickers}
                      selectedSymbol={selectedSymbol}
                      onSelectSymbol={onSelectSymbol}
                    />
                  </div>
                )}
              </section>
            </aside>

            <div className={styles.mainColumn}>
              <section className={cn(ui.card, styles.deepDiveCard)} aria-label="Recommendation deep dive">
                <div className={styles.deepDiveHeader}>
                  <div className={styles.windowRail} role="list" aria-label="Overlay window">
                    {WINDOW_OPTIONS.map(([value, label]) => {
                      const active = windowKey === value
                      return (
                        <button
                          key={value}
                          type="button"
                          className={cn(styles.windowChip, active && styles.windowChipActive)}
                          aria-current={active ? 'true' : undefined}
                          onClick={() => onWindowChange(value)}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>

                  <div className={styles.performanceRail}>
                    <PerformancePill label="Now" value={avgNowPct} />
                    <PerformancePill label="7d" value={avg7dPct} />
                    <PerformancePill label="30d" value={avg30dPct} />
                  </div>
                </div>

                {!selectedSymbol ? (
                  <div className={cn(util.muted, util.small, styles.emptyCopy)}>
                    Select a ticker to inspect the price overlay and related recommendation videos.
                  </div>
                ) : overlayLoading ? (
                  <LoadingLine label={`Loading ${selectedSymbol} overlay...`} />
                ) : overlay ? (
                  <>
                    <RecommendationOverlayChart
                      symbol={selectedSymbol}
                      prices={overlay.prices || []}
                      events={overlay.events || []}
                    />

                    {eventRows.length === 0 ? (
                      <div className={cn(util.muted, util.small, styles.emptyCopy)}>
                        No recommendation-style videos found for this ticker.
                      </div>
                    ) : (
                      <div className={styles.eventFeedSection}>
                        <div className={styles.eventFeedHeader}>
                          <div>
                            <h3 className={styles.sectionTitle}>Recommendation event feed</h3>
                          </div>
                          <span className={styles.metaChip}>{formatCountLabel(eventRows.length, 'video', 'videos')}</span>
                        </div>

                        <div className={styles.eventFeed}>
                          {eventRows.map((event) => (
                            <article key={event.id} className={styles.eventCard}>
                              <div className={styles.eventCardMain}>
                                {event.thumbUrl ? (
                                  event.url ? (
                                    <a className={styles.eventThumbLink} href={event.url} target="_blank" rel="noreferrer noopener">
                                      <img className={styles.eventThumb} src={event.thumbUrl} alt="" loading="lazy" decoding="async" />
                                    </a>
                                  ) : (
                                    <span className={styles.eventThumbLink}>
                                      <img className={styles.eventThumb} src={event.thumbUrl} alt="" loading="lazy" decoding="async" />
                                    </span>
                                  )
                                ) : null}

                                <div className={styles.eventText}>
                                  {event.url ? (
                                    <a className={styles.eventTitle} href={event.url} target="_blank" rel="noreferrer noopener">
                                      {event.title}
                                    </a>
                                  ) : (
                                    <div className={styles.eventTitle}>{event.title}</div>
                                  )}
                                  {event.subtitle && <div className={styles.eventMeta}>{event.subtitle}</div>}
                                  {event.keyPoints.length > 0 && (
                                    <div className={styles.eventKeyPoints}>
                                      {event.keyPoints.map((kp) => (
                                        <span key={kp} className={styles.eventKeyPoint}>{kp}</span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className={styles.eventSignals}>
                                <PerformancePill label="Now" value={event.nowPct} />
                                <PerformancePill label="7d" value={event.day7Pct} />
                                <PerformancePill label="30d" value={event.day30Pct} />
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className={cn(util.muted, util.small, styles.emptyCopy)}>
                    No overlay data is available for this ticker yet.
                  </div>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
