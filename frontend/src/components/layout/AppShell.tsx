import React from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Bell, Home, Image, Search, Settings, Video } from 'lucide-react'
import { cn } from '../../lib/cn'
import { ui } from '../../styles'
import styles from './AppShell.module.css'

function navLinkClassName({ isActive }: { isActive: boolean }) {
  return cn(styles.navLink, isActive && styles.navLinkActive)
}

function pageTitleForPath(pathname: string): string {
  if (pathname === '/' || pathname === '') return 'Home'
  if (pathname.startsWith('/infographic')) return 'Infographic'
  if (pathname.startsWith('/videos')) return 'Videos'
  return 'yuNews'
}

/**
 * Application frame: sticky header + constrained content container.
 * Keeps navigation consistent while pages focus on content.
 */
export default function AppShell(props: { children: React.ReactNode }) {
  const location = useLocation()
  const pageTitle = pageTitleForPath(location.pathname)

  return (
    <div className={styles.appShell}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>

      <div className={styles.layout}>
        <aside className={styles.sidebar} aria-label="Sidebar">
          <Link to="/" className={styles.brand} aria-label="yuNews home">
            <span className={styles.brandMark} aria-hidden="true" />
            <span className={styles.brandText}>yuNews</span>
          </Link>

          <nav className={styles.nav} aria-label="Primary">
            <NavLink className={navLinkClassName} to="/">
              <Home size={18} aria-hidden="true" />
              <span>Home</span>
            </NavLink>
            <NavLink className={navLinkClassName} to="/infographic?days=7">
              <Image size={18} aria-hidden="true" />
              <span>Infographic</span>
            </NavLink>
            <NavLink className={navLinkClassName} to="/videos?days=7">
              <Video size={18} aria-hidden="true" />
              <span>Videos</span>
            </NavLink>
          </nav>

          <div className={styles.sidebarFooter}>
            <a className={styles.footerLink} href={import.meta.env.VITE_BACKEND_BASE_URL || 'http://localhost:8080'} target="_blank" rel="noreferrer">
              API
            </a>
            <a className={styles.footerLink} href={(import.meta.env.VITE_BACKEND_BASE_URL || 'http://localhost:8080') + '/health'} target="_blank" rel="noreferrer">
              Health
            </a>
          </div>
        </aside>

        <div className={styles.main}>
          <header className={styles.topbar} role="banner">
            <div className={styles.topbarLeft}>
              <div className={styles.pageTitle}>{pageTitle}</div>
              <span className={cn(ui.chip, styles.apiChip)} title="Configured backend base URL">
                {import.meta.env.VITE_BACKEND_BASE_URL || 'http://localhost:8080'}
              </span>
            </div>

            <div className={styles.topbarRight} aria-label="Top actions">
              <button className={styles.iconButton} type="button" aria-label="Search">
                <Search size={18} aria-hidden="true" />
              </button>
              <button className={styles.iconButton} type="button" aria-label="Notifications">
                <Bell size={18} aria-hidden="true" />
              </button>
              <button className={styles.iconButton} type="button" aria-label="Settings">
                <Settings size={18} aria-hidden="true" />
              </button>
            </div>
          </header>

          <main className={styles.container} id="main" role="main" tabIndex={-1}>
            {props.children}
          </main>
        </div>
      </div>
    </div>
  )
}
