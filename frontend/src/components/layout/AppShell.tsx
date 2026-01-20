import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Bell, Home, Image, Menu, Search, Video, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { TimeZoneMenu } from '../ui/TimeZoneMenu'
import styles from './AppShell.module.css'

function navLinkClassName({ isActive }: { isActive: boolean }) {
  return cn(styles.navLink, isActive && styles.navLinkActive)
}

function pageTitleForPath(pathname: string) {
  if (pathname === '/' || pathname === '') return 'Home'
  if (pathname.startsWith('/ticker')) return 'Ticker'
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
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onChange)
      return () => mediaQuery.removeEventListener('change', onChange)
    }

    mediaQuery.addListener(onChange)
    return () => mediaQuery.removeListener(onChange)
  }, [])

  const toggleSidebar = () => {
    if (isMobile) setMobileOpen((v) => !v)
    else setCollapsed((v) => !v)
  }

  return (
    <div
      className={cn(
        styles.appShell,
        collapsed && styles.appShellCollapsed
      )}
    >
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
          <NavLink to="/ticker" className={navLinkClassName}>
            <Image size={18} />
            <span className={styles.navLabel}>Ticker</span>
          </NavLink>
          <NavLink to="/videos" className={navLinkClassName}>
            <Video size={18} />
            <span className={styles.navLabel}>Videos</span>
          </NavLink>
        </nav>
      </aside>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className={styles.backdrop}
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
              >
                {mobileOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
            )}

            <div className={styles.pageTitle}>{pageTitle}</div>
          </div>

          <div className={styles.topbarRight}>
            <button className={styles.iconButton}>
              <Search size={18} />
            </button>
            <button className={styles.iconButton}>
              <Bell size={18} />
            </button>
            <TimeZoneMenu />
          </div>
        </header>

        <main className={styles.container}>{children}</main>
      </div>
    </div>
  )
}
