import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { 
  listConsents, 
  grantConsent, 
  revokeConsent, 
  type ConsentItem, 
  type GrantConsentBody
} from '../api/client'

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  marginBottom: '0.75rem',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
}

export function Consent() {
  const { user } = useAuth()
  const [list, setList] = useState<ConsentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [grantScope, setGrantScope] = useState('all')
  const [grantToRole, setGrantToRole] = useState('doctor')
  const [grantExpires, setGrantExpires] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [revokingId, setRevokingId] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await listConsents()
      setList(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleGrant = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    
    const body: GrantConsentBody = {
      granted_to_role: grantToRole || undefined,
      scope: grantScope || undefined,
    }
    
    if (grantExpires.trim()) body.expires_at = new Date(grantExpires).toISOString()
    
    grantConsent(body)
      .then(() => {
        setGrantScope('all')
        setGrantToRole('doctor')
        setGrantExpires('')
        load()
        alert('✅ Access granted!')
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Grant failed'))
      .finally(() => setSubmitting(false))
  }

  const handleRevoke = (id: number) => {
    if (!window.confirm('Revoke this consent?')) return
    setRevokingId(id)
    revokeConsent(id)
      .then(load)
      .catch((e) => setError(e instanceof Error ? e.message : 'Revoke failed'))
      .finally(() => setRevokingId(null))
  }

  if (user?.role !== 'patient') {
    return (
      <div>
        <h1 style={{ marginTop: 0 }}>Consent</h1>
        <p style={{ color: 'var(--muted)' }}>Only patients can manage consent. Your role: {user?.role}.</p>
      </div>
    )
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Consent Management</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
        Grant or revoke access to your medical files for doctors or other users.
      </p>

      <section style={{ marginBottom: '2rem', padding: '1.5rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem', marginBottom: '1rem' }}>Grant Consent</h2>
        <form onSubmit={handleGrant}>
          {error && (
            <p style={{ 
              color: 'var(--danger)', 
              marginBottom: '0.75rem', 
              fontSize: 14, 
              padding: '0.75rem', 
              background: 'rgba(239, 68, 68, 0.1)', 
              borderRadius: 6 
            }}>
              {error}
            </p>
          )}
          
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: 14, color: 'var(--muted)' }}>
            Scope
          </label>
          <input
            type="text"
            placeholder="e.g., all, file:123"
            value={grantScope}
            onChange={(e) => setGrantScope(e.target.value)}
            style={inputStyle}
          />

          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: 14, color: 'var(--muted)' }}>
            Grant to Role
          </label>
          <select 
            value={grantToRole} 
            onChange={(e) => setGrantToRole(e.target.value)}
            style={inputStyle}
          >
            <option value="doctor">Doctor</option>
            <option value="admin">Admin</option>
            <option value="patient">Patient</option>
          </select>

          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: 14, color: 'var(--muted)' }}>
            Expires At (optional)
          </label>
          <input
            type="datetime-local"
            value={grantExpires}
            onChange={(e) => setGrantExpires(e.target.value)}
            style={inputStyle}
          />

          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '0.625rem 1.5rem',
              background: submitting ? 'var(--muted)' : 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {submitting ? 'Granting...' : 'Grant'}
          </button>
        </form>
      </section>

      <section>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Active Consents</h2>
        {loading ? (
          <p style={{ color: 'var(--muted)' }}>Loading...</p>
        ) : list.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>No active consents.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {list.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: '1rem',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>
                    Scope: {item.scope || 'all'}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                    Role: {item.granted_to_role || 'any'} • 
                    Status: {item.revoked_at ? '❌ Revoked' : '✅ Active'} •
                    Expires: {item.expires_at ? new Date(item.expires_at).toLocaleDateString() : 'Never'}
                  </div>
                </div>
                {!item.revoked_at && (
                  <button
                    onClick={() => handleRevoke(item.id)}
                    disabled={revokingId === item.id}
                    style={{
                      padding: '0.5rem 1rem',
                      background: revokingId === item.id ? 'var(--muted)' : 'var(--danger)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      cursor: revokingId === item.id ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                    }}
                  >
                    {revokingId === item.id ? 'Revoking...' : 'Revoke'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
