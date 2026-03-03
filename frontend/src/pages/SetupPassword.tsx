import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

export function SetupPassword() {
  const [searchParams] = useSearchParams()
  const tokenFromUrl = searchParams.get('token') || ''

  const [token, setToken] = useState(tokenFromUrl)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!token.trim()) {
      setError('Invitation token is required')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/setup-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Setup failed')
      }
      // Auto-login: store tokens and reload to pick up user state
      localStorage.setItem('medimage_token', data.access_token)
      localStorage.setItem('medimage_refresh', data.refresh_token)
      window.location.href = '/'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.75rem',
    marginBottom: '1rem',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text)',
    fontSize: 14,
  }

  return (
    <div style={{ maxWidth: 400, margin: '4rem auto', padding: '2rem', background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
      <h1 style={{ marginTop: 0, marginBottom: '0.25rem', fontSize: '1.35rem' }}>Set Up Your Password</h1>
      <p style={{ margin: '0 0 1.5rem', fontSize: 13, color: 'var(--muted)' }}>
        Enter the invitation token you received and choose a password for your account.
      </p>

      <form onSubmit={handleSubmit}>
        {error && (
          <p style={{ color: '#ef4444', marginBottom: '1rem', fontSize: 14, padding: '0.5rem 0.75rem', background: 'rgba(239,68,68,.08)', borderRadius: 6, border: '1px solid rgba(239,68,68,.2)' }}>
            {error}
          </p>
        )}

        <label style={{ display: 'block', marginBottom: '0.35rem', fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>
          Invitation Token
        </label>
        <input
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
          placeholder="Paste the token from your invitation"
          autoComplete="off"
          style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 13 }}
        />

        <label style={{ display: 'block', marginBottom: '0.35rem', fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>
          New Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          style={inputStyle}
        />

        <label style={{ display: 'block', marginBottom: '0.35rem', fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>
          Confirm Password
        </label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
          placeholder="Re-enter your password"
          style={inputStyle}
        />

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '0.6rem',
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 6,
            color: 'white',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Setting up...' : 'Set Password & Sign In'}
        </button>
      </form>

      <p style={{ marginTop: '1rem', fontSize: 14, color: 'var(--muted)' }}>
        Already have a password? <Link to="/login">Sign in</Link>
      </p>
    </div>
  )
}
