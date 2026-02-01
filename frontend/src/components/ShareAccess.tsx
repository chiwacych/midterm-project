import { useState, useEffect } from 'react'
import { FileInfo, ConsentItem, listConsents, grantConsent, revokeConsent, listAccessRequests, approveAccessRequest, denyAccessRequest } from '../api/client'

interface ShareRequest {
  id: string
  fileId: number
  requesterName: string
  requesterRole: string
  requestReason: string
  requestedAt: string
  status: 'pending' | 'approved' | 'denied'
  expiresAt?: string
}

interface ShareAccessProps {
  file: FileInfo
  onClose: () => void
}

export function ShareAccess({ file, onClose }: ShareAccessProps) {
  const [activeTab, setActiveTab] = useState<'share' | 'requests' | 'history'>('share')
  const [shareRequests, setShareRequests] = useState<ShareRequest[]>([])
  const [consents, setConsents] = useState<ConsentItem[]>([])
  const [, setLoading] = useState(true)
  const [newShare, setNewShare] = useState({
    recipientRole: '',
    recipientUserId: '',
    scope: 'file',
    expiresAt: '',
    reason: ''
  })

  // Fetch real access requests and consents from API
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        // Fetch access requests
        const requestsResponse = await listAccessRequests()
        const transformedRequests: ShareRequest[] = requestsResponse.requests
          .filter(r => r.file_id === file.id || r.file_id === null)
          .map(r => ({
            id: String(r.id),
            fileId: r.file_id || file.id,
            requesterName: r.requester_email,
            requesterRole: r.requester_role,
            requestReason: r.reason,
            requestedAt: r.requested_at,
            status: r.status as 'pending' | 'approved' | 'denied',
            expiresAt: r.resolved_at || undefined
          }))
        setShareRequests(transformedRequests)

        // Load existing consents
        const consentData = await listConsents()
        setConsents(consentData)
      } catch (error) {
        console.error('Failed to fetch access data:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [file.id])

  const handleShare = async () => {
    try {
      await grantConsent({
        subject_id: newShare.scope === 'file' ? file.id : undefined,
        scope: newShare.scope === 'global' ? 'all' : undefined,
        granted_to_role: newShare.recipientRole || undefined,
        granted_to_user_id: newShare.recipientUserId ? parseInt(newShare.recipientUserId) : undefined,
        expires_at: newShare.expiresAt || undefined
      })

      // Refresh consents
      const updatedConsents = await listConsents()
      setConsents(updatedConsents)

      // Reset form
      setNewShare({
        recipientRole: '',
        recipientUserId: '',
        scope: 'file',
        expiresAt: '',
        reason: ''
      })

      alert('✅ Access granted successfully!')
    } catch (error) {
      alert('❌ Failed to grant access: ' + (error as Error).message)
    }
  }

  const handleRequestResponse = async (requestId: string, approve: boolean) => {
    const request = shareRequests.find(r => r.id === requestId)
    if (!request) return

    try {
      const numericId = parseInt(requestId)
      if (approve) {
        await approveAccessRequest(numericId, 30) // 30 days expiry
      } else {
        await denyAccessRequest(numericId)
      }

      setShareRequests(prev => prev.map(r =>
        r.id === requestId
          ? { ...r, status: approve ? 'approved' : 'denied' }
          : r
      ))

      // Refresh consents
      const updatedConsents = await listConsents()
      setConsents(updatedConsents)

      alert(approve ? '✅ Access request approved!' : '❌ Access request denied!')
    } catch (error) {
      alert('❌ Failed to process request: ' + (error as Error).message)
    }
  }

  const revokeAccess = async (consentId: number) => {
    try {
      await revokeConsent(consentId)
      const updatedConsents = await listConsents()
      setConsents(updatedConsents)
      alert('✅ Access revoked successfully!')
    } catch (error) {
      alert('❌ Failed to revoke access: ' + (error as Error).message)
    }
  }

  const getStatusColor = (status: ShareRequest['status']) => {
    switch (status) {
      case 'pending': return '#ffa500'
      case 'approved': return '#28a745'
      case 'denied': return '#dc3545'
    }
  }

  const getStatusIcon = (status: ShareRequest['status']) => {
    switch (status) {
      case 'pending': return '⏳'
      case 'approved': return '✅'
      case 'denied': return '❌'
    }
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem'
    }}>
      <div style={{
        background: 'var(--surface)',
        borderRadius: '0.5rem',
        width: '100%',
        maxWidth: '800px',
        maxHeight: '90vh',
        overflow: 'hidden',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.5rem',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h2 style={{ margin: 0, color: 'var(--primary)' }}>🔗 Share Access - {file.filename}</h2>
            <p style={{ margin: '0.25rem 0 0 0', color: 'var(--muted)', fontSize: '0.9rem' }}>
              Manage who can access this medical image
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--error)',
              color: 'white',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer'
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--border)',
          background: 'var(--hover)'
        }}>
          {[
            { id: 'share', label: '📤 Grant Access', icon: '🔗' },
            { id: 'requests', label: '📨 Access Requests', icon: '📬' },
            { id: 'history', label: '📋 Access History', icon: '📜' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as 'share' | 'requests' | 'history')}
              style={{
                flex: 1,
                padding: '1rem',
                background: activeTab === tab.id ? 'var(--surface)' : 'transparent',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid var(--primary)' : 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontWeight: activeTab === tab.id ? 'bold' : 'normal'
              }}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', maxHeight: '60vh' }}>
          {activeTab === 'share' && (
            <div>
              <h3>Grant New Access</h3>
              <div style={{ display: 'grid', gap: '1rem', maxWidth: '500px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                    Scope
                  </label>
                  <select
                    value={newShare.scope}
                    onChange={(e) => setNewShare(prev => ({ ...prev, scope: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '0.25rem'
                    }}
                  >
                    <option value="file">This specific file</option>
                    <option value="global">All files (global access)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                    Grant to Role
                  </label>
                  <select
                    value={newShare.recipientRole}
                    onChange={(e) => setNewShare(prev => ({ ...prev, recipientRole: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '0.25rem'
                    }}
                  >
                    <option value="">Select role...</option>
                    <option value="doctor">👨‍⚕️ Doctor</option>
                    <option value="admin">🛡️ Administrator</option>
                    <option value="patient">🏥 Patient</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                    Or Specific User ID
                  </label>
                  <input
                    type="number"
                    placeholder="User ID (optional)"
                    value={newShare.recipientUserId}
                    onChange={(e) => setNewShare(prev => ({ ...prev, recipientUserId: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '0.25rem'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                    Expiration Date
                  </label>
                  <input
                    type="datetime-local"
                    value={newShare.expiresAt}
                    onChange={(e) => setNewShare(prev => ({ ...prev, expiresAt: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '0.25rem'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                    Reason/Notes
                  </label>
                  <textarea
                    placeholder="Why are you granting access?"
                    value={newShare.reason}
                    onChange={(e) => setNewShare(prev => ({ ...prev, reason: e.target.value }))}
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '0.25rem',
                      resize: 'vertical'
                    }}
                  />
                </div>

                <button
                  onClick={handleShare}
                  disabled={!newShare.recipientRole && !newShare.recipientUserId}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: 'var(--primary)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0.25rem',
                    cursor: (!newShare.recipientRole && !newShare.recipientUserId) ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  🔗 Grant Access
                </button>
              </div>
            </div>
          )}

          {activeTab === 'requests' && (
            <div>
              <h3>Access Requests ({shareRequests.filter(r => r.status === 'pending').length} pending)</h3>
              {shareRequests.length === 0 ? (
                <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>
                  No access requests for this file.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {shareRequests.map(request => (
                    <div
                      key={request.id}
                      style={{
                        background: 'var(--hover)',
                        padding: '1rem',
                        borderRadius: '0.5rem',
                        border: '1px solid var(--border)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <span style={{ fontSize: '1.2rem' }}>{getStatusIcon(request.status)}</span>
                            <strong>{request.requesterName}</strong>
                            <span style={{
                              background: getStatusColor(request.status),
                              color: 'white',
                              padding: '0.25rem 0.5rem',
                              borderRadius: '0.25rem',
                              fontSize: '0.8rem'
                            }}>
                              {request.status.toUpperCase()}
                            </span>
                          </div>
                          <p style={{ margin: '0.5rem 0', color: 'var(--muted)' }}>
                            {request.requesterRole} • Requested {new Date(request.requestedAt).toLocaleString()}
                          </p>
                          <p style={{ margin: '0.5rem 0' }}>{request.requestReason}</p>
                          {request.expiresAt && (
                            <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: 'var(--success)' }}>
                              Expires: {new Date(request.expiresAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                        {request.status === 'pending' && (
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                              onClick={() => handleRequestResponse(request.id, true)}
                              style={{
                                padding: '0.5rem 1rem',
                                background: 'var(--success)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '0.25rem',
                                cursor: 'pointer'
                              }}
                            >
                              ✅ Approve
                            </button>
                            <button
                              onClick={() => handleRequestResponse(request.id, false)}
                              style={{
                                padding: '0.5rem 1rem',
                                background: 'var(--error)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '0.25rem',
                                cursor: 'pointer'
                              }}
                            >
                              ❌ Deny
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div>
              <h3>Access History</h3>
              {consents.length === 0 ? (
                <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>
                  No access history available.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {consents.map(consent => (
                    <div
                      key={consent.id}
                      style={{
                        background: 'var(--hover)',
                        padding: '1rem',
                        borderRadius: '0.5rem',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>
                          {consent.granted_to_role ? `Role: ${consent.granted_to_role}` :
                            consent.granted_to_user_id ? `User ID: ${consent.granted_to_user_id}` : 'Unknown'}
                        </div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
                          Granted: {new Date(consent.granted_at).toLocaleString()}
                          {consent.expires_at && ` • Expires: ${new Date(consent.expires_at).toLocaleString()}`}
                          {consent.revoked_at && ` • Revoked: ${new Date(consent.revoked_at).toLocaleString()}`}
                        </div>
                        {consent.scope && (
                          <div style={{ fontSize: '0.9rem', color: 'var(--primary)' }}>
                            Scope: {consent.scope}
                          </div>
                        )}
                      </div>
                      {!consent.revoked_at && (
                        <button
                          onClick={() => revokeAccess(consent.id)}
                          style={{
                            padding: '0.5rem 1rem',
                            background: 'var(--error)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '0.25rem',
                            cursor: 'pointer',
                            fontSize: '0.9rem'
                          }}
                        >
                          🚫 Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}