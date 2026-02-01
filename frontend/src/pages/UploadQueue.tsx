import React, { useState, useCallback, useRef, useEffect } from 'react'
import { uploadFile, listPatients, Patient } from '../api/client'

interface UploadItem {
  id: string
  file: File
  progress: number
  status: 'pending' | 'uploading' | 'completed' | 'error'
  error?: string
  result?: { id: number; filename: string }
  patientId: number | null
}

export function UploadQueue() {
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [concurrentUploads, setConcurrentUploads] = useState(3)
  const [autoStart, setAutoStart] = useState(true)
  const [patients, setPatients] = useState<Patient[]>([])
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadPatients()
  }, [])

  const loadPatients = async () => {
    try {
      const data = await listPatients()
      setPatients(data)
    } catch (err) {
      console.error('Failed to load patients:', err)
    }
  }

  const startSingleUpload = useCallback(async (item: UploadItem) => {
    setUploads(prev => prev.map(u =>
      u.id === item.id ? { ...u, status: 'uploading' } : u
    ))

    try {
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setUploads(prev => prev.map(u => {
          if (u.id === item.id && u.progress < 90) {
            return { ...u, progress: u.progress + Math.random() * 20 }
          }
          return u
        }))
      }, 200)

      if (!item.patientId) {
        throw new Error('Patient ID is required')
      }

      const result = await uploadFile(item.file, item.patientId, `Uploaded via queue: ${item.file.name}`)

      clearInterval(progressInterval)
      setUploads(prev => prev.map(u =>
        u.id === item.id ? { ...u, progress: 100, status: 'completed', result: result as { id: number; filename: string } } : u
      ))

      // Auto-start next pending upload
      const nextPending = uploads.find(u => u.status === 'pending')
      if (nextPending) {
        setTimeout(() => startSingleUpload(nextPending), 500)
      }

    } catch (error) {
      setUploads(prev => prev.map(u =>
        u.id === item.id ? {
          ...u,
          status: 'error',
          error: error instanceof Error ? error.message : 'Upload failed'
        } : u
      ))
    }
  }, [uploads])

  const startUploads = useCallback(async (items: UploadItem[]) => {
    const activeUploads = uploads.filter(u => u.status === 'uploading').length

    for (let i = 0; i < Math.min(items.length, concurrentUploads - activeUploads); i++) {
      const item = items[i]
      await startSingleUpload(item)
    }
  }, [uploads, concurrentUploads, startSingleUpload])

  const addFiles = useCallback((files: FileList | File[]) => {
    if (!selectedPatientId) {
      alert('Please select a patient first')
      return
    }

    const fileArray = Array.from(files)
    const newUploads: UploadItem[] = fileArray.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      progress: 0,
      status: 'pending',
      patientId: selectedPatientId
    }))

    setUploads(prev => [...prev, ...newUploads])

    if (autoStart) {
      startUploads(newUploads)
    }
  }, [autoStart, startUploads, selectedPatientId])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = e.dataTransfer.files
    if (files.length > 0) {
      addFiles(files)
    }
  }, [addFiles])

  const removeUpload = (id: string) => {
    setUploads(prev => prev.filter(u => u.id !== id))
  }

  const retryUpload = (item: UploadItem) => {
    setUploads(prev => prev.map(u =>
      u.id === item.id ? { ...u, status: 'pending', progress: 0, error: undefined } : u
    ))
    startSingleUpload(item)
  }

  const startAllPending = () => {
    const pending = uploads.filter(u => u.status === 'pending')
    startUploads(pending)
  }

  const clearCompleted = () => {
    setUploads(prev => prev.filter(u => u.status !== 'completed'))
  }

  const getStatusIcon = (status: UploadItem['status']) => {
    switch (status) {
      case 'pending': return '⏳'
      case 'uploading': return '🔄'
      case 'completed': return '✅'
      case 'error': return '❌'
    }
  }

  const getStatusColor = (status: UploadItem['status']) => {
    switch (status) {
      case 'pending': return '#ffa500'
      case 'uploading': return '#007bff'
      case 'completed': return '#28a745'
      case 'error': return '#dc3545'
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '2rem', color: 'var(--text)' }}>📤 Smart Upload Queue</h1>

      {/* Patient Selection */}
      <div style={{
        background: 'var(--surface)',
        padding: '1.5rem',
        borderRadius: '0.5rem',
        marginBottom: '2rem',
        border: '2px solid var(--accent)'
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text)' }}>Select Patient</h3>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <select
            value={selectedPatientId || ''}
            onChange={(e) => setSelectedPatientId(Number(e.target.value) || null)}
            style={{
              flex: 1,
              padding: '0.75rem',
              fontSize: '1rem',
              background: 'var(--bg)',
              color: 'var(--text)',
              border: '2px solid var(--border)',
              borderRadius: '6px'
            }}
          >
            <option value="">-- Select a patient --</option>
            {patients.map(p => (
              <option key={p.id} value={p.id}>
                {p.full_name} ({p.email})
              </option>
            ))}
          </select>
          {selectedPatientId && (
            <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>✓ Patient selected</span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div style={{
        background: 'var(--surface)',
        padding: '1rem',
        borderRadius: '0.5rem',
        marginBottom: '2rem',
        border: '1px solid var(--border)'
      }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label>
            <input
              type="checkbox"
              checked={autoStart}
              onChange={(e) => setAutoStart(e.target.checked)}
            />
            Auto-start uploads
          </label>
          <label>
            Concurrent uploads:
            <select
              value={concurrentUploads}
              onChange={(e) => setConcurrentUploads(Number(e.target.value))}
              style={{ marginLeft: '0.5rem', padding: '0.25rem' }}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
            </select>
          </label>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!selectedPatientId}
            style={{
              padding: '0.5rem 1rem',
              background: selectedPatientId ? 'var(--accent)' : 'var(--muted)',
              color: 'white',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: selectedPatientId ? 'pointer' : 'not-allowed',
              opacity: selectedPatientId ? 1 : 0.6
            }}
            title={!selectedPatientId ? 'Please select a patient first' : 'Select files to upload'}
          >
            📁 Select Files
          </button>
          <button
            onClick={startAllPending}
            disabled={!uploads.some(u => u.status === 'pending')}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--secondary)',
              color: 'white',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer',
              opacity: uploads.some(u => u.status === 'pending') ? 1 : 0.5
            }}
          >
            ▶️ Start All
          </button>
          <button
            onClick={clearCompleted}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--error)',
              color: 'white',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer'
            }}
          >
            🗑️ Clear Completed
          </button>
        </div>
      </div>

      {/* Drag and Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${isDragOver ? 'var(--primary)' : 'var(--border)'}`,
          borderRadius: '0.5rem',
          padding: '3rem',
          textAlign: 'center',
          background: isDragOver ? 'rgba(0, 123, 255, 0.1)' : 'var(--surface)',
          marginBottom: '2rem',
          transition: 'all 0.3s ease',
          cursor: 'pointer'
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>
          {isDragOver ? '🎯' : '📤'}
        </div>
        <h3>Drop medical images here or click to browse</h3>
        <p style={{ color: 'var(--muted)' }}>
          Supports DICOM, JPEG, PNG, PDF files • Max 100MB per file
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.dcm,.dicom,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => e.target.files && addFiles(e.target.files)}
      />

      {/* Upload Queue */}
      <div>
        <h3>Upload Queue ({uploads.length})</h3>
        {uploads.length === 0 && (
          <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>
            No files in queue. Drag and drop files above or click to select.
          </p>
        )}
        <div style={{ display: 'grid', gap: '1rem' }}>
          {uploads.map(item => (
            <div
              key={item.id}
              style={{
                background: 'var(--surface)',
                padding: '1rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem'
              }}
            >
              <div style={{
                fontSize: '1.5rem',
                color: getStatusColor(item.status)
              }}>
                {getStatusIcon(item.status)}
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ margin: 0 }}>{item.file.name}</h4>
                  <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                    {(item.file.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                </div>

                {item.status === 'uploading' && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{
                      width: '100%',
                      height: '8px',
                      background: 'var(--border)',
                      borderRadius: '4px',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        width: `${item.progress}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, var(--primary), var(--secondary))',
                        transition: 'width 0.3s ease',
                        borderRadius: '4px'
                      }} />
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                      {item.progress.toFixed(1)}%
                    </span>
                  </div>
                )}

                {item.error && (
                  <p style={{ color: 'var(--error)', margin: '0.5rem 0', fontSize: '0.9rem' }}>
                    {item.error}
                  </p>
                )}

                {item.result && (
                  <p style={{ color: 'var(--success)', margin: '0.5rem 0', fontSize: '0.9rem' }}>
                    ✅ Upload successful - File ID: {item.result.id}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {item.status === 'error' && (
                  <button
                    onClick={() => retryUpload(item)}
                    style={{
                      padding: '0.25rem 0.5rem',
                      background: 'var(--warning)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '0.25rem',
                      cursor: 'pointer',
                      fontSize: '0.8rem'
                    }}
                  >
                    🔄 Retry
                  </button>
                )}
                <button
                  onClick={() => removeUpload(item.id)}
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
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Queue Statistics */}
      {uploads.length > 0 && (
        <div style={{
          marginTop: '2rem',
          padding: '1rem',
          background: 'var(--surface)',
          borderRadius: '0.5rem',
          border: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-around',
          textAlign: 'center'
        }}>
          <div>
            <div style={{ fontSize: '1.5rem', color: '#ffa500' }}>⏳</div>
            <div>{uploads.filter(u => u.status === 'pending').length} Pending</div>
          </div>
          <div>
            <div style={{ fontSize: '1.5rem', color: '#007bff' }}>🔄</div>
            <div>{uploads.filter(u => u.status === 'uploading').length} Uploading</div>
          </div>
          <div>
            <div style={{ fontSize: '1.5rem', color: '#28a745' }}>✅</div>
            <div>{uploads.filter(u => u.status === 'completed').length} Completed</div>
          </div>
          <div>
            <div style={{ fontSize: '1.5rem', color: '#dc3545' }}>❌</div>
            <div>{uploads.filter(u => u.status === 'error').length} Failed</div>
          </div>
        </div>
      )}
    </div>
  )
}