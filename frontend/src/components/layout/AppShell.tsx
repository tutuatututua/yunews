import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Home, Image, Menu, MessageCircle, MessageSquare, TrendingUp, Video, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { TimeZoneMenu } from '../ui/TimeZoneMenu'
import styles from './AppShell.module.css'

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/videos', label: 'Videos', icon: Video },
  { to: '/infographic', label: 'Infographic', icon: Image },
  { to: '/recommendations', label: 'Recommendations', icon: TrendingUp },
  { to: '/chat', label: 'Chat', icon: MessageCircle },
  { to: '/feedback', label: 'Feedback', icon: MessageSquare },
] as const

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
