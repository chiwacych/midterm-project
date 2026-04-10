import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  listConsents,
  grantConsent,
  revokeConsent,
  listPendingForMe,
  approveAccessRequest,
  denyAccessRequest,
  getMyFiles,
  getMyNotifications,
  markNotificationRead,
  type ConsentItem,
  type AccessRequest,
  type PatientFile,
  type ConsentNotification,
} from '../api/client'

type Tab = 'files' | 'pending' | 'consents' | 'notifications'

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '0.625rem 1.25rem',
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? '#fff' : 'var(--text)',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: active ? 600 : 400,
  fontSize: 14,
  transition: 'all 0.2s',
})

const cardStyle: React.CSSProperties = {
  padding: '1rem 1.25rem',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
}

const badgeStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  background: `${color}22`,
  color,
  borderRadius: 12,
  fontSize: 12,
  fontWeight: 600,
})

export function Consent() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('files')
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // My Files
  const [files, setFiles] = useState<PatientFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<number[]>([])
  const [grantToRole, setGrantToRole] = useState('doctor')
  const [grantExpiresDays, setGrantExpiresDays] = useState(30)
  const [granting, setGranting] = useState(false)

  // Pending Requests
  const [pending, setPending] = useState<AccessRequest[]>([])
  const [loadingPending, setLoadingPending] = useState(false)
  const [processingId, setProcessingId] = useState<number | null>(null)
  const [approveDays, setApproveDays] = useState<Record<number, number>>({})
  const [focusedRequestId, setFocusedRequestId] = useState<number | null>(null)

  // Consents
  const [consents, setConsents] = useState<ConsentItem[]>([])
  const [loadingConsents, setLoadingConsents] = useState(false)
  const [revokingId, setRevokingId] = useState<number | null>(null)

  // Notifications
  const [notifications, setNotifications] = useState<ConsentNotification[]>([])
  const [loadingNotifs, setLoadingNotifs] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)

  const unreadCount = notifications.filter(n => !n.read).length
  const pendingCount = pending.length
  const patientFileById = useMemo(
    () => new Map(files.map(file => [file.id, file])),
    [files],
  )

  const parseRequestIdFromLink = (link: string | null): number | null => {
    if (!link) return null
    try {
      const url = new URL(link, window.location.origin)
      const raw = url.searchParams.get('request_id') || url.searchParams.get('requestId')
      if (!raw) return null
      const parsed = parseInt(raw, 10)
      return Number.isNaN(parsed) ? null : parsed
    } catch {
      return null
    }
  }

  const scrollToPendingRequest = (requestId: number) => {
    window.setTimeout(() => {
      const el = document.getElementById(`pending-request-${requestId}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 80)
  }

  // ---- Loaders ----
  const loadFiles = async () => {
    setLoadingFiles(true)
    try { setFiles(await getMyFiles()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load files') }
    finally { setLoadingFiles(false) }
  }

  const loadPending = async () => {
    setLoadingPending(true)
    try {
      const res = await listPendingForMe()
      setPending(res.requests)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load pending requests') }
    finally { setLoadingPending(false) }
  }

  const loadConsents = async () => {
    setLoadingConsents(true)
    try { setConsents(await listConsents()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load consents') }
    finally { setLoadingConsents(false) }
  }

  const loadNotifications = async () => {
    setLoadingNotifs(true)
    try { setNotifications(await getMyNotifications(unreadOnly)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load notifications') }
    finally { setLoadingNotifs(false) }
  }

  useEffect(() => {
    if (user?.role !== 'patient') return
    loadFiles()
    loadPending()
    loadConsents()
    loadNotifications()
  }, [user])

  useEffect(() => { if (user?.role === 'patient') loadNotifications() }, [unreadOnly])

  useEffect(() => {
    if (user?.role !== 'patient') return
    const params = new URLSearchParams(location.search)
    const rawRequestId = params.get('request_id')
    if (!rawRequestId) return

    const requestId = parseInt(rawRequestId, 10)
    if (Number.isNaN(requestId)) return

    setTab('pending')
    setFocusedRequestId(requestId)
    loadPending().finally(() => scrollToPendingRequest(requestId))

    params.delete('request_id')
    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params.toString()}` : '',
      },
      { replace: true },
    )
  }, [location.pathname, location.search, navigate, user])

  useEffect(() => {
    if (focusedRequestId && !pending.some(req => req.id === focusedRequestId)) {
      setFocusedRequestId(null)
    }
  }, [focusedRequestId, pending])

  // Auto-clear success message
  useEffect(() => {
    if (successMsg) { const t = setTimeout(() => setSuccessMsg(null), 4000); return () => clearTimeout(t) }
  }, [successMsg])

  // ---- Handlers ----
  const toggleFile = (id: number) =>
    setSelectedFiles(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id])

  const handleGrantConsent = async () => {
    if (selectedFiles.length === 0) { setError('Select at least one file'); return }
    setGranting(true)
    setError(null)
    try {
      await grantConsent({
        file_ids: selectedFiles,
        granted_to_role: grantToRole,
        expires_days: grantExpiresDays,
      })
      setSuccessMsg(`Consent granted for ${selectedFiles.length} file(s)`)
      setSelectedFiles([])
      loadFiles()
      loadConsents()
    } catch (e) { setError(e instanceof Error ? e.message : 'Grant failed') }
    finally { setGranting(false) }
  }

  const handleApprove = async (id: number) => {
    setProcessingId(id)
    setError(null)
    try {
      await approveAccessRequest(id, approveDays[id] || 30)
      setSuccessMsg('Request accepted — consent created automatically')
      loadPending()
      loadConsents()
    } catch (e) { setError(e instanceof Error ? e.message : 'Approval failed') }
    finally { setProcessingId(null) }
  }

  const handleDeny = async (id: number) => {
    if (!window.confirm('Reject this consent request?')) return
    setProcessingId(id)
    try {
      await denyAccessRequest(id)
      setSuccessMsg('Request rejected')
      loadPending()
    } catch (e) { setError(e instanceof Error ? e.message : 'Reject failed') }
    finally { setProcessingId(null) }
  }

  const handleRevoke = async (id: number) => {
    if (!window.confirm('Revoke this consent? The recipient will lose access.')) return
    setRevokingId(id)
    try {
      await revokeConsent(id)
      setSuccessMsg('Consent revoked')
      loadConsents()
      loadFiles()
    } catch (e) { setError(e instanceof Error ? e.message : 'Revoke failed') }
    finally { setRevokingId(null) }
  }

  const handleNotifRead = async (id: number) => {
    try { await markNotificationRead(id); loadNotifications() } catch { /* ignore */ }
  }

  const handleOpenNotificationRequest = async (notif: ConsentNotification) => {
    const requestId = parseRequestIdFromLink(notif.link)

    if (!notif.read) {
      try {
        await markNotificationRead(notif.id)
      } catch {
        // best effort only
      }
    }

    await loadFiles()
    await loadPending()
    await loadNotifications()

    setTab('pending')
    if (requestId) {
      setFocusedRequestId(requestId)
      scrollToPendingRequest(requestId)
      setSuccessMsg('Review the request and choose Accept or Reject.')
    } else {
      setSuccessMsg('Opened pending requests for your review.')
    }
  }

  // ---- Non-patient view ----
  if (user?.role !== 'patient') {
    return (
      <div>
        <h1 style={{ marginTop: 0 }}>My Consent Portal</h1>
        <p style={{ color: 'var(--muted)' }}>
          This page is for patients to manage their own consent.
          Your role: <strong>{user?.role}</strong>.
          {' '}Use the <strong>Share Access</strong> page to manage patient consent requests.
        </p>
      </div>
    )
  }

  // ---- Patient view ----
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>My Consent Portal</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1.25rem', fontSize: 14 }}>
        Kenya DPA — View your files, respond to consent requests, manage who has access.
      </p>

      {/* Alerts */}
      {error && (
        <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#ef4444', fontSize: 14 }}>
          {error}
          <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 700 }}>×</button>
        </div>
      )}
      {successMsg && (
        <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, color: '#10b981', fontSize: 14 }}>
          {successMsg}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
        <button onClick={() => setTab('files')} style={tabStyle(tab === 'files')}>
          My Files
        </button>
        <button onClick={() => setTab('pending')} style={tabStyle(tab === 'pending')}>
          Pending Requests {pendingCount > 0 && <span style={badgeStyle('#f59e0b')}>{pendingCount}</span>}
        </button>
        <button onClick={() => setTab('consents')} style={tabStyle(tab === 'consents')}>
          My Consents
        </button>
        <button onClick={() => setTab('notifications')} style={tabStyle(tab === 'notifications')}>
          Notifications {unreadCount > 0 && <span style={badgeStyle('#3b82f6')}>{unreadCount}</span>}
        </button>
      </div>

      {/* ===================== MY FILES TAB ===================== */}
      {tab === 'files' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>My Medical Files</h2>
            <button onClick={loadFiles} disabled={loadingFiles} style={{ padding: '0.4rem 0.75rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', cursor: 'pointer', fontSize: 13 }}>
              {loadingFiles ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {loadingFiles ? (
            <p style={{ color: 'var(--muted)' }}>Loading your files...</p>
          ) : files.length === 0 ? (
            <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--muted)' }}>
              <p>No files found linked to your account.</p>
              <p style={{ fontSize: 13 }}>Your hospital will upload files associated with your patient record.</p>
            </div>
          ) : (
            <>
              {/* File list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                {files.map(f => (
                  <label key={f.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', background: selectedFiles.includes(f.id) ? 'rgba(59,130,246,0.08)' : 'var(--surface)' }}>
                    <input type="checkbox" checked={selectedFiles.includes(f.id)} onChange={() => toggleFile(f.id)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{f.original_filename || f.filename}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                        {(f.file_size / 1024 / 1024).toFixed(2)} MB · {new Date(f.upload_timestamp).toLocaleDateString()}
                        {f.description && <> · {f.description}</>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 90 }}>
                      {f.has_active_consent
                        ? <span style={badgeStyle('#10b981')}>Shared ({f.consent_count})</span>
                        : <span style={badgeStyle('#6b7280')}>Private</span>}
                    </div>
                  </label>
                ))}
              </div>

              {/* Grant consent form */}
              {selectedFiles.length > 0 && (
                <div style={{ ...cardStyle, borderColor: 'rgba(59,130,246,0.4)', marginBottom: '1rem' }}>
                  <h3 style={{ margin: '0 0 0.75rem', fontSize: 15 }}>
                    Grant Consent for {selectedFiles.length} file(s)
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>Grant to Role</label>
                      <select value={grantToRole} onChange={e => setGrantToRole(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}>
                        <option value="doctor">Doctors</option>
                        <option value="admin">Admins</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>Duration (days)</label>
                      <input type="number" value={grantExpiresDays} onChange={e => setGrantExpiresDays(parseInt(e.target.value) || 30)} min={1} max={365} style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
                    </div>
                  </div>
                  <button onClick={handleGrantConsent} disabled={granting} style={{ padding: '0.6rem 1.5rem', background: granting ? 'var(--muted)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: granting ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
                    {granting ? 'Granting...' : 'Grant Consent'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ===================== PENDING REQUESTS TAB ===================== */}
      {tab === 'pending' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Pending Consent Requests</h2>
            <button onClick={loadPending} disabled={loadingPending} style={{ padding: '0.4rem 0.75rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', cursor: 'pointer', fontSize: 13 }}>
              {loadingPending ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: '1rem' }}>
            Doctors and hospitals request your consent before accessing your files. Review and approve or deny below.
          </p>

          {loadingPending ? (
            <p style={{ color: 'var(--muted)' }}>Loading...</p>
          ) : pending.length === 0 ? (
            <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--muted)' }}>
              No pending consent requests.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {pending.map(req => {
                const requestFileIds = req.file_ids && req.file_ids.length > 0
                  ? req.file_ids
                  : (req.file_id ? [req.file_id] : [])
                const isFocused = focusedRequestId === req.id

                return (
                <div id={`pending-request-${req.id}`} key={req.id} style={{ ...cardStyle, borderLeftWidth: 4, borderLeftColor: req.urgency === 'urgent' ? '#f59e0b' : req.urgency === 'emergency' ? '#ef4444' : 'var(--accent)', background: isFocused ? 'rgba(59,130,246,0.08)' : 'var(--surface)', boxShadow: isFocused ? '0 0 0 1px rgba(59,130,246,0.35)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <div>
                      <strong>{req.requester_name || req.requester_email}</strong>
                      <span style={{ ...badgeStyle('#6b7280'), marginLeft: 8 }}>{req.requester_role}</span>
                      {req.urgency && req.urgency !== 'normal' && (
                        <span style={{ ...badgeStyle(req.urgency === 'emergency' ? '#ef4444' : '#f59e0b'), marginLeft: 6 }}>
                          {req.urgency.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {new Date(req.requested_at).toLocaleString()}
                    </span>
                  </div>

                  <div style={{ fontSize: 14, marginBottom: '0.5rem' }}>
                    <strong>Reason:</strong> {req.reason}
                  </div>

                  {requestFileIds.length > 0 && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
                        Requested files:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {requestFileIds.map(fileId => {
                          const file = patientFileById.get(fileId)
                          return (
                            <div key={`${req.id}-${fileId}`} style={{ fontSize: 13, color: 'var(--text)' }}>
                              <strong>#{fileId}</strong>
                              {' '}· {file ? (file.original_filename || file.filename) : `File ID ${fileId}`}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {req.requester_hospital_id && (
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: '0.75rem' }}>
                      From hospital: {req.requester_hospital_id}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 13, color: 'var(--muted)' }}>Duration:</label>
                    <select value={approveDays[req.id] || 30} onChange={e => setApproveDays(prev => ({ ...prev, [req.id]: parseInt(e.target.value) }))} style={{ padding: '0.3rem 0.5rem', borderRadius: 4, border: '1px solid var(--border)', fontSize: 13 }}>
                      <option value={7}>7 days</option>
                      <option value={14}>14 days</option>
                      <option value={30}>30 days</option>
                      <option value={90}>90 days</option>
                      <option value={180}>180 days</option>
                      <option value={365}>1 year</option>
                    </select>
                    <button onClick={() => handleApprove(req.id)} disabled={processingId === req.id} style={{ padding: '0.4rem 1rem', background: processingId === req.id ? 'var(--muted)' : 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 6, cursor: processingId === req.id ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13 }}>
                      {processingId === req.id ? 'Processing...' : 'Accept'}
                    </button>
                    <button onClick={() => handleDeny(req.id)} disabled={processingId === req.id} style={{ padding: '0.4rem 1rem', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, cursor: processingId === req.id ? 'not-allowed' : 'pointer', fontWeight: 500, fontSize: 13 }}>
                      Reject
                    </button>
                  </div>
                </div>
              )})}
            </div>
          )}
        </div>
      )}

      {/* ===================== MY CONSENTS TAB ===================== */}
      {tab === 'consents' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Active Consents</h2>
            <button onClick={loadConsents} disabled={loadingConsents} style={{ padding: '0.4rem 0.75rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', cursor: 'pointer', fontSize: 13 }}>
              {loadingConsents ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {loadingConsents ? (
            <p style={{ color: 'var(--muted)' }}>Loading...</p>
          ) : consents.length === 0 ? (
            <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--muted)' }}>
              No consents found. Grant consent from the "My Files" tab.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {consents.map(c => {
                const status = c.revoked_at ? 'revoked' : (c.expires_at && new Date(c.expires_at) < new Date()) ? 'expired' : 'active'
                const statusColor = status === 'active' ? '#10b981' : status === 'expired' ? '#f59e0b' : '#ef4444'
                return (
                  <div key={c.id} style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 4 }}>
                          {c.scope || 'All files'}
                          <span style={{ ...badgeStyle(statusColor), marginLeft: 8 }}>{status}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {c.granted_to_role && <>Role: {c.granted_to_role}</>}
                          {c.granted_to_user_id && <> · User #{c.granted_to_user_id}</>}
                          {c.granted_to_hospital_id && <> · Hospital: {c.granted_to_hospital_name || c.granted_to_hospital_id}</>}
                          {' '}· Granted: {new Date(c.granted_at).toLocaleDateString()}
                          {c.expires_at && <> · Expires: {new Date(c.expires_at).toLocaleDateString()}</>}
                        </div>
                      </div>
                      {status === 'active' && (
                        <button onClick={() => handleRevoke(c.id)} disabled={revokingId === c.id} style={{ padding: '0.4rem 0.75rem', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, cursor: revokingId === c.id ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>
                          {revokingId === c.id ? 'Revoking...' : 'Revoke'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================== NOTIFICATIONS TAB ===================== */}
      {tab === 'notifications' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Notifications</h2>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />
                Unread only
              </label>
              <button onClick={loadNotifications} disabled={loadingNotifs} style={{ padding: '0.4rem 0.75rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', cursor: 'pointer', fontSize: 13 }}>
                Refresh
              </button>
            </div>
          </div>

          {loadingNotifs ? (
            <p style={{ color: 'var(--muted)' }}>Loading...</p>
          ) : notifications.length === 0 ? (
            <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--muted)' }}>
              No notifications.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {notifications.map(n => {
                const typeColor = n.type === 'warning' ? '#f59e0b' : n.type === 'consent_request' ? '#3b82f6' : n.type === 'success' ? '#10b981' : '#6b7280'
                const canReviewRequest = n.type === 'consent_request'
                return (
                  <div key={n.id} style={{ ...cardStyle, opacity: n.read ? 0.7 : 1, borderLeftWidth: n.read ? 1 : 4, borderLeftColor: n.read ? 'var(--border)' : typeColor }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <div>
                        <div style={{ fontWeight: n.read ? 400 : 600, fontSize: 14, marginBottom: 4 }}>
                          {n.title}
                          {!n.read && <span style={{ ...badgeStyle(typeColor), marginLeft: 8 }}>NEW</span>}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{n.message}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                          {new Date(n.created_at).toLocaleString()}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                        {canReviewRequest && (
                          <button onClick={() => handleOpenNotificationRequest(n)} style={{ padding: '0.3rem 0.5rem', border: '1px solid rgba(59,130,246,0.35)', borderRadius: 4, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap', fontWeight: 600 }}>
                            Review request
                          </button>
                        )}
                        {!n.read && (
                          <button onClick={() => handleNotifRead(n.id)} style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}>
                            Mark read
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
