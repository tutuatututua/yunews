import React from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Home, Image, Menu, MessageCircle, MessageSquare, TrendingUp, Video, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { TimeZoneMenu } from '../ui/TimeZoneMenu'
import { ui } from '../../styles'
import styles from './AppShell.module.css'

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/videos', label: 'Videos', icon: Video },
  { to: '/infographic', label: 'Infographic', icon: Image },
  { to: '/recommendations', label: 'Recommendations', icon: TrendingUp },
  { to: '/chat', label: 'Chat', icon: MessageCircle },
  { to: '/feedback', label: 'Feedback', icon: MessageSquare },
] as const

const DEV_MESSAGE = {
  title: 'Message from the developer',
  intro: 'Hi, I\'m Tua. I started building this site as a small side project, and it has grown into something with real potential. My focus now is turning it into a fast, reliable product people can trust every day.',
  details:
    'The next stage is clear: stronger infrastructure, better performance for users outside Thailand, email alerts for important market updates, broader news coverage from sources like Yahoo Finance, and smarter features such as candle prediction.',
  closing:
    'If you want to help shape that direction, please send feedback. Tell me what feels valuable, what is missing, and what would make this product worth returning to. Your feedback will directly influence what gets built next.',
  cta: 'Share feedback',
} as const

type PageMeta = {
  title: string
}

function navLinkClassName({ isActive }: { isActive: boolean }) {
  return cn(styles.navLink, isActive && styles.navLinkActive)
}

function pageMetaForPath(pathname: string): PageMeta {
  if (pathname === '/' || pathname === '') return { title: 'Home' }
  if (pathname.startsWith('/chat')) return { title: 'Chat' }
  if (pathname.startsWith('/infographic') || pathname.startsWith('/ticker')) return { title: 'Infographic' }
  if (pathname.startsWith('/recommendations') || pathname.startsWith('/recomendation')) return { title: 'Recommendations' }
  if (pathname.startsWith('/videos')) return { title: 'Videos' }
  if (pathname.startsWith('/feedback')) return { title: 'Feedback' }
  return { title: 'yuNews' }
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const pageMeta = pageMetaForPath(location.pathname)
  const isWideLayout = location.pathname.startsWith('/recommendations')

  const [collapsed, setCollapsed] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [floatingExpanded, setFloatingExpanded] = React.useState(false)

  const [isMobile, setIsMobile] = React.useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 860px)').matches
  })

  React.useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(max-width: 860px)')
    const onChange = () => setIsMobile(mediaQuery.matches)

    onChange()
    if (typeof (mediaQuery as any).addEventListener !== 'function') return

    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [])

  const toggleSidebar = () => {
    if (isMobile) setMobileOpen((v) => !v)
    else setCollapsed((v) => !v)
  }

  React.useEffect(() => {
    if (!mobileOpen) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen])

  return (
    <div className={cn(styles.appShell, collapsed && styles.appShellCollapsed)}>
      <aside
        className={cn(
          styles.sidebar,
          collapsed && styles.sidebarCollapsed,
          mobileOpen && styles.sidebarMobileOpen
        )}
      >
        <div className={styles.sidebarHeader}>
          <button
            className={styles.iconButton}
            aria-label="Toggle sidebar"
            onClick={toggleSidebar}
            type="button"
          >
            {isMobile ? mobileOpen ? <X size={18} /> : <Menu size={18} /> : collapsed ? <Menu size={18} /> : <X size={18} />}
          </button>
        </div>

        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to} className={navLinkClassName}>
                <Icon size={18} />
                <span className={styles.navLabel}>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

      </aside>

      {mobileOpen && (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Close sidebar"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className={styles.main}>

      {/* Floating "Built independently" info window */}
      <div className={cn(styles.floatingInfo, floatingExpanded && styles.floatingInfoExpanded)}>
        {floatingExpanded && (
          <div className={styles.floatingInfoBody}>
            <div className={styles.floatingInfoTitle}>{DEV_MESSAGE.title}</div>
            <div className={styles.floatingInfoContent}>
              <p>{DEV_MESSAGE.intro}</p>
              <p>{DEV_MESSAGE.details}</p>
              <p>{DEV_MESSAGE.closing}</p>
            </div>
            <Link className={cn(ui.button, styles.floatingInfoCta)} to="/feedback">
              {DEV_MESSAGE.cta}
            </Link>
          </div>
        )}
        <button
          type="button"
          className={styles.floatingInfoToggle}
          onClick={() => setFloatingExpanded(v => !v)}
          aria-expanded={floatingExpanded}
          aria-label={floatingExpanded ? 'Collapse developer info' : 'Expand developer info'}
        >
          <span className={styles.floatingInfoCat} aria-hidden="true" />
          <span className={styles.floatingInfoLabel}>message from dev</span>
          <span className={styles.floatingInfoChevron}>{floatingExpanded ? '▼' : '▲'}</span>
        </button>
      </div>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            {isMobile && (
              <button
                className={styles.iconButton}
                aria-label={mobileOpen ? 'Close sidebar' : 'Open sidebar'}
                onClick={() => setMobileOpen((v) => !v)}
                type="button"
              >
                {mobileOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
            )}

            <div className={styles.topbarCopy}>
              <div className={styles.pageTitle}>{pageMeta.title}</div>
            </div>
          </div>

          <div className={styles.topbarRight}>
            <TimeZoneMenu />
          </div>
        </header>

        <main className={cn(styles.container, isWideLayout && styles.containerWide)}>{children}</main>
      </div>
    </div>
  )
}
