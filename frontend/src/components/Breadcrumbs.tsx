import { Link, useLocation } from 'react-router-dom'

const LABELS: Record<string, string> = {
  files: 'Files',
  share: 'Consent Requests',
  consent: 'Consent',
  federation: 'Federation Network',
  settings: 'Settings',
  'dicom-viewer': 'DICOM Viewer',
  '2fa': 'Two-Factor Auth',
}

export function Breadcrumbs() {
  const location = useLocation()
  const pathSegments = location.pathname.split('/').filter(Boolean)

  const crumbs = [{ path: '/', label: 'Dashboard' }]
  let running = ''
  for (const segment of pathSegments) {
    running += `/${segment}`
    crumbs.push({ path: running, label: LABELS[segment] || segment })
  }

  if (crumbs.length <= 1) return null

  return (
    <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: 'var(--muted)' }}>
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1
        return (
          <span key={crumb.path}>
            {index > 0 && <span style={{ margin: '0 0.5rem' }}>/</span>}
            {isLast ? (
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{crumb.label}</span>
            ) : (
              <Link to={crumb.path} style={{ color: 'var(--muted)', textDecoration: 'none' }}>
                {crumb.label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
