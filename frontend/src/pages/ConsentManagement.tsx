import { useState, useEffect, useCallback } from 'react'
import { 
  listConsents, 
  grantConsent, 
  revokeConsent, 
  ConsentItem,
  listPatients,
  searchPatients,
  type Patient,
  listFiles,
  type FileInfo
} from '../api/client'

interface ConsentNode {
  id: string
  type: 'file' | 'category' | 'global'
  name: string
  description: string
  children?: ConsentNode[]
  consents: ConsentItem[]
  status: 'granted' | 'partial' | 'denied' | 'expired'
}

export function ConsentManagement() {
  const [consents, setConsents] = useState<ConsentItem[]>([])
  const [consentTree, setConsentTree] = useState<ConsentNode[]>([])
  const [selectedNode, setSelectedNode] = useState<ConsentNode | null>(null)
  const [showGrantDialog, setShowGrantDialog] = useState(false)
  const [activeTab, setActiveTab] = useState<'hierarchy' | 'list'>('hierarchy')
  const [newConsent, setNewConsent] = useState({
    subject_id: '',
    scope: '',
    granted_to_role: '',
    granted_to_user_id: '',
    expires_at: ''
  })

  // Patient search and file selection
  const [patients, setPatients] = useState<Patient[]>([])
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [patientSearchForm, setPatientSearchForm] = useState({
    full_name: '',
    email: '',
    phone: ''
  })
  const [patientFiles, setPatientFiles] = useState<FileInfo[]>([])
  const [selectedFiles, setSelectedFiles] = useState<number[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [searchingPatients, setSearchingPatients] = useState(false)
  const [revokingId, setRevokingId] = useState<number | null>(null)

  const loadConsents = async () => {
    try {
      const data = await listConsents()
      setConsents(data)
    } catch (error) {
      console.error('Failed to load consents:', error)
    }
  }

  const loadPatients = async () => {
    setSearchingPatients(true)
    try {
      const data = await listPatients(searchQuery)
      setPatients(data)
    } catch (err) {
      console.error('Failed to load patients:', err)
    } finally {
      setSearchingPatients(false)
    }
  }

  const handlePatientSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!patientSearchForm.full_name) {
      alert('Patient name is required')
      return
    }
    
    setSearchingPatients(true)
    try {
      const results = await searchPatients(patientSearchForm)
      setPatients(results)
    } catch (err) {
      alert('Patient search failed: ' + (err as Error).message)
    } finally {
      setSearchingPatients(false)
    }
  }

  const loadPatientFiles = async (patient: Patient) => {
    setLoadingFiles(true)
    try {
      const response = await listFiles(patient.id)
      setPatientFiles(response.files)
    } catch (err) {
      console.error('Failed to load patient files:', err)
    } finally {
      setLoadingFiles(false)
    }
  }

  const handleSelectPatient = (patient: Patient) => {
    setSelectedPatient(patient)
    setSelectedFiles([])
    loadPatientFiles(patient)
  }

  const toggleFileSelection = (fileId: number) => {
    setSelectedFiles(prev => 
      prev.includes(fileId)
        ? prev.filter(id => id !== fileId)
        : [...prev, fileId]
    )
  }

  const toggleAllFiles = () => {
    if (selectedFiles.length === patientFiles.length) {
      setSelectedFiles([])
    } else {
      setSelectedFiles(patientFiles.map(f => f.id))
    }
  }

  const getNodeStatus = (nodeConsents: ConsentItem[]): ConsentNode['status'] => {
    if (nodeConsents.length === 0) return 'denied'

    const now = new Date()
    const activeConsents = nodeConsents.filter(c =>
      !c.revoked_at && (!c.expires_at || new Date(c.expires_at) > now)
    )

    if (activeConsents.length > 0) return 'granted'
    if (nodeConsents.some(c => c.revoked_at)) return 'denied'
    return 'expired'
  }

  const buildConsentTree = useCallback(() => {
    // Build consent tree dynamically from actual consent data
    // Group consents by scope and create hierarchical structure
    const scopeGroups = consents.reduce((acc, consent) => {
      const scope = consent.scope || 'global'
      if (!acc[scope]) acc[scope] = []
      acc[scope].push(consent)
      return acc
    }, {} as Record<string, ConsentItem[]>)

    const tree: ConsentNode[] = [
      {
        id: 'global',
        type: 'global',
        name: 'All Medical Records',
        description: 'Complete access to all medical images and records',
        consents: consents.filter(c => !c.subject_id),
        status: getNodeStatus(consents.filter(c => !c.subject_id))
      }
    ]

    // Create category nodes from scopes
    Object.entries(scopeGroups).forEach(([scope, scopeConsents]) => {
      if (scope !== 'global' && scopeConsents.length > 0) {
        tree.push({
          id: scope.toLowerCase().replace(/\s+/g, '-'),
          type: 'category',
          name: scope,
          description: `Access to ${scope} medical imaging`,
          consents: scopeConsents,
          status: getNodeStatus(scopeConsents)
        })
      }
    })

    // Calculate parent statuses based on children
    const calculateParentStatus = (node: ConsentNode): ConsentNode => {
      if (node.children) {
        const childStatuses = node.children.map(calculateParentStatus).map(c => c.status)
        if (childStatuses.every(s => s === 'granted')) {
          node.status = 'granted'
        } else if (childStatuses.some(s => s === 'granted')) {
          node.status = 'partial'
        } else {
          node.status = 'denied'
        }
      }
      return node
    }

    setConsentTree(tree.map(calculateParentStatus))
  }, [consents])

  useEffect(() => {
    loadConsents()
  }, [])

  useEffect(() => {
    buildConsentTree()
  }, [consents, buildConsentTree])

  const getStatusIcon = (status: ConsentNode['status']) => {
    switch (status) {
      case 'granted': return '✅'
      case 'partial': return '⚠️'
      case 'denied': return '❌'
      case 'expired': return '⏰'
    }
  }

  const getStatusColor = (status: ConsentNode['status']) => {
    switch (status) {
      case 'granted': return '#28a745'
      case 'partial': return '#ffc107'
      case 'denied': return '#dc3545'
      case 'expired': return '#6c757d'
    }
  }

  const handleGrantConsent = async () => {
    try {
      let scope = newConsent.scope
      
      // Build scope from selected patient and files if available
      if (selectedPatient && selectedFiles.length > 0) {
        const fileScopes = selectedFiles.map(fileId => `file:${fileId}`).join(',')
        scope = `patient:${selectedPatient.id};files:${fileScopes}`
      }

      await grantConsent({
        subject_id: newConsent.subject_id ? parseInt(newConsent.subject_id) : undefined,
        scope: scope || undefined,
        granted_to_role: newConsent.granted_to_role || undefined,
        granted_to_user_id: newConsent.granted_to_user_id ? parseInt(newConsent.granted_to_user_id) : undefined,
        expires_at: newConsent.expires_at || undefined
      })

      await loadConsents()
      setShowGrantDialog(false)
      setNewConsent({
        subject_id: '',
        scope: '',
        granted_to_role: '',
        granted_to_user_id: '',
        expires_at: ''
      })
      setSelectedPatient(null)
      setSelectedFiles([])
      setPatientFiles([])
      setPatients([])
      
      alert(`✅ Consent granted for ${selectedFiles.length > 0 ? selectedFiles.length + ' file(s)' : 'all records'}!`)
    } catch (error) {
      alert('Failed to grant consent: ' + (error as Error).message)
    }
  }

  const handleRevokeConsent = async (consentId: number) => {
    if (!window.confirm('Are you sure you want to revoke this consent?')) return
    
    setRevokingId(consentId)
    try {
      await revokeConsent(consentId)
      await loadConsents()
      alert('✅ Consent revoked successfully')
    } catch (error) {
      alert('Failed to revoke consent: ' + (error as Error).message)
    } finally {
      setRevokingId(null)
    }
  }

  const renderConsentNode = (node: ConsentNode, level = 0) => (
    <div key={node.id} style={{ marginLeft: `${level * 1.5}rem` }}>
      <div
        onClick={() => setSelectedNode(node)}
        style={{
          padding: '0.75rem',
          margin: '0.25rem 0',
          background: selectedNode?.id === node.id ? 'var(--primary)' : 'var(--surface)',
          color: selectedNode?.id === node.id ? 'white' : 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: '0.5rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          transition: 'all 0.2s ease'
        }}
      >
        <span style={{ fontSize: '1.2rem' }}>{getStatusIcon(node.status)}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{node.name}</div>
          <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>{node.description}</div>
          <div style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
            {node.consents.length} active consent{node.consents.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div style={{
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          background: getStatusColor(node.status)
        }} />
      </div>

      {node.children && node.children.map(child => renderConsentNode(child, level + 1))}
    </div>
  )

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ margin: 0, color: 'var(--text)' }}>🛡️ Consent Management</h1>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--muted)' }}>
            Manage patient consents for medical data access
          </p>
        </div>
        <button
          onClick={() => setShowGrantDialog(true)}
          style={{
            padding: '0.75rem 1.5rem',
            background: 'var(--primary)',
            color: 'white',
            border: 'none',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          ➕ Grant New Consent
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
        <button
          onClick={() => setActiveTab('hierarchy')}
          style={{
            padding: '0.5rem 1rem',
            background: activeTab === 'hierarchy' ? 'var(--primary)' : 'transparent',
            color: activeTab === 'hierarchy' ? 'white' : 'var(--text)',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: activeTab === 'hierarchy' ? 600 : 400
          }}
        >
          Hierarchy View
        </button>
        <button
          onClick={() => setActiveTab('list')}
          style={{
            padding: '0.5rem 1rem',
            background: activeTab === 'list' ? 'var(--primary)' : 'transparent',
            color: activeTab === 'list' ? 'white' : 'var(--text)',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: activeTab === 'list' ? 600 : 400
          }}
        >
          Manage Consents ({consents.length})
        </button>
      </div>

      {/* Hierarchy View */}
      {activeTab === 'hierarchy' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '2rem' }}>
          {/* Consent Tree */}
          <div>
            <h2>Consent Hierarchy</h2>
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '0.5rem',
              padding: '1rem',
              maxHeight: '600px',
              overflowY: 'auto'
            }}>
              {consentTree.map(node => renderConsentNode(node))}
            </div>
          </div>

          {/* Details Panel */}
          <div>
            <h2>Details & Actions</h2>
            {selectedNode ? (
              <div style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '0.5rem',
                padding: '1rem'
              }}>
                <div style={{ marginBottom: '1rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--primary)' }}>
                    {getStatusIcon(selectedNode.status)} {selectedNode.name}
                  </h3>
                  <p style={{ margin: 0, color: 'var(--muted)' }}>{selectedNode.description}</p>
                  <div style={{
                    display: 'inline-block',
                    marginTop: '0.5rem',
                    padding: '0.25rem 0.75rem',
                    background: getStatusColor(selectedNode.status),
                    color: 'white',
                  borderRadius: '1rem',
                  fontSize: '0.9rem',
                  fontWeight: 'bold'
                }}>
                  {selectedNode.status.toUpperCase()}
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <h4>Active Consents ({selectedNode.consents.length})</h4>
                {selectedNode.consents.length === 0 ? (
                  <p style={{ color: 'var(--muted)', fontStyle: 'italic' }}>No active consents</p>
                ) : (
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {selectedNode.consents.map(consent => (
                      <div
                        key={consent.id}
                        style={{
                          background: 'var(--hover)',
                          padding: '0.75rem',
                          margin: '0.5rem 0',
                          borderRadius: '0.25rem',
                          border: '1px solid var(--border)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>
                              {consent.granted_to_role ? `Role: ${consent.granted_to_role}` :
                               consent.granted_to_user_id ? `User ID: ${consent.granted_to_user_id}` : 'Unknown'}
                            </div>
                            <div style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
                              Granted: {new Date(consent.granted_at).toLocaleString()}
                              {consent.expires_at && ` • Expires: ${new Date(consent.expires_at).toLocaleString()}`}
                            </div>
                          </div>
                          {!consent.revoked_at && (
                            <button
                              onClick={() => handleRevokeConsent(consent.id)}
                              style={{
                                padding: '0.25rem 0.5rem',
                                background: 'var(--error)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '0.25rem',
                                cursor: 'pointer',
                                fontSize: '0.8rem'
                              }}
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '0.5rem',
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--muted)'
            }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</div>
              <p>Select a consent category to view details</p>
            </div>
          )}
        </div>
      </div>
      )}

      {/* List View - Manage Consents */}
      {activeTab === 'list' && (
        <div>
          <h2>All Consents</h2>
          {consents.length === 0 ? (
            <div style={{
              padding: '3rem',
              textAlign: 'center',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '0.5rem',
              color: 'var(--muted)'
            }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</div>
              <p>No consents granted yet. Click "Grant New Consent" to get started.</p>
            </div>
          ) : (
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '0.5rem',
              overflowX: 'auto'
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', background: 'var(--hover)' }}>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>ID</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>Scope</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>Granted To</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>Granted At</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>Expires At</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '1rem', textAlign: 'center', fontWeight: 600 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {consents.map((consent, index) => {
                    const isRevoked = !!consent.revoked_at
                    const isExpired = consent.expires_at && new Date(consent.expires_at) < new Date()
                    const isActive = !isRevoked && !isExpired

                    return (
                      <tr
                        key={consent.id}
                        style={{
                          borderBottom: index < consents.length - 1 ? '1px solid var(--border)' : 'none',
                          background: isActive ? 'transparent' : 'var(--hover)',
                          opacity: isActive ? 1 : 0.6
                        }}
                      >
                        <td style={{ padding: '0.75rem', fontWeight: 500 }}>#{consent.id}</td>
                        <td style={{ padding: '0.75rem' }}>
                          <div style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {consent.scope || `File ${consent.subject_id}` || 'All records'}
                          </div>
                          {consent.scope && consent.scope.includes('patient:') && (
                            <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                              {consent.scope.includes('files:') ? '📁 Specific files' : '📂 All files'}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          {consent.granted_to_role && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span>{consent.granted_to_role === 'doctor' ? '👨‍⚕️' : consent.granted_to_role === 'admin' ? '🛡️' : '🏥'}</span>
                              <span style={{ textTransform: 'capitalize' }}>{consent.granted_to_role}</span>
                            </div>
                          )}
                          {consent.granted_to_user_id && !consent.granted_to_role && (
                            <div>User ID: {consent.granted_to_user_id}</div>
                          )}
                          {!consent.granted_to_role && !consent.granted_to_user_id && (
                            <span style={{ color: 'var(--muted)' }}>Unknown</span>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.9rem' }}>
                          {new Date(consent.granted_at).toLocaleString()}
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.9rem' }}>
                          {consent.expires_at ? (
                            <div>
                              {new Date(consent.expires_at).toLocaleString()}
                              {isExpired && <div style={{ color: 'var(--error)', fontSize: '0.8rem', marginTop: '0.25rem' }}>⏰ Expired</div>}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--muted)' }}>No expiration</span>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          {isRevoked ? (
                            <span style={{
                              padding: '0.25rem 0.75rem',
                              background: 'rgba(239, 68, 68, 0.1)',
                              color: 'var(--error)',
                              borderRadius: '1rem',
                              fontSize: '0.85rem',
                              fontWeight: 600
                            }}>
                              ❌ Revoked
                            </span>
                          ) : isExpired ? (
                            <span style={{
                              padding: '0.25rem 0.75rem',
                              background: 'rgba(156, 163, 175, 0.1)',
                              color: 'var(--muted)',
                              borderRadius: '1rem',
                              fontSize: '0.85rem',
                              fontWeight: 600
                            }}>
                              ⏰ Expired
                            </span>
                          ) : (
                            <span style={{
                              padding: '0.25rem 0.75rem',
                              background: 'rgba(34, 197, 94, 0.1)',
                              color: '#22c55e',
                              borderRadius: '1rem',
                              fontSize: '0.85rem',
                              fontWeight: 600
                            }}>
                              ✅ Active
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                          {isActive ? (
                            <button
                              onClick={() => handleRevokeConsent(consent.id)}
                              disabled={revokingId === consent.id}
                              style={{
                                padding: '0.5rem 1rem',
                                background: 'var(--error)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '0.25rem',
                                cursor: revokingId === consent.id ? 'not-allowed' : 'pointer',
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                opacity: revokingId === consent.id ? 0.6 : 1
                              }}
                            >
                              {revokingId === consent.id ? 'Revoking...' : '🚫 Revoke'}
                            </button>
                          ) : (
                            <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Grant Consent Dialog */}
      {showGrantDialog && (
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
          padding: '2rem',
          overflowY: 'auto'
        }}>
          <div style={{
            background: 'var(--surface)',
            borderRadius: '0.5rem',
            padding: '2rem',
            width: '100%',
            maxWidth: '700px',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <h2>Grant New Consent</h2>
            
            {/* Patient Search Section */}
            <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'var(--bg)', borderRadius: '0.5rem', border: '1px solid var(--border)' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>🔍 Search Patient (Optional)</h3>
              
              {/* DPA-compliant search form */}
              <form onSubmit={handlePatientSearch} style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <input
                    type="text"
                    placeholder="Full Name"
                    value={patientSearchForm.full_name}
                    onChange={(e) => setPatientSearchForm({ ...patientSearchForm, full_name: e.target.value })}
                    style={{
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '0.25rem'
                    }}
                  />
                  <input
                    type="email"
                    placeholder="Email (optional)"
                    value={patientSearchForm.email}
                    onChange={(e) => setPatientSearchForm({ ...patientSearchForm, email: e.target.value })}
                    style={{
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '0.25rem'
                    }}
                  />
                </div>
                <input
                  type="tel"
                  placeholder="Phone (optional)"
                  value={patientSearchForm.phone}
                  onChange={(e) => setPatientSearchForm({ ...patientSearchForm, phone: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border)',
                    borderRadius: '0.25rem',
                    marginBottom: '0.75rem'
                  }}
                />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button 
                    type="submit" 
                    disabled={searchingPatients} 
                    style={{ 
                      padding: '0.5rem 1rem', 
                      background: 'var(--primary)', 
                      color: 'white', 
                      border: 'none', 
                      borderRadius: '0.25rem', 
                      cursor: 'pointer' 
                    }}
                  >
                    {searchingPatients ? 'Searching...' : 'Search Patient'}
                  </button>
                  <input
                    type="text"
                    placeholder="Quick search by name or MRN..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '0.25rem'
                    }}
                  />
                  <button 
                    type="button"
                    onClick={loadPatients} 
                    disabled={searchingPatients} 
                    style={{ 
                      padding: '0.5rem 1rem', 
                      background: 'var(--primary)', 
                      color: 'white', 
                      border: 'none', 
                      borderRadius: '0.25rem' 
                    }}
                  >
                    Quick Search
                  </button>
                </div>
              </form>

              {/* Patient Results */}
              {patients.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Select Patient:</h4>
                  <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '0.25rem' }}>
                    {patients.map(patient => (
                      <div
                        key={patient.id}
                        onClick={() => handleSelectPatient(patient)}
                        style={{
                          padding: '0.75rem',
                          background: selectedPatient?.id === patient.id ? 'var(--primary)' : 'transparent',
                          color: selectedPatient?.id === patient.id ? 'white' : 'var(--text)',
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer'
                        }}
                      >
                        <strong>{patient.full_name}</strong>
                        {patient.medical_record_number && <span style={{ fontSize: 13, opacity: 0.8, marginLeft: '0.5rem' }}>MRN: {patient.medical_record_number}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* File Selection */}
              {selectedPatient && (
                <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--surface)', borderRadius: '0.25rem', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h4 style={{ margin: 0, fontSize: '0.9rem' }}>📁 Select Files for {selectedPatient.full_name}</h4>
                    <button
                      type="button"
                      onClick={toggleAllFiles}
                      disabled={patientFiles.length === 0}
                      style={{ 
                        padding: '0.25rem 0.75rem', 
                        background: 'transparent',
                        border: '1px solid var(--border)',
                        borderRadius: '0.25rem',
                        cursor: patientFiles.length > 0 ? 'pointer' : 'not-allowed',
                        fontSize: 12
                      }}
                    >
                      {selectedFiles.length === patientFiles.length && patientFiles.length > 0 ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>

                  {loadingFiles ? (
                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--muted)' }}>Loading files...</div>
                  ) : patientFiles.length === 0 ? (
                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--muted)', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '0.25rem' }}>
                      No files found for this patient
                    </div>
                  ) : (
                    <>
                      <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '0.25rem', background: 'var(--bg)' }}>
                        {patientFiles.map(file => (
                          <label
                            key={file.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.75rem',
                              padding: '0.75rem',
                              borderBottom: '1px solid var(--border)',
                              cursor: 'pointer',
                              background: selectedFiles.includes(file.id) ? 'rgba(59, 130, 246, 0.1)' : 'transparent'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedFiles.includes(file.id)}
                              onChange={() => toggleFileSelection(file.id)}
                              style={{ width: 16, height: 16, cursor: 'pointer' }}
                            />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 500, fontSize: 14 }}>{file.filename}</div>
                              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: '0.25rem' }}>
                                {(file.size / 1024 / 1024).toFixed(2)} MB • {new Date(file.upload_timestamp).toLocaleDateString()}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                      {selectedFiles.length > 0 && (
                        <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '0.25rem', fontSize: 13, color: '#22c55e' }}>
                          ✓ {selectedFiles.length} file(s) selected
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Traditional Fields */}
            <div style={{ display: 'grid', gap: '1rem' }}>
              {!selectedPatient && (
                <>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                      Subject/File ID (optional)
                    </label>
                    <input
                      type="number"
                      placeholder="Leave empty for global consent"
                      value={newConsent.subject_id}
                      onChange={(e) => setNewConsent(prev => ({ ...prev, subject_id: e.target.value }))}
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
                      Scope
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., chest, neuro, all"
                      value={newConsent.scope}
                      onChange={(e) => setNewConsent(prev => ({ ...prev, scope: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: '1px solid var(--border)',
                        borderRadius: '0.25rem'
                      }}
                    />
                  </div>
                </>
              )}

              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                  Grant to Role
                </label>
                <select
                  value={newConsent.granted_to_role}
                  onChange={(e) => setNewConsent(prev => ({ ...prev, granted_to_role: e.target.value }))}
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
                  placeholder="User ID"
                  value={newConsent.granted_to_user_id}
                  onChange={(e) => setNewConsent(prev => ({ ...prev, granted_to_user_id: e.target.value }))}
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
                  value={newConsent.expires_at}
                  onChange={(e) => setNewConsent(prev => ({ ...prev, expires_at: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border)',
                    borderRadius: '0.25rem'
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button
                  onClick={handleGrantConsent}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    background: 'var(--primary)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0.25rem',
                    cursor: 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  {selectedFiles.length > 0 ? `✅ Grant for ${selectedFiles.length} file(s)` : '✅ Grant Consent'}
                </button>
                <button
                  onClick={() => {
                    setShowGrantDialog(false)
                    setSelectedPatient(null)
                    setSelectedFiles([])
                    setPatientFiles([])
                    setPatients([])
                  }}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    background: 'var(--error)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0.25rem',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}