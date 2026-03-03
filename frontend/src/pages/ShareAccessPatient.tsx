import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Patient,
  listPatients,
  searchPatients,
  ConsentItem,
  listConsents,
  revokeConsent,
  listAccessRequests,
  sendConsentRequest,
  emergencyOverride,
  proxyApproval,
  AccessRequest,
  FileInfo,
  listFiles,
  getFederationNetworkStatus,
} from '../api/client'
import { useAuth } from '../contexts/AuthContext'

type Tab = 'patients' | 'consent-request' | 'emergency' | 'proxy' | 'requests'

const tabBtn = (active: boolean, disabled = false): React.CSSProperties => ({
  padding: '0.5rem 1rem',
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? '#fff' : 'var(--text)',
  border: 'none',
  borderRadius: 6,
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontWeight: active ? 600 : 400,
  fontSize: 14,
  opacity: disabled ? 0.5 : 1,
})

const card: React.CSSProperties = {
  padding: '1.25rem',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
}

const badge = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  background: `${color}22`,
  color,
  borderRadius: 12,
  fontSize: 12,
  fontWeight: 600,
})

const inputBase: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
}

export function ShareAccessPatient() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>('patients')

  // Patient search & selection
  const [patients, setPatients] = useState<Patient[]>([])
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [patientSearchForm, setPatientSearchForm] = useState({ full_name: '', email: '', phone: '' })

  // Patient files
  const [patientFiles, setPatientFiles] = useState<FileInfo[]>([])
  const [selectedFiles, setSelectedFiles] = useState<number[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)

  // Consent request form
  const [consentReason, setConsentReason] = useState('')
  const [consentUrgency, setConsentUrgency] = useState<'normal' | 'urgent' | 'emergency'>('normal')
  const [targetHospitalId, setTargetHospitalId] = useState('')
  const [targetHospitalName, setTargetHospitalName] = useState('')

  // Emergency override form
  const [emergencyReason, setEmergencyReason] = useState('')
  const [clinicalJustification, setClinicalJustification] = useState('')

  // Proxy approval
  const [proxyReason, setProxyReason] = useState('')
  const [verificationMethod, setVerificationMethod] = useState<'verbal' | 'written' | 'witness'>('verbal')

  // Access requests
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([])

  // Federation hospitals
  const [hospitals, setHospitals] = useState<Array<{ id: string; name: string; endpoint: string; status: string }>>([])
  const [loadingHospitals, setLoadingHospitals] = useState(false)

  // Consents for selected patient
  const [consents, setConsents] = useState<ConsentItem[]>([])

  // General state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // ---- Init ----
  useEffect(() => {
    loadPatients()
    loadAccessRequests()
    loadFederationHospitals()
  }, [])

  useEffect(() => {
    if (selectedPatient) {
      loadPatientFiles()
      loadConsents()
    } else {
      setPatientFiles([])
      setSelectedFiles([])
      setConsents([])
    }
  }, [selectedPatient])

  useEffect(() => {
    if (successMsg) { const t = setTimeout(() => setSuccessMsg(null), 5000); return () => clearTimeout(t) }
  }, [successMsg])

  // ---- Loaders ----
  const loadPatients = async () => {
    setLoading(true)
    try { setPatients(await listPatients(searchQuery)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load patients') }
    finally { setLoading(false) }
  }

  const handlePatientSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!patientSearchForm.full_name) { setError('Patient name is required'); return }
    setLoading(true); setError(null)
    try { setPatients(await searchPatients(patientSearchForm)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Search failed') }
    finally { setLoading(false) }
  }

  const loadPatientFiles = async () => {
    if (!selectedPatient) return
    setLoadingFiles(true)
    try { const r = await listFiles(selectedPatient.id); setPatientFiles(r.files) }
    catch { setError('Failed to load patient files') }
    finally { setLoadingFiles(false) }
  }

  const loadConsents = async () => {
    if (!selectedPatient) return
    try {
      const all = await listConsents()
      setConsents(all.filter(c => c.scope?.includes(`file:`) || c.scope?.includes(`patient:${selectedPatient.id}`)))
    } catch { /* ignore */ }
  }

  const loadAccessRequests = async () => {
    try { const r = await listAccessRequests(); setAccessRequests(r.requests) }
    catch { /* ignore */ }
  }

  const loadFederationHospitals = async () => {
    setLoadingHospitals(true)
    try {
      const ns = await getFederationNetworkStatus()
      const h: typeof hospitals = []
      ns.peers?.forEach((p: { id: string; name: string; endpoint: string; status: string }) => {
        if (p.status === 'reachable' || p.id) {
          h.push({ id: p.id || p.endpoint.split(':')[0], name: p.name || p.id || p.endpoint, endpoint: p.endpoint, status: p.status })
        }
      })
      setHospitals(h)
    } catch { setHospitals([]) }
    finally { setLoadingHospitals(false) }
  }

  // ---- File selection helpers ----
  const toggleFile = (id: number) =>
    setSelectedFiles(p => p.includes(id) ? p.filter(f => f !== id) : [...p, id])
  const toggleAll = () =>
    setSelectedFiles(selectedFiles.length === patientFiles.length ? [] : patientFiles.map(f => f.id))

  // ---- Consent Request Handler ----
  const handleSendConsentRequest = async () => {
    if (!selectedPatient) { setError('Select a patient first'); return }
    if (selectedFiles.length === 0) { setError('Select at least one file'); return }
    if (!consentReason.trim()) { setError('Provide a reason for the request'); return }
    setLoading(true); setError(null)
    try {
      await sendConsentRequest({
        patient_id: selectedPatient.id,
        file_ids: selectedFiles,
        reason: consentReason,
        urgency: consentUrgency,
        target_hospital_id: targetHospitalId || undefined,
        target_hospital_name: targetHospitalName || undefined,
      })
      setSuccessMsg(`Consent request sent to ${selectedPatient.full_name}. The patient will be notified.`)
      setConsentReason('')
      setSelectedFiles([])
      setConsentUrgency('normal')
      setTargetHospitalId('')
      setTargetHospitalName('')
      loadAccessRequests()
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to send consent request') }
    finally { setLoading(false) }
  }

  // ---- Emergency Override Handler ----
  const handleEmergencyOverride = async () => {
    if (!selectedPatient) { setError('Select a patient first'); return }
    if (selectedFiles.length === 0) { setError('Select files for emergency access'); return }
    if (!emergencyReason.trim() || !clinicalJustification.trim()) {
      setError('Both reason and clinical justification are required for emergency override')
      return
    }
    if (!window.confirm(
      `⚠️ EMERGENCY OVERRIDE\n\nThis will bypass patient consent for ${selectedFiles.length} file(s).\n` +
      `Access is time-limited (24 hours) and will be critically audit-logged.\n\n` +
      `Kenya DPA Section 35: This must only be used for genuine medical emergencies.\n\nProceed?`
    )) return

    setLoading(true); setError(null)
    try {
      await emergencyOverride({
        patient_id: selectedPatient.id,
        file_ids: selectedFiles,
        reason: emergencyReason,
        clinical_justification: clinicalJustification,
      })
      setSuccessMsg(`Emergency access granted for 24 hours. The patient has been notified. This action has been audit-logged.`)
      setEmergencyReason('')
      setClinicalJustification('')
      setSelectedFiles([])
      loadAccessRequests()
    } catch (e) { setError(e instanceof Error ? e.message : 'Emergency override failed') }
    finally { setLoading(false) }
  }

  // ---- Proxy Approval Handler ----
  const handleProxyApproval = async (requestId: number) => {
    if (!proxyReason.trim()) { setError('Provide a reason for proxy approval'); return }
    if (!window.confirm(
      `You are approving this consent request on behalf of the patient.\n` +
      `Verification method: ${verificationMethod}\n\n` +
      `Kenya DPA: Third-party representation must be documented.\n\nProceed?`
    )) return

    setLoading(true); setError(null)
    try {
      await proxyApproval({ request_id: requestId, proxy_reason: proxyReason, verification_method: verificationMethod })
      setSuccessMsg('Proxy approval completed. Consent has been created on behalf of the patient.')
      setProxyReason('')
      setVerificationMethod('verbal')
      loadAccessRequests()
    } catch (e) { setError(e instanceof Error ? e.message : 'Proxy approval failed') }
    finally { setLoading(false) }
  }

  const handleRevokeConsent = async (id: number) => {
    if (!window.confirm('Revoke this consent?')) return
    try { await revokeConsent(id); setSuccessMsg('Consent revoked'); loadConsents() }
    catch (e) { setError(e instanceof Error ? e.message : 'Revoke failed') }
  }

  const canManage = user?.role === 'doctor' || user?.role === 'admin'
  const pendingRequests = accessRequests.filter(r => r.status === 'pending')

  // ---- File selection list (reusable) ----
  const FileSelection = () => (
    <div style={{ marginTop: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <label style={{ fontSize: 14, fontWeight: 600 }}>Select Files *</label>
        <button type="button" onClick={toggleAll} disabled={patientFiles.length === 0} style={{ padding: '0.2rem 0.5rem', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', fontSize: 12 }}>
          {selectedFiles.length === patientFiles.length ? 'Deselect All' : 'Select All'}
        </button>
      </div>
      {loadingFiles ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading files...</p>
      ) : patientFiles.length === 0 ? (
        <div style={{ padding: '0.75rem', background: 'rgba(239,68,68,0.08)', borderRadius: 6, color: 'var(--muted)', fontSize: 13 }}>
          No files found for this patient.
        </div>
      ) : (
        <div style={{ maxHeight: 250, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)' }}>
          {patientFiles.map(f => (
            <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.75rem', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selectedFiles.includes(f.id) ? 'rgba(59,130,246,0.08)' : 'transparent' }}>
              <input type="checkbox" checked={selectedFiles.includes(f.id)} onChange={() => toggleFile(f.id)} style={{ width: 16, height: 16 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{f.filename}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {(f.size / 1024 / 1024).toFixed(2)} MB · {new Date(f.upload_timestamp).toLocaleDateString()}
                  {f.description && <> · {f.description}</>}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}
      {selectedFiles.length > 0 && (
        <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.75rem', background: 'rgba(16,185,129,0.1)', borderRadius: 4, fontSize: 12, color: '#10b981' }}>
          {selectedFiles.length} file(s) selected
        </div>
      )}
    </div>
  )

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0 }}>Patient Consent & Access Management</h1>
        <button onClick={() => navigate('/files')} style={{ padding: '0.5rem 1rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', cursor: 'pointer' }}>
          ← Back to Files
        </button>
      </div>

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

      {/* Selected Patient Banner */}
      {selectedPatient && (
        <div style={{ ...card, marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(59,130,246,0.06)', borderColor: 'rgba(59,130,246,0.3)' }}>
          <div>
            <strong>Selected Patient:</strong> {selectedPatient.full_name}
            {selectedPatient.medical_record_number && <> (MRN: {selectedPatient.medical_record_number})</>}
            <span style={{ ...badge('#3b82f6'), marginLeft: 10 }}>{selectedPatient.file_count} files</span>
          </div>
          <button onClick={() => { setSelectedPatient(null); setActiveTab('patients') }} style={{ padding: '0.3rem 0.75rem', border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', fontSize: 12 }}>
            Change Patient
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
        <button onClick={() => setActiveTab('patients')} style={tabBtn(activeTab === 'patients')}>Patients</button>
        <button onClick={() => selectedPatient && setActiveTab('consent-request')} style={tabBtn(activeTab === 'consent-request', !selectedPatient)} disabled={!selectedPatient}>
          Request Consent
        </button>
        <button onClick={() => selectedPatient && setActiveTab('emergency')} style={tabBtn(activeTab === 'emergency', !selectedPatient)} disabled={!selectedPatient}>
          Emergency Override
        </button>
        <button onClick={() => setActiveTab('proxy')} style={tabBtn(activeTab === 'proxy')}>
          Proxy Approval ({pendingRequests.length})
        </button>
        <button onClick={() => setActiveTab('requests')} style={tabBtn(activeTab === 'requests')}>
          All Requests
        </button>
      </div>

      {/* ===================== PATIENTS TAB ===================== */}
      {activeTab === 'patients' && (
        <div>
          {/* DPA search form */}
          <div style={{ ...card, marginBottom: '1.5rem' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: 16 }}>Search Patient (DPA-Compliant)</h2>
            <form onSubmit={handlePatientSearch} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <input type="text" placeholder="Full Name *" required value={patientSearchForm.full_name}
                  onChange={e => setPatientSearchForm({ ...patientSearchForm, full_name: e.target.value })} style={inputBase} />
                <input type="email" placeholder="Email (optional)" value={patientSearchForm.email}
                  onChange={e => setPatientSearchForm({ ...patientSearchForm, email: e.target.value })} style={inputBase} />
              </div>
              <input type="tel" placeholder="Phone (optional)" value={patientSearchForm.phone}
                onChange={e => setPatientSearchForm({ ...patientSearchForm, phone: e.target.value })} style={inputBase} />
              <button type="submit" disabled={loading} style={{ padding: '0.6rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>
                {loading ? 'Searching...' : 'Search'}
              </button>
            </form>
          </div>

          {/* Quick search */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input type="text" placeholder="Quick search by name or MRN..." value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)} style={{ ...inputBase, flex: 1 }} />
            <button onClick={loadPatients} disabled={loading} style={{ padding: '0.5rem 1rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              Search
            </button>
          </div>

          {/* Patient list */}
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {patients.map(p => (
              <div key={p.id} onClick={() => { setSelectedPatient(p); setActiveTab('consent-request') }}
                style={{ ...card, cursor: 'pointer', borderColor: selectedPatient?.id === p.id ? 'var(--accent)' : 'var(--border)', transition: 'border-color 0.2s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <strong>{p.full_name}</strong>
                    {p.medical_record_number && <div style={{ fontSize: 12, color: 'var(--muted)' }}>MRN: {p.medical_record_number}</div>}
                    {p.email && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.email}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={badge('#3b82f6')}>{p.file_count} files</span>
                    {p.phone && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{p.phone}</div>}
                  </div>
                </div>
              </div>
            ))}
            {patients.length === 0 && !loading && (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
                No patients found. Use the search above.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================== CONSENT REQUEST TAB ===================== */}
      {activeTab === 'consent-request' && selectedPatient && (
        <div>
          <h2 style={{ marginTop: 0, fontSize: 18, marginBottom: '1rem' }}>Request Patient Consent</h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: '1rem' }}>
            Send a consent request to <strong>{selectedPatient.full_name}</strong>. The patient will be notified and can approve or deny from their Consent Portal.
          </p>

          <div style={{ ...card, marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {/* Reason */}
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Reason for Access *</label>
                <textarea value={consentReason} onChange={e => setConsentReason(e.target.value)}
                  placeholder="Describe why you need access to the patient's files..."
                  rows={3} style={{ ...inputBase, resize: 'vertical' }} />
              </div>

              {/* Urgency */}
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Urgency</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {(['normal', 'urgent', 'emergency'] as const).map(u => (
                    <button key={u} type="button" onClick={() => setConsentUrgency(u)}
                      style={{ padding: '0.4rem 1rem', borderRadius: 6, border: consentUrgency === u ? '2px solid' : '1px solid var(--border)',
                        borderColor: u === 'emergency' ? '#ef4444' : u === 'urgent' ? '#f59e0b' : 'var(--accent)',
                        background: consentUrgency === u ? (u === 'emergency' ? 'rgba(239,68,68,0.1)' : u === 'urgent' ? 'rgba(245,158,11,0.1)' : 'rgba(59,130,246,0.1)') : 'transparent',
                        color: 'var(--text)', cursor: 'pointer', fontWeight: consentUrgency === u ? 600 : 400, fontSize: 13 }}>
                      {u.charAt(0).toUpperCase() + u.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Federation target */}
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Target Hospital (cross-hospital federation)</label>
                <select value={targetHospitalId}
                  onChange={e => { const h = hospitals.find(h => h.id === e.target.value); setTargetHospitalId(e.target.value); setTargetHospitalName(h?.name || '') }}
                  style={inputBase} disabled={loadingHospitals}>
                  <option value="">{loadingHospitals ? 'Loading...' : '-- Same hospital (local) --'}</option>
                  {hospitals.map(h => <option key={h.id} value={h.id}>{h.name} ({h.status === 'reachable' ? 'Online' : 'Offline'})</option>)}
                </select>
                {hospitals.length > 0 && (
                  <button type="button" onClick={loadFederationHospitals} disabled={loadingHospitals}
                    style={{ marginTop: 4, padding: '0.2rem 0.5rem', fontSize: 11, border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer' }}>
                    Refresh hospitals
                  </button>
                )}
              </div>

              {/* File selection */}
              <FileSelection />

              {/* Submit */}
              <button onClick={handleSendConsentRequest} disabled={loading || selectedFiles.length === 0 || !consentReason.trim()}
                style={{ padding: '0.75rem', background: loading ? 'var(--muted)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', marginTop: '0.5rem' }}>
                {loading ? 'Sending...' : `Send Consent Request (${selectedFiles.length} files)`}
              </button>
            </div>
          </div>

          {/* Existing consents for this patient */}
          <div style={card}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: 15 }}>Existing Consents for {selectedPatient.full_name}</h3>
            {consents.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>No active consents for this patient.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {consents.map(c => (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{c.scope || 'All files'}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {c.granted_to_role && <>Role: {c.granted_to_role} · </>}
                        Granted: {new Date(c.granted_at).toLocaleDateString()}
                        {c.expires_at && <> · Expires: {new Date(c.expires_at).toLocaleDateString()}</>}
                      </div>
                    </div>
                    {canManage && !c.revoked_at && (
                      <button onClick={() => handleRevokeConsent(c.id)} style={{ padding: '0.3rem 0.6rem', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
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

      {/* ===================== EMERGENCY OVERRIDE TAB ===================== */}
      {activeTab === 'emergency' && selectedPatient && (
        <div>
          <h2 style={{ marginTop: 0, fontSize: 18, color: '#ef4444', marginBottom: '0.5rem' }}>
            ⚠️ Emergency Consent Override
          </h2>
          <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 13 }}>
            <strong>Kenya DPA Section 35:</strong> Lawful processing without consent is permitted in medical emergencies.
            Emergency access is <strong>time-limited to 24 hours</strong> and will be <strong>critically audit-logged</strong>.
            The patient will be notified immediately.
          </div>

          <div style={card}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Emergency Reason *</label>
                <textarea value={emergencyReason} onChange={e => setEmergencyReason(e.target.value)}
                  placeholder="Describe the medical emergency requiring immediate file access..."
                  rows={3} style={{ ...inputBase, resize: 'vertical' }} />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Clinical Justification *</label>
                <textarea value={clinicalJustification} onChange={e => setClinicalJustification(e.target.value)}
                  placeholder="Provide clinical justification (e.g., critical diagnostic need, life-threatening condition)..."
                  rows={3} style={{ ...inputBase, resize: 'vertical' }} />
              </div>

              <FileSelection />

              <button onClick={handleEmergencyOverride}
                disabled={loading || selectedFiles.length === 0 || !emergencyReason.trim() || !clinicalJustification.trim()}
                style={{ padding: '0.75rem', background: loading ? 'var(--muted)' : '#ef4444', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', marginTop: '0.5rem' }}>
                {loading ? 'Processing...' : `Emergency Override — Access ${selectedFiles.length} file(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== PROXY APPROVAL TAB ===================== */}
      {activeTab === 'proxy' && (
        <div>
          <h2 style={{ marginTop: 0, fontSize: 18, marginBottom: '0.5rem' }}>Proxy Approval</h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: '1rem' }}>
            Approve pending consent requests on behalf of patients who lack digital capabilities.
            Kenya DPA allows third-party representation with documented verification.
          </p>

          {/* Proxy form */}
          <div style={{ ...card, marginBottom: '1.5rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: 15 }}>Proxy Authorization Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Verification Method *</label>
                <select value={verificationMethod} onChange={e => setVerificationMethod(e.target.value as 'verbal' | 'written' | 'witness')} style={inputBase}>
                  <option value="verbal">Verbal consent from patient</option>
                  <option value="written">Written authorization</option>
                  <option value="witness">Witnessed verbal consent</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Proxy Reason *</label>
                <input type="text" value={proxyReason} onChange={e => setProxyReason(e.target.value)}
                  placeholder="e.g., Patient unable to use digital portal" style={inputBase} />
              </div>
            </div>
          </div>

          {/* Pending requests to proxy-approve */}
          <h3 style={{ fontSize: 15, marginBottom: '0.75rem' }}>Pending Requests ({pendingRequests.length})</h3>
          {pendingRequests.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', color: 'var(--muted)' }}>
              No pending consent requests to proxy-approve.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {pendingRequests.map(req => (
                <div key={req.id} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <div>
                      <strong>{req.requester_name || req.requester_email}</strong>
                      <span style={{ ...badge('#6b7280'), marginLeft: 8 }}>{req.requester_role}</span>
                      {req.urgency && req.urgency !== 'normal' && (
                        <span style={{ ...badge(req.urgency === 'emergency' ? '#ef4444' : '#f59e0b'), marginLeft: 6 }}>
                          {req.urgency.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {new Date(req.requested_at).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, marginBottom: '0.25rem' }}>
                    <strong>Patient:</strong> {req.patient_name || `ID: ${req.patient_id}`}
                  </div>
                  <div style={{ fontSize: 13, marginBottom: '0.5rem' }}>
                    <strong>Reason:</strong> {req.reason}
                  </div>
                  {req.file_ids && req.file_ids.length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: '0.5rem' }}>
                      Files: {req.file_ids.join(', ')}
                    </div>
                  )}
                  <button onClick={() => handleProxyApproval(req.id)}
                    disabled={loading || !proxyReason.trim()}
                    style={{ padding: '0.4rem 1rem', background: loading ? 'var(--muted)' : 'rgba(139,92,246,0.15)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 6, cursor: (loading || !proxyReason.trim()) ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13 }}>
                    {loading ? 'Processing...' : 'Proxy Approve'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===================== ALL REQUESTS TAB ===================== */}
      {activeTab === 'requests' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>All Consent Requests</h2>
            <button onClick={loadAccessRequests} style={{ padding: '0.4rem 0.75rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', cursor: 'pointer', fontSize: 13 }}>
              Refresh
            </button>
          </div>

          {accessRequests.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', color: 'var(--muted)' }}>
              No consent requests found.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {accessRequests.map(req => {
                const statusColor = req.status === 'approved' ? '#10b981' : req.status === 'denied' ? '#ef4444' : req.status === 'pending' ? '#f59e0b' : '#6b7280'
                return (
                  <div key={req.id} style={{ ...card, borderLeftWidth: 4, borderLeftColor: statusColor }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <div>
                        <strong>{req.requester_name || req.requester_email}</strong>
                        <span style={{ ...badge(statusColor), marginLeft: 8 }}>{req.status.toUpperCase()}</span>
                        {req.is_emergency && <span style={{ ...badge('#ef4444'), marginLeft: 6 }}>EMERGENCY</span>}
                        {req.is_proxy && <span style={{ ...badge('#8b5cf6'), marginLeft: 6 }}>PROXY</span>}
                        {req.urgency && req.urgency !== 'normal' && !req.is_emergency && (
                          <span style={{ ...badge('#f59e0b'), marginLeft: 6 }}>{req.urgency.toUpperCase()}</span>
                        )}
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {new Date(req.requested_at).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, marginBottom: '0.25rem' }}>
                      <strong>Patient:</strong> {req.patient_name || `ID: ${req.patient_id}`}
                    </div>
                    <div style={{ fontSize: 13, marginBottom: '0.25rem' }}>
                      <strong>Reason:</strong> {req.reason}
                    </div>
                    {req.file_ids && req.file_ids.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Files: {req.file_ids.join(', ')}</div>
                    )}
                    {req.resolved_at && (
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: '0.25rem' }}>
                        Resolved: {new Date(req.resolved_at).toLocaleString()}
                        {req.resolved_by_name && <> by {req.resolved_by_name}</>}
                      </div>
                    )}
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
