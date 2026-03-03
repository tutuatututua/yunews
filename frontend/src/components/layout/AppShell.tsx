import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Home, Image, Menu, MessageCircle, TrendingUp, Video, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { TimeZoneMenu } from '../ui/TimeZoneMenu'
import styles from './AppShell.module.css'

function navLinkClassName({ isActive }: { isActive: boolean }) {
  return cn(styles.navLink, isActive && styles.navLinkActive)
}

function pageTitleForPath(pathname: string) {
  if (pathname === '/' || pathname === '') return 'Home'
  if (pathname.startsWith('/chat')) return 'Chat'
  if (pathname.startsWith('/infographic') || pathname.startsWith('/ticker')) return 'Infographic'
  if (pathname.startsWith('/recommendations') || pathname.startsWith('/recomendation')) return 'Recommendations'
  if (pathname.startsWith('/videos')) return 'Videos'
  return 'yuNews'
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const pageTitle = pageTitleForPath(location.pathname)

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
      {/* Sidebar */}
      <aside
        className={cn(
          styles.sidebar,
          collapsed && styles.sidebarCollapsed,
          mobileOpen && styles.sidebarMobileOpen
        )}
      >
        <button
          className={styles.iconButton}
          aria-label="Toggle sidebar"
          onClick={toggleSidebar}
          type="button"
        >
          {isMobile ? (
            mobileOpen ? <X size={18} /> : <Menu size={18} />
          ) : collapsed ? (
            <Menu size={18} />
          ) : (
            <X size={18} />
          )}
        </button>

        <nav className={styles.nav}>
          <NavLink to="/" className={navLinkClassName}>
            <Home size={18} />
            <span className={styles.navLabel}>Home</span>
          </NavLink>
          <NavLink to="/videos" className={navLinkClassName}>
            <Video size={18} />
            <span className={styles.navLabel}>Videos</span>
          </NavLink>
          <NavLink to="/infographic" className={navLinkClassName}>
            <Image size={18} />
            <span className={styles.navLabel}>Infographic</span>
          </NavLink>
          <NavLink to="/recommendations" className={navLinkClassName}>
            <TrendingUp size={18} />
            <span className={styles.navLabel}>Recommendations</span>
          </NavLink>
          <NavLink to="/chat" className={navLinkClassName}>
            <MessageCircle size={18} />
            <span className={styles.navLabel}>Chat</span>
          </NavLink>
        </nav>
      </aside>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Close sidebar"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main */}
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

            <div className={styles.pageTitle}>{pageTitle}</div>
          </div>

          <div className={styles.topbarRight}>
            <TimeZoneMenu />
          </div>
        </header>

        <main className={styles.container}>{children}</main>
      </div>
    </div>
  )
}
