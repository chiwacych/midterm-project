import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ThemeToggle } from './ThemeToggle'
import styles from './Layout.module.css'

export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <Link to="/">MedImage</Link>
        </div>
        <nav className={styles.nav}>
          <Link to="/">Dashboard</Link>
          {user?.role !== 'patient' && (
            <Link to="/files">Files</Link>
          )}
          {(user?.role === 'doctor' || user?.role === 'admin') && <Link to="/share">Consent Requests</Link>}
          {user?.role === 'patient' && <Link to="/consent">My Consent</Link>}
          {user?.role !== 'patient' && (
            <Link to="/federation">Federation Network</Link>
          )}
          <Link to="/settings">Settings</Link>
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
          <ThemeToggle />
        </div>
        <Outlet />
      </main>
    </div>
  )
}
