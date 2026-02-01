import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  Patient, 
  listPatients, 
  searchPatients, 
  ConsentItem, 
  listConsents, 
  grantConsent, 
  revokeConsent,
  listAccessRequests,
  approveAccessRequest,
  denyAccessRequest,
  AccessRequest,
  FileInfo,
  listFiles
} from '../api/client'
import { useAuth } from '../contexts/AuthContext'

export function ShareAccessPatient() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'patients' | 'share' | 'requests'>('patients')
  
  // Patient management
  const [patients, setPatients] = useState<Patient[]>([])
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  
  // Patient search form
  const [patientSearchForm, setPatientSearchForm] = useState({
    full_name: '',
    email: '',
    phone: ''
  })
  
  // Share/Consent management
  const [consents, setConsents] = useState<ConsentItem[]>([])
  const [patientFiles, setPatientFiles] = useState<FileInfo[]>([])
  const [selectedFiles, setSelectedFiles] = useState<number[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [newShare, setNewShare] = useState({
    scope: 'patient',
    granted_to_role: '',
    granted_to_user_id: '',
    expires_days: 30,
    granted_to_hospital_id: '',
    granted_to_hospital_name: ''
  })
  
  // Available hospitals for federation
  const [hospitals] = useState([
    { id: 'hospital-a', name: 'Hospital A - General' },
    { id: 'hospital-b', name: 'Hospital B - Cardiac Center' },
    { id: 'hospital-c', name: 'Hospital C - Research Institute' },
    { id: 'hospital-d', name: 'Hospital D - Pediatric Care' }
  ])
  
  // Access requests
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load patients on mount
  useEffect(() => {
    loadPatients()
    loadAccessRequests()
  }, [])

  // Load consents and files when patient is selected
  useEffect(() => {
    if (selectedPatient) {
      loadConsents()
      loadPatientFiles()
    } else {
      setPatientFiles([])
      setSelectedFiles([])
    }
  }, [selectedPatient])

  const loadPatients = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listPatients(searchQuery)
      setPatients(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load patients')
    } finally {
      setLoading(false)
    }
  }

  const handlePatientSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!patientSearchForm.full_name) {
      setError('Patient name is required')
      return
    }
    
    setLoading(true)
    setError(null)
    try {
      const results = await searchPatients(patientSearchForm)
      setPatients(results)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Patient search failed')
    } finally {
      setLoading(false)
    }
  }

  const loadConsents = async () => {
    if (!selectedPatient) return
    
    try {
      const allConsents = await listConsents()
      // Filter consents for this patient
      const patientConsents = allConsents.filter(c => 
        c.scope?.includes(`patient:${selectedPatient.id}`)
      )
      setConsents(patientConsents)
    } catch (err) {
      console.error('Failed to load consents:', err)
    }
  }

  const loadPatientFiles = async () => {
    if (!selectedPatient) return
    
    setLoadingFiles(true)
    try {
      const response = await listFiles(selectedPatient.id)
      setPatientFiles(response.files)
    } catch (err) {
      console.error('Failed to load patient files:', err)
      setError('Failed to load patient files')
    } finally {
      setLoadingFiles(false)
    }
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

  const loadAccessRequests = async () => {
    try {
      const response = await listAccessRequests()
      setAccessRequests(response.requests)
    } catch (err) {
      console.error('Failed to load access requests:', err)
    }
  }

  const handleGrantAccess = async () => {
    if (!selectedPatient) {
      setError('Please select a patient first')
      return
    }

    if (selectedFiles.length === 0) {
      setError('Please select at least one file to grant access to')
      return
    }

    if (!newShare.granted_to_role && !newShare.granted_to_user_id && !newShare.granted_to_hospital_id) {
      setError('Please specify recipient role, user ID, or target hospital')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + newShare.expires_days)

      // Create scope with patient and file IDs
      const fileScopes = selectedFiles.map(fileId => `file:${fileId}`).join(',')
      const scope = `patient:${selectedPatient.id};files:${fileScopes}`

      await grantConsent({
        scope: scope,
        granted_to_role: newShare.granted_to_role || undefined,
        granted_to_user_id: newShare.granted_to_user_id ? parseInt(newShare.granted_to_user_id) : undefined,
        granted_to_hospital_id: newShare.granted_to_hospital_id || undefined,
        granted_to_hospital_name: newShare.granted_to_hospital_name || undefined,
        expires_at: expiresAt.toISOString()
      })

      await loadConsents()
      setSelectedFiles([])
      setNewShare({
        scope: 'patient',
        granted_to_role: '',
        granted_to_user_id: '',
        expires_days: 30,
        granted_to_hospital_id: '',
        granted_to_hospital_name: ''
      })
      
      alert(`✅ Access granted for ${selectedFiles.length} file(s)!`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grant access')
    } finally {
      setLoading(false)
    }
  }

  const handleRevokeAccess = async (consentId: number) => {
    if (!confirm('Are you sure you want to revoke this access?')) return

    try {
      await revokeConsent(consentId)
      await loadConsents()
      alert('✅ Access revoked successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke access')
    }
  }

  const handleRequestAction = async (requestId: number, approve: boolean) => {
    try {
      if (approve) {
        await approveAccessRequest(requestId, 30)
      } else {
        await denyAccessRequest(requestId)
      }
      await loadAccessRequests()
      alert(approve ? '✅ Request approved' : '✅ Request denied')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process request')
    }
  }

  const canManagePatients = user?.role === 'doctor' || user?.role === 'admin'

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0 }}>Patient-Centered Access Sharing</h1>
        <button onClick={() => navigate('/files')} style={{ padding: '0.5rem 1rem' }}>
          ← Back to Files
        </button>
      </div>

      {error && (
        <div style={{ padding: '1rem', marginBottom: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8, color: '#ef4444' }}>
          {error}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
        <button
          onClick={() => setActiveTab('patients')}
          style={{
            padding: '0.5rem 1rem',
            background: activeTab === 'patients' ? 'var(--accent)' : 'transparent',
            color: activeTab === 'patients' ? 'white' : 'var(--text)',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: activeTab === 'patients' ? 600 : 400
          }}
        >
          Patients
        </button>
        <button
          onClick={() => setActiveTab('share')}
          disabled={!selectedPatient}
          style={{
            padding: '0.5rem 1rem',
            background: activeTab === 'share' ? 'var(--accent)' : 'transparent',
            color: activeTab === 'share' ? 'white' : 'var(--text)',
            border: 'none',
            borderRadius: 6,
            cursor: selectedPatient ? 'pointer' : 'not-allowed',
            fontWeight: activeTab === 'share' ? 600 : 400,
            opacity: selectedPatient ? 1 : 0.5
          }}
        >
          Share Access
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          style={{
            padding: '0.5rem 1rem',
            background: activeTab === 'requests' ? 'var(--accent)' : 'transparent',
            color: activeTab === 'requests' ? 'white' : 'var(--text)',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: activeTab === 'requests' ? 600 : 400
          }}
        >
          Access Requests ({accessRequests.filter(r => r.status === 'pending').length})
        </button>
      </div>

      {/* Patients Tab */}
      {activeTab === 'patients' && (
        <div>
          {/* Patient Search */}
          <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: 18 }}>Search Patient</h2>
            <form onSubmit={handlePatientSearch} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <input
                  type="text"
                  placeholder="Full Name *"
                  value={patientSearchForm.full_name}
                  onChange={(e) => setPatientSearchForm({ ...patientSearchForm, full_name: e.target.value })}
                  style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
                  required
                />
                <input
                  type="email"
                  placeholder="Email (optional)"
                  value={patientSearchForm.email}
                  onChange={(e) => setPatientSearchForm({ ...patientSearchForm, email: e.target.value })}
                  style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
                />
              </div>
              <input
                type="tel"
                placeholder="Phone (optional)"
                value={patientSearchForm.phone}
                onChange={(e) => setPatientSearchForm({ ...patientSearchForm, phone: e.target.value })}
                style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
              />
              <button type="submit" disabled={loading} style={{ padding: '0.75rem', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                {loading ? 'Searching...' : 'Search Patient (DPA-Compliant)'}
              </button>
            </form>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: '0.5rem' }}>
              DPA-compliant search using name+email, name+phone, or name+email+phone combinations
            </p>
          </div>

          {/* Simple Search */}
          <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
            <input
              type="text"
              placeholder="Quick search by name or MRN..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ flex: 1, padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
            />
            <button onClick={loadPatients} disabled={loading} style={{ padding: '0.5rem 1rem', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 6 }}>
              Search
            </button>
          </div>

          {/* Patient List */}
          <div style={{ display: 'grid', gap: '1rem' }}>
            {patients.map(patient => (
              <div
                key={patient.id}
                onClick={() => setSelectedPatient(patient)}
                style={{
                  padding: '1rem',
                  background: selectedPatient?.id === patient.id ? 'var(--accent)' : 'var(--surface)',
                  color: selectedPatient?.id === patient.id ? 'white' : 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div>
                    <strong style={{ fontSize: 16 }}>{patient.full_name}</strong>
                    {patient.medical_record_number && (
                      <div style={{ fontSize: 13, opacity: 0.8, marginTop: '0.25rem' }}>
                        MRN: {patient.medical_record_number}
                      </div>
                    )}
                    {patient.email && (
                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: '0.25rem' }}>
                        {patient.email}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13 }}>{patient.file_count} files</div>
                    {patient.phone && (
                      <div style={{ fontSize: 11, opacity: 0.7 }}>{patient.phone}</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {patients.length === 0 && !loading && (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
              No patients found. Use the search above to find patients.
            </div>
          )}
        </div>
      )}

      {/* Share Access Tab */}
      {activeTab === 'share' && selectedPatient && (
        <div>
          <div style={{ padding: '1rem', marginBottom: '1.5rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <strong>Selected Patient:</strong> {selectedPatient.full_name}
            {selectedPatient.medical_record_number && ` (MRN: ${selectedPatient.medical_record_number})`}
          </div>

          {/* Grant Access Form */}
          {canManagePatients && (
            <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <h2 style={{ margin: '0 0 1rem', fontSize: 18 }}>🏥 Grant Access (Including Cross-Hospital Federation)</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                
                <div style={{ padding: '1rem', background: 'rgba(59, 130, 246, 0.1)', borderRadius: 6, border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                  <strong style={{ color: '#3b82f6', fontSize: 14 }}>Cross-Hospital Federation</strong>
                  <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0.5rem 0 0' }}>
                    Grant access to another hospital in the network. Users from the target hospital can request data using their name+email or name+phone.
                  </p>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: 14, fontWeight: 600 }}>
                    Target Hospital (for federated sharing)
                  </label>
                  <select
                    value={newShare.granted_to_hospital_id}
                    onChange={(e) => {
                      const hospital = hospitals.find(h => h.id === e.target.value)
                      setNewShare({ 
                        ...newShare, 
                        granted_to_hospital_id: e.target.value,
                        granted_to_hospital_name: hospital?.name || ''
                      })
                    }}
                    style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', width: '100%' }}
                  >
                    <option value="">-- Select Hospital (optional) --</option>
                    {hospitals.map(h => (
                      <option key={h.id} value={h.id}>{h.name}</option>
                    ))}
                  </select>
                  <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0.5rem 0 0' }}>
                    Leave empty for local sharing within your hospital
                  </p>
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: 14, fontWeight: 600 }}>
                    Or Grant by Role (local)
                  </label>
                  <select
                    value={newShare.granted_to_role}
                    onChange={(e) => setNewShare({ ...newShare, granted_to_role: e.target.value })}
                    style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', width: '100%' }}
                    disabled={!!newShare.granted_to_hospital_id}
                  >
                    <option value="">Select Role</option>
                    <option value="doctor">Doctor</option>
                    <option value="patient">Patient</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: 14, fontWeight: 600 }}>
                    Or Specific User ID (local)
                  </label>
                  <input
                    type="number"
                    placeholder="Enter specific User ID"
                    value={newShare.granted_to_user_id}
                    onChange={(e) => setNewShare({ ...newShare, granted_to_user_id: e.target.value })}
                    style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', width: '100%' }}
                    disabled={!!newShare.granted_to_hospital_id}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: 14, fontWeight: 600 }}>
                    Access Duration (days)
                  </label>
                  <input
                    type="number"
                    value={newShare.expires_days}
                    onChange={(e) => setNewShare({ ...newShare, expires_days: parseInt(e.target.value) || 30 })}
                    style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', width: '100%' }}
                    min="1"
                    max="365"
                  />
                </div>

                {/* File Selection */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <label style={{ fontSize: 14, fontWeight: 600 }}>
                      📁 Select Files to Grant Access *
                    </label>
                    <button
                      type="button"
                      onClick={toggleAllFiles}
                      disabled={patientFiles.length === 0}
                      style={{ 
                        padding: '0.25rem 0.75rem', 
                        background: 'transparent',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                        cursor: patientFiles.length > 0 ? 'pointer' : 'not-allowed',
                        fontSize: 12
                      }}
                    >
                      {selectedFiles.length === patientFiles.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  
                  {loadingFiles ? (
                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--muted)' }}>
                      Loading patient files...
                    </div>
                  ) : patientFiles.length === 0 ? (
                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--muted)', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 6 }}>
                      No files found for this patient. Upload files first before granting access.
                    </div>
                  ) : (
                    <div style={{ 
                      maxHeight: 300, 
                      overflowY: 'auto', 
                      border: '1px solid var(--border)', 
                      borderRadius: 6,
                      background: 'var(--bg)'
                    }}>
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
                            background: selectedFiles.includes(file.id) ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                            transition: 'background 0.2s'
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
                              {file.description && ` • ${file.description}`}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                  
                  {selectedFiles.length > 0 && (
                    <div style={{ 
                      marginTop: '0.5rem', 
                      padding: '0.5rem', 
                      background: 'rgba(34, 197, 94, 0.1)', 
                      borderRadius: 4,
                      fontSize: 13,
                      color: '#22c55e'
                    }}>
                      ✓ {selectedFiles.length} file(s) selected for consent
                    </div>
                  )}
                </div>

                <button
                  onClick={handleGrantAccess}
                  disabled={loading || selectedFiles.length === 0 || (!newShare.granted_to_role && !newShare.granted_to_user_id && !newShare.granted_to_hospital_id)}
                  style={{
                    padding: '0.75rem',
                    background: 'var(--accent)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600,
                    opacity: loading || (!newShare.granted_to_role && !newShare.granted_to_user_id) ? 0.5 : 1
                  }}
                >
                  Grant Access
                </button>
              </div>
            </div>
          )}

          {/* Existing Consents */}
          <div style={{ padding: '1.5rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: 18 }}>Active Consents</h2>
            {consents.length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>No active consents for this patient</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {consents.map(consent => (
                  <div
                    key={consent.id}
                    style={{
                      padding: '1rem',
                      background: 'var(--background)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {consent.granted_to_role ? `Role: ${consent.granted_to_role}` : `User ID: ${consent.granted_to_user_id}`}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: '0.25rem' }}>
                        Granted: {new Date(consent.granted_at).toLocaleDateString()}
                        {consent.expires_at && ` • Expires: ${new Date(consent.expires_at).toLocaleDateString()}`}
                      </div>
                    </div>
                    {canManagePatients && (
                      <button
                        onClick={() => handleRevokeAccess(consent.id)}
                        style={{
                          padding: '0.5rem 0.75rem',
                          background: 'rgba(239, 68, 68, 0.1)',
                          color: '#ef4444',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontSize: 13
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Access Requests Tab */}
      {activeTab === 'requests' && (
        <div>
          <h2 style={{ marginTop: 0, marginBottom: '1rem', fontSize: 18 }}>Pending Access Requests</h2>
          {accessRequests.filter(r => r.status === 'pending').length === 0 ? (
            <p style={{ color: 'var(--muted)' }}>No pending access requests</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {accessRequests
                .filter(r => r.status === 'pending')
                .map(request => (
                  <div
                    key={request.id}
                    style={{
                      padding: '1rem',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 8
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                      <div>
                        <strong>{request.requester_email}</strong>
                        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                          Role: {request.requester_role}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {new Date(request.requested_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{ fontSize: 14, marginBottom: '1rem' }}>
                      <strong>Reason:</strong> {request.reason}
                    </div>
                    {canManagePatients && (
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleRequestAction(request.id, true)}
                          style={{
                            padding: '0.5rem 1rem',
                            background: 'rgba(16, 185, 129, 0.1)',
                            color: '#10b981',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            borderRadius: 6,
                            cursor: 'pointer',
                            fontWeight: 500
                          }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleRequestAction(request.id, false)}
                          style={{
                            padding: '0.5rem 1rem',
                            background: 'rgba(239, 68, 68, 0.1)',
                            color: '#ef4444',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: 6,
                            cursor: 'pointer',
                            fontWeight: 500
                          }}
                        >
                          Deny
                        </button>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
