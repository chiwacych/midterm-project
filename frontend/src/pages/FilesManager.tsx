import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  listFiles,
  uploadFile,
  deleteFile,
  downloadFile,
  listPatients,
  createPatient,
  api,
  getTransferPeers,
  shareFileToHospital,
  getTransferHistory,
  type FileInfo,
  type Patient,
  type PatientCreate,
  type TransferPeer,
  type TransferStatus,
} from '../api/client'

/* ── Types ─────────────────────────────────────────────────── */
type Tab = 'all' | 'shared' | 'upload'

interface UploadItem {
  id: string
  file: File
  progress: number
  status: 'pending' | 'uploading' | 'completed' | 'error'
  error?: string
  result?: { id: number; filename: string }
  patientId: number
}

/* ── Helpers ───────────────────────────────────────────────── */
const fmtSize = (b: number) =>
  b < 1024
    ? `${b} B`
    : b < 1024 * 1024
      ? `${(b / 1024).toFixed(1)} KB`
      : `${(b / (1024 * 1024)).toFixed(2)} MB`

const isDicom = (name: string, ct: string | null) =>
  /\.(dcm|dicom)$/i.test(name) || (ct ?? '').includes('dicom')

const css = {
  page: { maxWidth: 1100, margin: '0 auto' } as React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: '1rem',
    marginBottom: '1.5rem',
  } as React.CSSProperties,
  tabs: {
    display: 'flex',
    gap: 4,
    background: 'var(--surface)',
    padding: 4,
    borderRadius: 10,
    border: '1px solid var(--border)',
  } as React.CSSProperties,
  tab: (active: boolean) =>
    ({
      padding: '0.5rem 1.25rem',
      border: 'none',
      borderRadius: 8,
      cursor: 'pointer',
      fontWeight: 600,
      fontSize: 14,
      background: active ? 'var(--accent)' : 'transparent',
      color: active ? '#fff' : 'var(--text)',
      transition: 'all .15s',
    }) as React.CSSProperties,
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
  } as React.CSSProperties,
  btn: (variant: 'primary' | 'ghost' | 'danger' | 'muted', disabled = false) =>
    ({
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '0.45rem 1rem',
      border: variant === 'ghost' ? '1px solid var(--border)' : 'none',
      borderRadius: 7,
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontWeight: 500,
      fontSize: 13,
      opacity: disabled ? 0.5 : 1,
      background:
        variant === 'primary'
          ? 'var(--accent)'
          : variant === 'danger'
            ? 'var(--danger)'
            : variant === 'muted'
              ? 'var(--border)'
              : 'transparent',
      color:
        variant === 'primary' || variant === 'danger'
          ? '#fff'
          : 'var(--text)',
      transition: 'opacity .15s',
    }) as React.CSSProperties,
  input: {
    width: '100%',
    padding: '0.55rem 0.75rem',
    borderRadius: 7,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontSize: 14,
  } as React.CSSProperties,
}

