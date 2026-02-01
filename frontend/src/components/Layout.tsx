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
          <Link to="/files">Files</Link>
          <Link to="/search">Advanced Search</Link>
          <Link to="/upload">Upload Queue</Link>
          <Link to="/dicom-viewer">DICOM Viewer</Link>
          <Link to="/share">Share Access</Link>
          {user?.role === 'patient' && <Link to="/consent">Consent</Link>}
          <Link to="/consent-management">Consent Management</Link>
          <Link to="/federation">Federation Network</Link>
          <Link to="/audit">Audit Logs</Link>
          <Link to="/profile">Profile</Link>
          {user?.role === 'admin' && <Link to="/admin">Admin</Link>}
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
