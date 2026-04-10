import { useEffect, useState } from 'react'
import { getProfile, request2FAChallenge, verify2FA } from '../api/client'

export function TwoFactorSetup() {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [challengeReady, setChallengeReady] = useState(false)
  const [otp, setOtp] = useState('')
  const [hint, setHint] = useState<string | undefined>(undefined)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const targetState = !enabled

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        const profile = await getProfile()
        if (cancelled) return
        setEnabled(profile.two_factor_enabled)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load profile')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const handleRequestOtp = async () => {
    try {
      setRequesting(true)
      setError('')
      setMessage('')
      const response = await request2FAChallenge()
      setHint(response.otp_hint)
      setChallengeReady(true)
      setMessage(`Code generated. It expires in ${response.expires_in} seconds.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate OTP')
    } finally {
      setRequesting(false)
    }
  }

  const handleVerify = async () => {
    if (!otp.trim()) {
      setError('Enter the OTP code first.')
      return
    }

    try {
      setVerifying(true)
      setError('')
      setMessage('')
      const response = await verify2FA(otp.trim(), targetState)
      setEnabled(response.two_factor_enabled)
      setOtp('')
      setHint(undefined)
      setChallengeReady(false)
      setMessage(response.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify OTP')
    } finally {
      setVerifying(false)
    }
  }

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Loading 2FA settings...</div>
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>Two-Factor Authentication</h1>
      <p style={{ color: 'var(--muted)' }}>
        Current status: <strong style={{ color: enabled ? 'var(--success)' : 'var(--danger)' }}>{enabled ? 'Enabled' : 'Disabled'}</strong>
      </p>

      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '1rem', background: 'var(--surface)' }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>
          {targetState ? 'Enable 2FA' : 'Disable 2FA'}
        </h2>
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>
          Request a one-time code, enter it below, and confirm.
        </p>

        {!challengeReady ? (
          <button onClick={handleRequestOtp} disabled={requesting}>
            {requesting ? 'Requesting code...' : 'Request OTP code'}
          </button>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem', maxWidth: 360 }}>
            <input
              value={otp}
              onChange={event => setOtp(event.target.value)}
              inputMode="numeric"
              maxLength={6}
              placeholder="Enter 6-digit OTP"
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={handleVerify} disabled={verifying}>
                {verifying ? 'Verifying...' : `Confirm ${targetState ? 'Enable' : 'Disable'}`}
              </button>
              <button
                onClick={() => {
                  setChallengeReady(false)
                  setOtp('')
                  setHint(undefined)
                }}
                style={{ background: 'transparent' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {hint && (
          <div style={{ marginTop: '0.75rem', fontSize: 13, color: 'var(--warning)' }}>
            Development OTP hint: <strong>{hint}</strong>
          </div>
        )}
      </div>

      {message && <div style={{ marginTop: '0.9rem', color: 'var(--success)' }}>{message}</div>}
      {error && <div style={{ marginTop: '0.9rem', color: 'var(--danger)' }}>{error}</div>}
    </div>
  )
}
