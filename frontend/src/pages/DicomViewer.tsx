import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { api, type FileInfo } from '../api/client'

export function DicomViewer() {
  const [searchParams] = useSearchParams()
  const fileId = searchParams.get('fileId')
  const navigate = useNavigate()
  
  const [file, setFile] = useState<FileInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  // Load file metadata
  useEffect(() => {
    if (!fileId) {
      setError('No file ID provided')
      setLoading(false)
      return
    }

    api<{ file: FileInfo }>(`/files/${fileId}`)
      .then((data) => {
        setFile(data.file)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load file')
        setLoading(false)
      })
  }, [fileId])

  const handleDownload = () => {
    if (!fileId) return
    
    setDownloading(true)
    const token = localStorage.getItem('medimage_token')
    
    fetch(`/api/files/${fileId}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(res => {
        if (!res.ok) throw new Error('Download failed')
        return res.blob()
      })
      .then(blob => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = file?.filename || 'dicom-file.dcm'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        setDownloading(false)
      })
      .catch(err => {
        setError(`Download failed: ${err.message}`)
        setDownloading(false)
      })
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Loading DICOM Viewer...</h2>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Loading DICOM file...</h2>
      </div>
    )
  }

  if (error || !file) {
    return (
      <div style={{ padding: '2rem' }}>
        <h2 style={{ color: 'var(--danger)' }}>Error</h2>
        <p>{error || 'File not found'}</p>
        <button onClick={() => navigate('/files')} style={{ padding: '0.5rem 1rem', marginTop: '1rem' }}>
          Back to Files
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 800, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ 
        marginBottom: '2rem',
        paddingBottom: '1rem',
        borderBottom: '1px solid var(--border)'
      }}>
        <h1 style={{ margin: 0, fontSize: 24, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          🩺 DICOM File Viewer
        </h1>
      </div>

      {/* File Info Card */}
      <div style={{ 
        padding: '1.5rem', 
        background: 'var(--surface)', 
        border: '1px solid var(--border)',
        borderRadius: 8,
        marginBottom: '1.5rem'
      }}>
        <h2 style={{ margin: '0 0 1rem 0', fontSize: 18 }}>File Information</h2>
        <div style={{ display: 'grid', gap: '0.75rem', fontSize: 14 }}>
          <div>
            <strong style={{ color: 'var(--muted)' }}>Filename:</strong>
            <div style={{ marginTop: '0.25rem' }}>{file.filename}</div>
          </div>
          <div>
            <strong style={{ color: 'var(--muted)' }}>Size:</strong>
            <div style={{ marginTop: '0.25rem' }}>{(file.size / 1024 / 1024).toFixed(2)} MB</div>
          </div>
          <div>
            <strong style={{ color: 'var(--muted)' }}>Content Type:</strong>
            <div style={{ marginTop: '0.25rem' }}>{file.content_type || 'application/dicom'}</div>
          </div>
          {file.description && (
            <div>
              <strong style={{ color: 'var(--muted)' }}>Description:</strong>
              <div style={{ marginTop: '0.25rem' }}>{file.description}</div>
            </div>
          )}
        </div>
      </div>

      {/* Viewer Notice */}
      <div style={{ 
        padding: '1.5rem', 
        background: 'var(--surface)', 
        border: '1px solid var(--border)',
        borderRadius: 8,
        marginBottom: '1.5rem',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: 48, marginBottom: '1rem' }}>🏥</div>
        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: 16 }}>DICOM File Preview</h3>
        <p style={{ color: 'var(--muted)', margin: '0 0 1rem 0', fontSize: 14 }}>
          To view this DICOM file, please download it and open with a DICOM viewer application such as:
        </p>
        <ul style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 14, maxWidth: 400, margin: '0 auto 1.5rem' }}>
          <li>Horos (Mac)</li>
          <li>RadiAnt DICOM Viewer (Windows)</li>
          <li>Weasis (Cross-platform)</li>
          <li>3D Slicer (Advanced analysis)</li>
        </ul>
        <button
          onClick={handleDownload}
          disabled={downloading}
          style={{
            padding: '0.75rem 2rem',
            background: downloading ? 'var(--muted)' : 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: downloading ? 'not-allowed' : 'pointer',
            fontSize: 15,
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          {downloading ? '⏳ Downloading...' : '📥 Download DICOM File'}
        </button>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
        <button 
          onClick={() => navigate('/files')}
          style={{ 
            padding: '0.75rem 1.5rem', 
            background: 'var(--surface)', 
            border: '1px solid var(--border)', 
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14
          }}
        >
          ← Back to Files
        </button>
      </div>
    </div>
  )
}
