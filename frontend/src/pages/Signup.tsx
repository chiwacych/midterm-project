import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function Signup() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signup } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      await signup(email, password, fullName || undefined)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '4rem auto', padding: '2rem', background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
      <h1 style={{ marginTop: 0, marginBottom: '1.5rem' }}>Sign up</h1>
      <p style={{ marginTop: '-0.7rem', marginBottom: '1rem', color: 'var(--muted)', fontSize: 13 }}>
        Patient self-registration
      </p>
      <form onSubmit={handleSubmit}>
        {error && <p style={{ color: 'var(--danger)', marginBottom: '1rem', fontSize: 14 }}>{error}</p>}
        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: 14, color: 'var(--muted)' }}>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" style={{ width: '100%', padding: '0.5rem 0.75rem', marginBottom: '1rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }} />
        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: 14, color: 'var(--muted)' }}>Full name</label>
        <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} style={{ width: '100%', padding: '0.5rem 0.75rem', marginBottom: '1rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }} />
        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: 14, color: 'var(--muted)' }}>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" style={{ width: '100%', padding: '0.5rem 0.75rem', marginBottom: '1rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }} />
        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: 14, color: 'var(--muted)' }}>Confirm password</label>
        <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} autoComplete="new-password" style={{ width: '100%', padding: '0.5rem 0.75rem', marginBottom: '1rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }} />
        <button type="submit" disabled={loading} style={{ width: '100%', padding: '0.6rem', background: 'var(--accent)', border: 'none', borderRadius: 6, color: 'white', fontWeight: 600 }}>{loading ? 'Creating account...' : 'Sign up'}</button>
      </form>
      <p style={{ marginTop: '1rem', fontSize: 14, color: 'var(--muted)' }}>Already have an account? <Link to="/login">Sign in</Link></p>
    </div>
  )
}
