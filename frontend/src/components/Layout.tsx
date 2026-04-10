import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ThemeToggle } from './ThemeToggle'
import { Breadcrumbs } from './Breadcrumbs'
import styles from './Layout.module.css'

export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const navItems = useMemo(() => {
    const items: Array<{ to: string; label: string; show: boolean }> = [
      { to: '/', label: 'Dashboard', show: true },
      { to: '/files', label: 'Files', show: user?.role !== 'patient' },
      { to: '/share', label: 'Consent Requests', show: user?.role === 'doctor' || user?.role === 'admin' },
      { to: '/consent', label: 'My Consent', show: user?.role === 'patient' },
      { to: '/federation', label: 'Federation Network', show: user?.role !== 'patient' },
      { to: '/settings', label: 'Settings', show: true },
    ]
    return items.filter(item => item.show)
  }, [user?.role])

  return (
    <div className={styles.layout}>
      <div
        className={`${styles.overlay} ${mobileOpen ? styles.overlayVisible : ''}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.brand}>
          <NavLink to="/">MedImage</NavLink>
        </div>
        <nav className={styles.nav}>
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.user}>
          <span className={styles.role}>{user?.role}</span>
          <span className={styles.email}>{user?.email}</span>
          <button type="button" className={styles.logout} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </aside>
      <main className={styles.main}>
        <div className={styles.header}>
          <button
            type="button"
            className={styles.menuButton}
            onClick={() => setMobileOpen(value => !value)}
            aria-label="Toggle navigation"
          >
            {mobileOpen ? 'Close' : 'Menu'}
          </button>
          <div className={styles.breadcrumbWrap}>
            <Breadcrumbs />
          </div>
          <ThemeToggle />
        </div>
        <Outlet />
      </main>
    </div>
  )
}