/* ── Component ─────────────────────────────────────────────── */
export function FilesManager() {
  const [tab, setTab] = useState<Tab>('all')

  /* shared state */
  const [files, setFiles] = useState<FileInfo[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /* shared (received) files */
  const [sharedFiles, setSharedFiles] = useState<TransferStatus[]>([])
  const [sharedLoading, setSharedLoading] = useState(false)

  /* detail panel */
  const [detailFile, setDetailFile] = useState<FileInfo | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  /* upload queue */
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /* new patient mini-form */
  const [showNewPatient, setShowNewPatient] = useState(false)
  const [newPatient, setNewPatient] = useState<PatientCreate>({
    full_name: '',
    date_of_birth: '',
    email: '',
    phone: '',
  })
  const [patientErr, setPatientErr] = useState<string | null>(null)

  /* search / filter */
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filterContentType, setFilterContentType] = useState('')
  const [filterSizeMin, setFilterSizeMin] = useState('')
  const [filterSizeMax, setFilterSizeMax] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const hasActiveFilters = !!(filterContentType || filterSizeMin || filterSizeMax || filterDateFrom || filterDateTo)

  /* share dialog */
  const [shareFile, setShareFile] = useState<FileInfo | null>(null)
  const [sharePeers, setSharePeers] = useState<TransferPeer[]>([])
  const [shareTarget, setShareTarget] = useState<TransferPeer | null>(null)
  const [shareReason, setShareReason] = useState('Clinical consultation')
  const [sharing, setSharing] = useState(false)
  const [shareResult, setShareResult] = useState<string | null>(null)

  /* ── Data loading ──────────────────────────────────────── */
  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      listFiles().then((d) => setFiles(d.files)),
      listPatients().then(setPatients),
    ])
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  /* load shared (received) transfers */
  const loadShared = useCallback(() => {
    setSharedLoading(true)
    getTransferHistory('received', 100)
      .then(setSharedFiles)
      .catch(() => setSharedFiles([]))
      .finally(() => setSharedLoading(false))
  }, [])

  useEffect(() => {
    loadShared()
  }, [loadShared])

  /* ── Upload logic ──────────────────────────────────────── */
  const startUpload = useCallback(
    async (item: UploadItem) => {
      setUploads((p) =>
        p.map((u) => (u.id === item.id ? { ...u, status: 'uploading' } : u)),
      )
      const iv = setInterval(() => {
        setUploads((p) =>
          p.map((u) =>
            u.id === item.id && u.progress < 90
              ? { ...u, progress: u.progress + Math.random() * 15 }
              : u,
          ),
        )
      }, 250)
      try {
        const res = await uploadFile(
          item.file,
          item.patientId,
          `Uploaded: ${item.file.name}`,
        )
        clearInterval(iv)
        setUploads((p) =>
          p.map((u) =>
            u.id === item.id
              ? {
                  ...u,
                  progress: 100,
                  status: 'completed',
                  result: res as { id: number; filename: string },
                }
              : u,
          ),
        )
        load()
      } catch (err) {
        clearInterval(iv)
        setUploads((p) =>
          p.map((u) =>
            u.id === item.id
              ? {
                  ...u,
                  status: 'error',
                  error: err instanceof Error ? err.message : 'Upload failed',
                }
              : u,
          ),
        )
      }
    },
    [load],
  )

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      if (!selectedPatientId) return
      const items: UploadItem[] = Array.from(fileList).map((f) => ({
        id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
        file: f,
        progress: 0,
        status: 'pending' as const,
        patientId: selectedPatientId,
      }))
      setUploads((p) => [...p, ...items])
      items.forEach((i) => startUpload(i))
    },
    [selectedPatientId, startUpload],
  )

  const retryUpload = (item: UploadItem) => {
    setUploads((p) =>
      p.map((u) =>
        u.id === item.id
          ? { ...u, status: 'pending', progress: 0, error: undefined }
          : u,
      ),
    )
    startUpload(item)
  }

  /* ── Patient create ────────────────────────────────────── */
  const handleCreatePatient = async () => {
    if (!newPatient.full_name || !newPatient.date_of_birth) {
      setPatientErr('Name and date of birth are required')
      return
    }
    try {
      const p = await createPatient(newPatient)
      setPatients((prev) => [...prev, p])
      setSelectedPatientId(p.id)
      setShowNewPatient(false)
      setNewPatient({ full_name: '', date_of_birth: '', email: '', phone: '' })
      setPatientErr(null)
    } catch (err) {
      setPatientErr(err instanceof Error ? err.message : 'Failed')
    }
  }

  /* ── Delete ────────────────────────────────────────────── */
  const onDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return
    try {
      await deleteFile(id)
      if (detailFile?.id === id) setDetailFile(null)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  /* ── Share to hospital ─────────────────────────────────── */
  const openShareDialog = async (f: FileInfo) => {
    setShareFile(f)
    setShareTarget(null)
    setShareReason('Clinical consultation')
    setShareResult(null)
    try {
      const { peers } = await getTransferPeers()
      setSharePeers(peers)
    } catch {
      setSharePeers([])
    }
  }

  const executeShare = async () => {
    if (!shareFile || !shareTarget) return
    setSharing(true)
    setShareResult(null)
    try {
      const res = await shareFileToHospital(
        shareFile.id,
        shareTarget.hospital_id,
        shareTarget.api_endpoint,
        shareReason,
      )
      setShareResult(res.success ? `Transfer initiated (${res.transfer_id.slice(0, 8)}...)` : res.message)
      if (res.success) {
        setTimeout(() => { setShareFile(null); setShareResult(null) }, 2000)
      }
    } catch (err) {
      setShareResult(err instanceof Error ? err.message : 'Share failed')
    } finally {
      setSharing(false)
    }
  }

  /* ── Detail panel ──────────────────────────────────────── */
  const openDetail = async (f: FileInfo) => {
    setDetailFile(f)
    setDetailLoading(true)
    try {
      const data = await api<{ file: FileInfo }>(`/files/${f.id}`)
      setDetailFile(data.file)
    } catch {
      /* keep basic info */
    } finally {
      setDetailLoading(false)
    }
  }

  /* ── Filtered files ────────────────────────────────────── */
  const filtered = files.filter((f) => {
    if (search && !f.filename.toLowerCase().includes(search.toLowerCase()) && !(f.description ?? '').toLowerCase().includes(search.toLowerCase())) return false
    if (filterContentType && f.content_type !== filterContentType) return false
    if (filterSizeMin && f.size < Number(filterSizeMin) * 1024) return false
    if (filterSizeMax && f.size > Number(filterSizeMax) * 1024) return false
    if (filterDateFrom && new Date(f.upload_timestamp) < new Date(filterDateFrom)) return false
    if (filterDateTo && new Date(f.upload_timestamp) > new Date(filterDateTo + 'T23:59:59')) return false
    return true
  })

  const clearFilters = () => {
    setFilterContentType(''); setFilterSizeMin(''); setFilterSizeMax('')
    setFilterDateFrom(''); setFilterDateTo(''); setSearch('')
  }

  const queueStats = {
    pending: uploads.filter((u) => u.status === 'pending').length,
    uploading: uploads.filter((u) => u.status === 'uploading').length,
    completed: uploads.filter((u) => u.status === 'completed').length,
    error: uploads.filter((u) => u.status === 'error').length,
  }

  /* ── Drag handlers ─────────────────────────────────────── */
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (tab === 'upload') setIsDragOver(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (tab !== 'upload' || !selectedPatientId) return
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  /* ── Render ────────────────────────────────────────────── */
  return (
    <div style={css.page} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {/* Header */}
      <div style={css.header}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Files</h1>
        <div style={css.tabs}>
          <button style={css.tab(tab === 'all')} onClick={() => setTab('all')}>
            All Files
          </button>
          <button style={css.tab(tab === 'shared')} onClick={() => setTab('shared')}>
            Shared
            {sharedFiles.length > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  background: '#fff3',
                  borderRadius: 20,
                  padding: '1px 8px',
                  fontSize: 12,
                }}
              >
                {sharedFiles.length}
              </span>
            )}
          </button>
          <button style={css.tab(tab === 'upload')} onClick={() => setTab('upload')}>
            Upload
            {uploads.length > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  background: '#fff3',
                  borderRadius: 20,
                  padding: '1px 8px',
                  fontSize: 12,
                }}
              >
                {uploads.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '0.75rem 1rem',
            background: 'rgba(220,53,69,.1)',
            border: '1px solid var(--danger)',
            borderRadius: 8,
            color: 'var(--danger)',
            marginBottom: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ═══════════════ ALL FILES TAB ═══════════════ */}
      {tab === 'all' && (
        <div style={{ display: 'flex', gap: '1rem' }}>
          {/* File list */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Search bar + filter toggle */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: showFilters ? '0.75rem' : '1rem' }}>
              <input
                placeholder="Search files by name or description…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ ...css.input, padding: '0.6rem 1rem', flex: 1 }}
              />
              <button
                onClick={() => setShowFilters(v => !v)}
                style={{
                  ...css.btn(showFilters || hasActiveFilters ? 'primary' : 'ghost'),
                  whiteSpace: 'nowrap',
                }}
              >
                {showFilters ? '▲ Filters' : '▼ Filters'}
                {hasActiveFilters && !showFilters && (
                  <span style={{ marginLeft: 6, background: '#fff3', borderRadius: 10, padding: '1px 7px', fontSize: 11 }}>!</span>
                )}
              </button>
              {hasActiveFilters && (
                <button onClick={clearFilters} style={{ ...css.btn('danger'), whiteSpace: 'nowrap', padding: '0.4rem 0.75rem' }}>Clear</button>
              )}
            </div>

            {/* Advanced filters panel */}
            {showFilters && (
              <div style={{ ...css.card, padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>Content Type</label>
                    <select value={filterContentType} onChange={e => setFilterContentType(e.target.value)} style={css.input}>
                      <option value="">All types</option>
                      <option value="application/dicom">DICOM</option>
                      <option value="image/jpeg">JPEG</option>
                      <option value="image/png">PNG</option>
                      <option value="application/pdf">PDF</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>Min Size (KB)</label>
                    <input type="number" placeholder="0" value={filterSizeMin} onChange={e => setFilterSizeMin(e.target.value)} style={css.input} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>Max Size (KB)</label>
                    <input type="number" placeholder="∞" value={filterSizeMax} onChange={e => setFilterSizeMax(e.target.value)} style={css.input} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>From Date</label>
                    <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} style={css.input} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>To Date</label>
                    <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} style={css.input} />
                  </div>
                </div>
              </div>
            )}

            <div style={css.card}>
              {loading ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
                  Loading files…
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
                  {search ? 'No files match your search.' : 'No files yet. Switch to the Upload tab to add files.'}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
                      <th style={{ padding: '0.7rem 1rem', fontWeight: 600, fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
                        File
                      </th>
                      <th style={{ padding: '0.7rem 1rem', fontWeight: 600, fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
                        Size
                      </th>
                      <th style={{ padding: '0.7rem 1rem', fontWeight: 600, fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
                        Uploaded
                      </th>
                      <th style={{ padding: '0.7rem 1rem', fontWeight: 600, fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', width: 150 }}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((f) => (
                      <tr
                        key={f.id}
                        onClick={() => openDetail(f)}
                        style={{
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer',
                          background: detailFile?.id === f.id ? 'rgba(var(--accent-rgb, 59,130,246), .06)' : undefined,
                          transition: 'background .1s',
                        }}
                        onMouseEnter={(e) => {
                          if (detailFile?.id !== f.id) (e.currentTarget.style.background = 'rgba(128,128,128,.06)')
                        }}
                        onMouseLeave={(e) => {
                          if (detailFile?.id !== f.id) (e.currentTarget.style.background = '')
                        }}
                      >
                        <td style={{ padding: '0.65rem 1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 18 }}>
                              {isDicom(f.filename, f.content_type) ? '🩺' : '📄'}
                            </span>
                            <div>
                              <div style={{ fontWeight: 500, fontSize: 14 }}>{f.filename}</div>
                              {f.description && (
                                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                                  {f.description}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '0.65rem 1rem', color: 'var(--muted)', fontSize: 14 }}>
                          {fmtSize(f.size)}
                        </td>
                        <td style={{ padding: '0.65rem 1rem', color: 'var(--muted)', fontSize: 13 }}>
                          {new Date(f.upload_timestamp).toLocaleDateString()}{' '}
                          <span style={{ opacity: 0.6 }}>
                            {new Date(f.upload_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </td>
                        <td style={{ padding: '0.65rem 1rem' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              title="Share to hospital"
                              onClick={() => openShareDialog(f)}
                              style={{ ...css.btn('primary'), padding: '0.3rem 0.6rem' }}
                            >
                              ⇄
                            </button>
                            <button
                              title="Download"
                              onClick={() => downloadFile(f.id, f.filename).catch((e) => setError(e.message))}
                              style={{ ...css.btn('ghost'), padding: '0.3rem 0.6rem' }}
                            >
                              ↓
                            </button>
                            <button
                              title="Delete"
                              onClick={() => onDelete(f.id, f.filename)}
                              style={{ ...css.btn('danger'), padding: '0.3rem 0.6rem' }}
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!loading && (
                <div
                  style={{
                    padding: '0.6rem 1rem',
                    borderTop: '1px solid var(--border)',
                    fontSize: 13,
                    color: 'var(--muted)',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>
                    {filtered.length} file{filtered.length !== 1 ? 's' : ''}
                    {search && ` matching "${search}"`}
                  </span>
                  <span>
                    Total: {fmtSize(filtered.reduce((a, f) => a + f.size, 0))}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Detail panel */}
          {detailFile && (
            <div
              style={{
                width: 340,
                flexShrink: 0,
                ...css.card,
                padding: '1.25rem',
                alignSelf: 'flex-start',
                position: 'sticky',
                top: '1rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>
                  {isDicom(detailFile.filename, detailFile.content_type) ? '🩺 DICOM' : '📄 File'} Details
                </h3>
                <button
                  onClick={() => setDetailFile(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}
                >
                  ✕
                </button>
              </div>

              {detailLoading ? (
                <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem 0' }}>Loading…</div>
              ) : (
                <>
                  <DetailRow label="Filename" value={detailFile.filename} />
                  <DetailRow label="Size" value={fmtSize(detailFile.size)} />
                  <DetailRow label="Type" value={detailFile.content_type || '—'} />
                  <DetailRow label="Uploaded" value={new Date(detailFile.upload_timestamp).toLocaleString()} />
                  {detailFile.checksum && <DetailRow label="SHA-256" value={detailFile.checksum} mono />}
                  {detailFile.description && <DetailRow label="Description" value={detailFile.description} />}

                  {/* DICOM metadata section */}
                  {isDicom(detailFile.filename, detailFile.content_type) && (
                    <div
                      style={{
                        marginTop: '1rem',
                        padding: '0.75rem',
                        background: 'rgba(var(--accent-rgb,59,130,246),.06)',
                        borderRadius: 8,
                        border: '1px solid rgba(var(--accent-rgb,59,130,246),.15)',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--accent)' }}>
                        DICOM Metadata
                      </div>
                      <DetailRow label="Modality" value={(detailFile as any).dicom_modality || '—'} />
                      <DetailRow label="Study ID" value={(detailFile as any).dicom_study_id || '—'} />
                      <DetailRow label="Series ID" value={(detailFile as any).dicom_series_id || '—'} />
                      <DetailRow
                        label="Study Date"
                        value={(detailFile as any).dicom_study_date || '—'}
                      />
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem' }}>
                    <button
                      onClick={() => openShareDialog(detailFile)}
                      style={{ ...css.btn('primary'), flex: 1, justifyContent: 'center' }}
                    >
                      ⇄ Share
                    </button>
                    <button
                      onClick={() =>
                        downloadFile(detailFile.id, detailFile.filename).catch((e) =>
                          setError(e.message),
                        )
                      }
                      style={{ ...css.btn('ghost'), flex: 1, justifyContent: 'center' }}
                    >
                      ↓ Download
                    </button>
                    <button
                      onClick={() => onDelete(detailFile.id, detailFile.filename)}
                      style={{ ...css.btn('danger') }}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════ SHARED TAB ═══════════════ */}
      {tab === 'shared' && (
        <div style={css.card}>
          {sharedLoading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>Loading shared files…</div>
          ) : sharedFiles.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
              No files have been shared to this hospital yet.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
                  <th style={{ padding: '0.7rem 1rem', fontWeight: 600, fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>File</th>
                  <th style={{ padding: '0.7rem 1rem', fontWeight: 600, fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>From Hospital</th>
                  <th style={{ padding: '0.7rem 1rem', fontWeight: 600, fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Patient</th>
                  <th style={{ padding: '0.7rem 1rem', fontWeight: 600, fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Size</th>
                  <th style={{ padding: '0.7rem 1rem', fontWeight: 600, fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Status</th>
                  <th style={{ padding: '0.7rem 1rem', fontWeight: 600, fontSize: 13, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Received</th>
                </tr>
              </thead>
              <tbody>
                {sharedFiles.map((t) => (
                  <tr key={t.transfer_id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.65rem 1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 18 }}>
                          {isDicom(t.original_filename, null) ? '🩺' : '📄'}
                        </span>
                        <span style={{ fontWeight: 500, fontSize: 14 }}>{t.original_filename}</span>
                      </div>
                    </td>
                    <td style={{ padding: '0.65rem 1rem', fontSize: 14 }}>
                      {t.source_hospital_name || t.source_hospital_id}
                    </td>
                    <td style={{ padding: '0.65rem 1rem', fontSize: 14, color: 'var(--muted)' }}>
                      {t.patient_name || '—'}
                      {t.patient_mrn && <span style={{ fontSize: 12, marginLeft: 4 }}>({t.patient_mrn})</span>}
                    </td>
                    <td style={{ padding: '0.65rem 1rem', color: 'var(--muted)', fontSize: 14 }}>
                      {t.file_size ? fmtSize(t.file_size) : '—'}
                    </td>
                    <td style={{ padding: '0.65rem 1rem' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        background: t.status === 'completed' ? 'rgba(34,197,94,.1)' : t.status === 'failed' ? 'rgba(239,68,68,.1)' : 'rgba(245,158,11,.1)',
                        color: t.status === 'completed' ? '#16a34a' : t.status === 'failed' ? '#dc2626' : '#d97706',
                      }}>
                        {t.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.65rem 1rem', color: 'var(--muted)', fontSize: 13 }}>
                      {t.completed_at ? new Date(t.completed_at).toLocaleString() : t.initiated_at ? new Date(t.initiated_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!sharedLoading && sharedFiles.length > 0 && (
            <div style={{
              padding: '0.6rem 1rem',
              borderTop: '1px solid var(--border)',
              fontSize: 13,
              color: 'var(--muted)',
              display: 'flex',
              justifyContent: 'space-between',
            }}>
              <span>{sharedFiles.length} shared file{sharedFiles.length !== 1 ? 's' : ''}</span>
              <button onClick={loadShared} style={{ ...css.btn('ghost'), padding: '0.2rem 0.6rem', fontSize: 12 }}>↻ Refresh</button>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════ UPLOAD TAB ═══════════════ */}
      {tab === 'upload' && (
        <>
          {/* Patient selector */}
          <div style={{ ...css.card, padding: '1.25rem', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: 14 }}>
              Patient <span style={{ color: 'var(--danger)' }}>*</span>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={selectedPatientId ?? ''}
                onChange={(e) => setSelectedPatientId(Number(e.target.value) || null)}
                style={{ ...css.input, flex: 1, minWidth: 200 }}
              >
                <option value="">— Select a patient —</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                    {p.date_of_birth ? ` (DOB: ${p.date_of_birth})` : ''}
                  </option>
                ))}
              </select>
              <button style={css.btn('ghost')} onClick={() => setShowNewPatient(!showNewPatient)}>
                + New Patient
              </button>
            </div>

            {showNewPatient && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  background: 'var(--background)',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Full Name <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      style={css.input}
                      value={newPatient.full_name}
                      onChange={(e) => setNewPatient({ ...newPatient, full_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Date of Birth <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      type="date"
                      style={css.input}
                      value={newPatient.date_of_birth}
                      onChange={(e) => setNewPatient({ ...newPatient, date_of_birth: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Email</label>
                    <input
                      type="email"
                      style={css.input}
                      value={newPatient.email ?? ''}
                      onChange={(e) => setNewPatient({ ...newPatient, email: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Phone</label>
                    <input
                      type="tel"
                      style={css.input}
                      value={newPatient.phone ?? ''}
                      onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })}
                    />
                  </div>
                </div>
                {patientErr && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{patientErr}</div>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: '0.75rem' }}>
                  <button
                    style={css.btn('ghost')}
                    onClick={() => {
                      setShowNewPatient(false)
                      setPatientErr(null)
                    }}
                  >
                    Cancel
                  </button>
                  <button style={css.btn('primary')} onClick={handleCreatePatient}>
                    Create Patient
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Drop zone */}
          <div
            onClick={() => selectedPatientId && fileInputRef.current?.click()}
            style={{
              ...css.card,
              padding: '2.5rem 2rem',
              textAlign: 'center',
              borderStyle: 'dashed',
              borderWidth: 2,
              cursor: selectedPatientId ? 'pointer' : 'not-allowed',
              opacity: selectedPatientId ? 1 : 0.5,
              background: isDragOver
                ? 'rgba(var(--accent-rgb,59,130,246),.08)'
                : 'var(--surface)',
              transition: 'all .2s',
              marginBottom: '1rem',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 8 }}>{isDragOver ? '🎯' : '📤'}</div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              {selectedPatientId
                ? 'Drop files here or click to browse'
                : 'Select a patient above first'}
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
              Supports DICOM (.dcm), JPEG, PNG, PDF — multiple files allowed
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.dcm,.dicom,application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files)
              e.target.value = ''
            }}
          />

          {/* Queue stats */}
          {uploads.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: '1rem',
                marginBottom: '1rem',
                flexWrap: 'wrap',
              }}
            >
              {[
                { label: 'Pending', count: queueStats.pending, color: '#f59e0b' },
                { label: 'Uploading', count: queueStats.uploading, color: 'var(--accent)' },
                { label: 'Completed', count: queueStats.completed, color: '#22c55e' },
                { label: 'Failed', count: queueStats.error, color: 'var(--danger)' },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{
                    ...css.card,
                    flex: 1,
                    minWidth: 100,
                    padding: '0.75rem 1rem',
                    textAlign: 'center',
                    borderLeft: `3px solid ${s.color}`,
                  }}
                >
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{s.count}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.label}</div>
                </div>
              ))}

              <button
                onClick={() => setUploads((p) => p.filter((u) => u.status !== 'completed'))}
                style={{ ...css.btn('muted'), alignSelf: 'center' }}
              >
                Clear Done
              </button>
            </div>
          )}

          {/* Queue items */}
          {uploads.length === 0 ? (
            <div style={{ ...css.card, padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
              No files in the upload queue yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {uploads.map((item) => (
                <div
                  key={item.id}
                  style={{
                    ...css.card,
                    padding: '0.85rem 1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                  }}
                >
                  {/* icon */}
                  <span style={{ fontSize: 20 }}>
                    {item.status === 'completed'
                      ? '✅'
                      : item.status === 'error'
                        ? '❌'
                        : item.status === 'uploading'
                          ? '🔄'
                          : '⏳'}
                  </span>

                  {/* info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.file.name}
                      </span>
                      <span style={{ color: 'var(--muted)', fontSize: 12, flexShrink: 0, marginLeft: 8 }}>
                        {fmtSize(item.file.size)}
                      </span>
                    </div>

                    {item.status === 'uploading' && (
                      <div style={{ marginTop: 6 }}>
                        <div
                          style={{
                            width: '100%',
                            height: 6,
                            background: 'var(--border)',
                            borderRadius: 3,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(item.progress, 100)}%`,
                              height: '100%',
                              background: 'var(--accent)',
                              borderRadius: 3,
                              transition: 'width .3s',
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {item.error && (
                      <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{item.error}</div>
                    )}
                  </div>

                  {/* actions */}
                  <div style={{ display: 'flex', gap: 4 }}>
                    {item.status === 'error' && (
                      <button onClick={() => retryUpload(item)} style={css.btn('ghost')} title="Retry">
                        ↻
                      </button>
                    )}
                    <button
                      onClick={() => setUploads((p) => p.filter((u) => u.id !== item.id))}
                      style={{ ...css.btn('ghost'), padding: '0.3rem 0.5rem' }}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ═══════════════ SHARE DIALOG ═══════════════ */}
      {shareFile && (
        <div
          onClick={() => setShareFile(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '2rem',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface)', borderRadius: 12,
              border: '1px solid var(--border)', maxWidth: 480, width: '100%',
              padding: 0, boxShadow: '0 12px 40px rgba(0,0,0,.25)', overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Share to Hospital</h2>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{shareFile.filename}</div>
              </div>
              <button onClick={() => setShareFile(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--muted)' }}>x</button>
            </div>

            {/* Body */}
            <div style={{ padding: '1.25rem 1.5rem', display: 'grid', gap: '1rem' }}>
              {/* Target hospital */}
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Target Hospital
                </label>
                {sharePeers.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--muted)', padding: '0.75rem', background: 'rgba(239,68,68,.06)', borderRadius: 8, border: '1px solid rgba(239,68,68,.15)' }}>
                    No peer hospitals found. Register in the Federation Network page first.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {sharePeers.map((p) => (
                      <button
                        key={p.hospital_id}
                        onClick={() => setShareTarget(p)}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '0.65rem 0.75rem', borderRadius: 8, cursor: 'pointer',
                          background: shareTarget?.hospital_id === p.hospital_id ? 'rgba(59,130,246,.12)' : 'transparent',
                          border: shareTarget?.hospital_id === p.hospital_id ? '2px solid var(--accent)' : '1px solid var(--border)',
                          color: 'var(--text)', textAlign: 'left', fontSize: 14,
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600 }}>{p.hospital_name}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.api_endpoint}</div>
                        </div>
                        <span style={{
                          fontSize: 11, padding: '2px 6px', borderRadius: 4,
                          background: 'rgba(139,92,246,.1)', color: '#8b5cf6',
                        }}>
                          {p.source}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Reason */}
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Reason
                </label>
                <input
                  value={shareReason}
                  onChange={(e) => setShareReason(e.target.value)}
                  placeholder="Clinical consultation, second opinion..."
                  style={{
                    width: '100%', padding: '0.5rem 0.75rem', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--bg)',
                    color: 'var(--text)', fontSize: 14, boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Result */}
              {shareResult && (
                <div style={{
                  padding: '0.6rem 0.75rem', borderRadius: 8, fontSize: 13,
                  background: shareResult.startsWith('Transfer') ? 'rgba(16,185,129,.08)' : 'rgba(239,68,68,.08)',
                  border: `1px solid ${shareResult.startsWith('Transfer') ? 'rgba(16,185,129,.2)' : 'rgba(239,68,68,.2)'}`,
                  color: shareResult.startsWith('Transfer') ? '#10b981' : '#ef4444',
                }}>
                  {shareResult}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setShareFile(null)} style={css.btn('ghost')}>Cancel</button>
              <button
                onClick={executeShare}
                disabled={!shareTarget || sharing}
                style={css.btn('primary', !shareTarget || sharing)}
              >
                {sharing ? 'Sharing...' : 'Share File'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Sub-components ──────────────────────────────────────── */
function DetailRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 2 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          wordBreak: 'break-all',
          fontFamily: mono ? 'monospace' : 'inherit',
          ...(mono ? { fontSize: 11 } : {}),
        }}
      >
        {value}
      </div>
    </div>
  )
}
