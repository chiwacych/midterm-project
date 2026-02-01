import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../api/client'

interface Stats {
  total_files: number
  total_size_mb: number
  total_patients?: number
  success_rate: number
  active_consents?: number
}

interface AccessRequest {
  id: number
  requester_email: string
  requester_role: string
  patient_name?: string
  reason: string
  scope?: string
  requested_at: string
  status: string
}

interface Notification {
  id: number
  title: string
  message: string
  type: string
  link?: string
  created_at: string
}

interface NodeHealth {
  id: string
  name: string
  endpoint: string
  healthy: boolean
  status: string
  last_check: string | null
  total_files: number
  total_size: number
}

interface DashboardData {
  stats: Stats
  pending_requests: {
    count: number
    requests: AccessRequest[]
  }
  notifications: {
    unread_count: number
    items: Notification[]
  }
  node_health: NodeHealth[]
  user_role: string
}

export function Dashboard() {
  const { user } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<DashboardData>('/dashboard')
      .then((result) => {
        setData(result)
        setLoading(false)
      })
      .catch((e) => {
        setErr(e instanceof Error ? e.message : 'Failed to load dashboard')
        setLoading(false)
      })
  }, [])

  if (loading) {
    return <div><h1 style={{ marginTop: 0 }}>Dashboard</h1><p>Loading...</p></div>
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <h1 style={{ marginTop: 0 }}>Dashboard</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
        Welcome, {user?.full_name || user?.email}. Role: <strong>{user?.role}</strong>
      </p>
      
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
      
      {/* Stats Cards */}
      {data?.stats && (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
          <div style={{ padding: '1rem 1.5rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', minWidth: 140 }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{data.stats.total_files}</div>
            <div style={{ fontSize: 14, color: 'var(--muted)' }}>Total files</div>
          </div>
          <div style={{ padding: '1rem 1.5rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', minWidth: 140 }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{data.stats.total_size_mb} MB</div>
            <div style={{ fontSize: 14, color: 'var(--muted)' }}>Storage</div>
          </div>
          {data.stats.total_patients !== undefined && (
            <div style={{ padding: '1rem 1.5rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', minWidth: 140 }}>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{data.stats.total_patients}</div>
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>Patients</div>
            </div>
          )}
          {data.stats.active_consents !== undefined && (
            <div style={{ padding: '1rem 1.5rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', minWidth: 140 }}>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{data.stats.active_consents}</div>
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>Active Consents</div>
            </div>
          )}
          <div style={{ padding: '1rem 1.5rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)', minWidth: 140 }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{data.stats.success_rate}%</div>
            <div style={{ fontSize: 14, color: 'var(--muted)' }}>Upload success</div>
          </div>
        </div>
      )}

      {/* Notifications */}
      {data?.notifications && data.notifications.unread_count > 0 && (
        <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              🔔 Notifications ({data.notifications.unread_count})
            </h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {data.notifications.items.map((notif) => (
              <div 
                key={notif.id} 
                style={{ 
                  padding: '0.75rem', 
                  background: 'var(--background)', 
                  borderRadius: 6, 
                  border: `1px solid ${
                    notif.type === 'error' ? 'rgba(239, 68, 68, 0.3)' :
                    notif.type === 'warning' ? 'rgba(245, 158, 11, 0.3)' :
                    notif.type === 'success' ? 'rgba(16, 185, 129, 0.3)' :
                    'var(--border)'
                  }` 
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <strong style={{ fontSize: 14 }}>{notif.title}</strong>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {new Date(notif.created_at).toLocaleString()}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{notif.message}</div>
                {notif.link && (
                  <Link to={notif.link} style={{ fontSize: 12, color: 'var(--accent)', marginTop: '0.25rem', display: 'inline-block' }}>
                    View details →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Consent Requests / Access Requests */}
      {data?.pending_requests && data.pending_requests.count > 0 && (
        <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              Pending Access Requests ({data.pending_requests.count})
            </h2>
            <Link to="/consent" style={{ fontSize: 14, color: 'var(--accent)', textDecoration: 'none' }}>View all →</Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {data.pending_requests.requests.slice(0, 5).map((req) => (
              <div key={req.id} style={{ padding: '0.75rem', background: 'var(--background)', borderRadius: 6, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <strong style={{ fontSize: 14 }}>{req.requester_email}</strong>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {new Date(req.requested_at).toLocaleDateString()}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{req.reason}</div>
                <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: '0.25rem' }}>
                  Role: {req.requester_role}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Node Health Status */}
      {data?.node_health && data.node_health.length > 0 && (
        <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <h2 style={{ margin: 0, marginBottom: '1rem', fontSize: 18, fontWeight: 600 }}>Storage Node Health</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {data.node_health.map((node) => (
              <div 
                key={node.id} 
                style={{ 
                  padding: '1rem', 
                  background: node.healthy ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
                  borderRadius: 8, 
                  border: `1px solid ${node.healthy ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}` 
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <div 
                    style={{ 
                      width: 10, 
                      height: 10, 
                      borderRadius: '50%', 
                      background: node.healthy ? '#10b981' : '#ef4444' 
                    }}
                  />
                  <strong style={{ fontSize: 14 }}>{node.name}</strong>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Status: {node.status}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Files: {node.total_files}
                </div>
                {node.last_check && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: '0.25rem' }}>
                    Last check: {new Date(node.last_check).toLocaleTimeString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Link to="/files" style={{ display: 'inline-block', padding: '0.5rem 1rem', background: 'var(--accent)', color: 'white', borderRadius: 6, textDecoration: 'none', fontWeight: 600 }}>
        Browse files
      </Link>
    </div>
  )
}