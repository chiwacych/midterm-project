import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { api, type FileInfo } from '../api/client'

export function DicomViewer() {
  const [searchParams] = useSearchParams()
  const fileId = searchParams.get('fileId')
  const requestedStudyUid = searchParams.get('studyUid') || searchParams.get('studyInstanceUID')
  const requestedSeriesUid = searchParams.get('seriesUid') || searchParams.get('seriesInstanceUID')
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

  const token = localStorage.getItem('medimage_token') || ''
  const studyUid = requestedStudyUid || file.dicom_study_id || ''
  const seriesUid = requestedSeriesUid || file.dicom_series_id || ''
  const hasDicomIdentifiers = Boolean(studyUid)

  const configuredOhifBase = (import.meta.env.VITE_OHIF_BASE_URL as string | undefined)?.trim()
  const ohifBase =
    configuredOhifBase && configuredOhifBase.length > 0
      ? configuredOhifBase.replace(/\/$/, '')
      : `${window.location.protocol}//${window.location.hostname}:8042`

  // ConnectedStandaloneViewer (OHIF v2) requires url= to point to a config server.
  // Pass study/series to the config endpoint so it can emit study context in JSON.
  const ohifQuery = new URLSearchParams()
  const configParams = new URLSearchParams()
  if (token) configParams.set('token', token)
  if (studyUid) configParams.set('studyInstanceUIDs', studyUid)
  if (seriesUid) configParams.set('seriesInstanceUIDs', seriesUid)
  ohifQuery.set('url', `${ohifBase}/ohif-config?${configParams.toString()}`)

  // Keep both query-key casings for OHIF v2 ConnectedStandalone compatibility.
  if (studyUid) {
    ohifQuery.set('StudyInstanceUIDs', studyUid)
    ohifQuery.set('studyInstanceUIDs', studyUid)
  }
  if (seriesUid) {
    ohifQuery.set('SeriesInstanceUIDs', seriesUid)
    ohifQuery.set('seriesInstanceUIDs', seriesUid)
    ohifQuery.set('initialSeriesInstanceUID', seriesUid)
  }
  if (token) ohifQuery.set('token', token)
  const ohifUrl = `${ohifBase}/viewer?${ohifQuery.toString()}`

  return (
    <div style={{ padding: '1rem', maxWidth: 1300, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ 
        marginBottom: '1rem',
        paddingBottom: '1rem',
        borderBottom: '1px solid var(--border)'
      }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>
          DICOM Viewer (OHIF)
        </h1>
        <p style={{ marginTop: '0.5rem', marginBottom: 0, color: 'var(--muted)' }}>
          Study UID: {studyUid || 'not available'}
        </p>
      </div>

      {/* File Info */}
      <div style={{ 
        padding: '1rem', 
        background: 'var(--surface)', 
        border: '1px solid var(--border)',
        borderRadius: 8,
        marginBottom: '1rem'
      }}>
        <h2 style={{ margin: '0 0 0.8rem 0', fontSize: 17 }}>File Information</h2>
        <div style={{ display: 'grid', gap: '0.5rem', fontSize: 14 }}>
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
          <div>
            <strong style={{ color: 'var(--muted)' }}>Series UID:</strong>
            <div style={{ marginTop: '0.25rem' }}>{file.dicom_series_id || 'not available'}</div>
          </div>
          <div>
            <strong style={{ color: 'var(--muted)' }}>Body Part:</strong>
            <div style={{ marginTop: '0.25rem' }}>{file.dicom_body_part || 'not available'}</div>
          </div>
          {file.description && (
            <div>
              <strong style={{ color: 'var(--muted)' }}>Description:</strong>
              <div style={{ marginTop: '0.25rem' }}>{file.description}</div>
            </div>
          )}
        </div>
      </div>

      {hasDicomIdentifiers ? (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
            <a
              href={ohifUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.55rem 1rem',
                borderRadius: 6,
                background: 'var(--accent)',
                color: '#fff',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Open OHIF in new tab
            </a>
            <button
              onClick={handleDownload}
              disabled={downloading}
              style={{
                padding: '0.55rem 1rem',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: downloading ? 'not-allowed' : 'pointer',
              }}
            >
              {downloading ? 'Downloading...' : 'Download DICOM'}
            </button>
          </div>

          <div style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden',
            background: '#111',
            height: '72vh',
          }}>
            <iframe
              title="OHIF DICOM Viewer"
              src={ohifUrl}
              style={{ width: '100%', height: '100%', border: 0 }}
            />
          </div>

          <p style={{ marginTop: '0.5rem', color: 'var(--muted)', fontSize: 12 }}>
            OHIF runs locally at {ohifBase} and serves DICOM from this app&apos;s local DICOMweb endpoint.
          </p>
        </div>
      ) : (
        <div style={{
          padding: '1.2rem',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          marginBottom: '1rem',
        }}>
          <h3 style={{ marginTop: 0 }}>DICOM identifiers missing for OHIF launch</h3>
          <p style={{ color: 'var(--muted)' }}>
            This file does not yet have a Study UID in metadata, so OHIF cannot open it directly.
          </p>
          <button
            onClick={handleDownload}
            disabled={downloading}
            style={{
              padding: '0.55rem 1rem',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: downloading ? 'not-allowed' : 'pointer',
            }}
          >
            {downloading ? 'Downloading...' : 'Download DICOM'}
          </button>
        </div>
      )}

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
