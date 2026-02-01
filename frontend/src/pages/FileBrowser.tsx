import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listFiles, uploadFile, deleteFile, downloadFile, listPatients, createPatient, type FileInfo, type Patient, type PatientCreate } from '../api/client'

export function FileBrowser() {
  const navigate = useNavigate()
  const [files, setFiles] = useState<FileInfo[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null)
  const [uploadDescription, setUploadDescription] = useState('')
  const [showCreatePatient, setShowCreatePatient] = useState(false)
  const [newPatient, setNewPatient] = useState<PatientCreate>({
    full_name: '',
    date_of_birth: '',
    email: '',
    phone: ''
  })

  const load = () => {
    setLoading(true)
    Promise.all([
      listFiles().then((data) => setFiles(data.files)),
      listPatients().then(setPatients)
    ])
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setShowUploadModal(true)
    setUploadErr(null)
    e.target.value = ''
  }

  const handleCreatePatient = async () => {
    if (!newPatient.full_name || !newPatient.date_of_birth) {
      setUploadErr('Patient name and date of birth are required')
      return
    }
    try {
      const created = await createPatient(newPatient)
      setPatients([...patients, created])
      setSelectedPatientId(created.id)
      setShowCreatePatient(false)
      setNewPatient({ full_name: '', date_of_birth: '', email: '', phone: '' })
      setUploadErr(null)
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : 'Failed to create patient')
    }
  }

  const handleUpload = async () => {
    if (!selectedFile) return
    if (!selectedPatientId) {
      setUploadErr('Please select a patient')
      return
    }
    setUploadErr(null)
    setUploading(true)
    try {
      await uploadFile(selectedFile, selectedPatientId, uploadDescription)
      setShowUploadModal(false)
      setSelectedFile(null)
      setSelectedPatientId(null)
      setUploadDescription('')
      load()
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const onDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return
    try {
      await deleteFile(id)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const isDicomFile = (filename: string, contentType: string | null) => {
    return filename.toLowerCase().endsWith('.dcm') || 
           filename.toLowerCase().endsWith('.dicom') ||
           contentType?.includes('dicom')
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Files</h1>
      <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <label style={{ display: 'inline-block', padding: '0.5rem 1rem', background: 'var(--accent)', color: 'white', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
          Upload file
          <input type="file" onChange={handleFileSelect} disabled={uploading} style={{ display: 'none' }} />
        </label>
        {uploadErr && <span style={{ color: 'var(--danger)', fontSize: 14 }}>{uploadErr}</span>}
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--background)', padding: '2rem', borderRadius: 12, maxWidth: 600, width: '90%', maxHeight: '90vh', overflow: 'auto' }}>
            <h2 style={{ marginTop: 0 }}>Upload File</h2>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: '1.5rem' }}>
              File: <strong>{selectedFile?.name}</strong> ({selectedFile ? formatSize(selectedFile.size) : ''})
            </p>

            {!showCreatePatient ? (
              <>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                    Select Patient <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <select 
                    value={selectedPatientId || ''} 
                    onChange={(e) => setSelectedPatientId(Number(e.target.value))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)' }}
                  >
                    <option value="">-- Select a patient --</option>
                    {patients.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.full_name} {p.date_of_birth ? `(DOB: ${p.date_of_birth})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <button 
                  type="button"
                  onClick={() => setShowCreatePatient(true)}
                  style={{ marginBottom: '1rem', padding: '0.5rem 1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
                >
                  + Create New Patient
                </button>

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Description (optional)</label>
                  <textarea 
                    value={uploadDescription}
                    onChange={(e) => setUploadDescription(e.target.value)}
                    placeholder="Add a description for this file..."
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', minHeight: 80, resize: 'vertical' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <button 
                    type="button"
                    onClick={() => { setShowUploadModal(false); setSelectedFile(null); setSelectedPatientId(null); setUploadDescription(''); setUploadErr(null); }}
                    style={{ padding: '0.5rem 1.5rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button 
                    type="button"
                    onClick={handleUpload}
                    disabled={uploading || !selectedPatientId}
                    style={{ padding: '0.5rem 1.5rem', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 6, cursor: uploading || !selectedPatientId ? 'not-allowed' : 'pointer', opacity: uploading || !selectedPatientId ? 0.5 : 1 }}
                  >
                    {uploading ? 'Uploading...' : 'Upload'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 style={{ fontSize: 18, marginBottom: '1rem' }}>Create New Patient</h3>
                
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                    Full Name <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input 
                    type="text"
                    value={newPatient.full_name}
                    onChange={(e) => setNewPatient({...newPatient, full_name: e.target.value})}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)' }}
                  />
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                    Date of Birth <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input 
                    type="date"
                    value={newPatient.date_of_birth}
                    onChange={(e) => setNewPatient({...newPatient, date_of_birth: e.target.value})}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)' }}
                  />
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Email</label>
                  <input 
                    type="email"
                    value={newPatient.email || ''}
                    onChange={(e) => setNewPatient({...newPatient, email: e.target.value})}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)' }}
                  />
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Phone</label>
                  <input 
                    type="tel"
                    value={newPatient.phone || ''}
                    onChange={(e) => setNewPatient({...newPatient, phone: e.target.value})}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <button 
                    type="button"
                    onClick={() => { setShowCreatePatient(false); setNewPatient({ full_name: '', date_of_birth: '', email: '', phone: '' }); setUploadErr(null); }}
                    style={{ padding: '0.5rem 1.5rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}
                  >
                    Back
                  </button>
                  <button 
                    type="button"
                    onClick={handleCreatePatient}
                    style={{ padding: '0.5rem 1.5rem', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                  >
                    Create Patient
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading...</p>
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Name</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Size</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Uploaded</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: '1.5rem', color: 'var(--muted)' }}>No files yet. Upload one above.</td></tr>
              ) : (
                files.map((f) => (
                  <tr key={f.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem 1rem' }}>{f.filename}</td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--muted)' }}>{formatSize(f.size)}</td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--muted)', fontSize: 14 }}>{new Date(f.upload_timestamp).toLocaleString()}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      {isDicomFile(f.filename, f.content_type) && (
                        <button 
                          type="button" 
                          onClick={() => navigate(`/dicom-viewer?fileId=${f.id}`)} 
                          style={{ background: 'none', border: 'none', color: 'var(--accent)', padding: 0, cursor: 'pointer', marginRight: '0.75rem' }}
                        >
                          View DICOM
                        </button>
                      )}
                      <button type="button" onClick={() => downloadFile(f.id, f.filename).catch(setError)} style={{ background: 'none', border: 'none', color: 'var(--accent)', padding: 0, cursor: 'pointer', marginRight: '0.75rem' }}>Download</button>
                      <button type="button" onClick={() => onDelete(f.id, f.filename)} style={{ background: 'none', border: 'none', color: 'var(--danger)', padding: 0, cursor: 'pointer' }}>Delete</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
