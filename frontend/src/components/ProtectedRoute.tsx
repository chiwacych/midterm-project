import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isReady } = useAuth()
  const location = useLocation()

  if (!isReady) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
        Loading...
      </div>
    )
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  return <>{children}</>
}
