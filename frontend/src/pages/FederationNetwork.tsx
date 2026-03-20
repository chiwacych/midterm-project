import { useState, useEffect, useCallback } from 'react'
import { getTransferHistory, type TransferStatus } from '../api/client'

/* ── API types matching backend responses ─────────────────── */

interface PeerInfo {
  id: string
  name: string
  endpoint?: string
  addresses?: string[]
  status: 'reachable' | 'connected' | 'unreachable' | string
  latency_ms: number
  mtls_enabled: boolean
}

interface NetworkStatus {
  hospital: { id: string; name: string; status: string }
  security: { mtls_enabled: boolean; encryption: string; certificate_status: string }
  federation: { grpc_service: string; grpc_message: string; peers_count: number; active_connections: number }
  peers: PeerInfo[]
  statistics: { active_exchanges: number; total_consents: number; data_shared_gb: number }
  timestamp: string
}

interface RegistryHospital {
  hospital_id: string
  hospital_name: string
  federation_endpoint: string
  status: string
  registered_at: string
}

interface RegistryData {
  success: boolean
  total_hospitals: number
  hospitals: RegistryHospital[]
}

interface HospitalDetail {
  hospital_id: string
  hospital_name: string
  organization: string
  federation_endpoint: string
  api_endpoint: string
  certificate_fingerprint: string
  ca_fingerprint: string
  certificate_not_before: string
  certificate_not_after: string
  capabilities: {
    file_sharing: boolean
    patient_records: boolean
    dicom_imaging: boolean
    max_file_size_mb: number
    supported_formats: string[]
  }
  contact_email: string
  status: string
  registration_timestamp: string
  version: string
}

interface PeerTestResult {
  peer_id: string
  endpoint: string
  reachable: boolean
  latency_ms: number
  timestamp: string
}

/* ── Styles ───────────────────────────────────────────────── */

const card: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
}

const btn = (variant: 'accent' | 'ghost' | 'danger' | 'success', disabled = false): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '0.45rem 1rem',
  border: variant === 'ghost' ? '1px solid var(--border)' : 'none',
  borderRadius: 7,
  fontWeight: 600,
  fontSize: 13,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.55 : 1,
  background:
    variant === 'accent' ? 'var(--accent)'
    : variant === 'success' ? '#10b981'
    : variant === 'danger' ? '#ef4444'
    : 'transparent',
  color: variant === 'ghost' ? 'var(--text)' : '#fff',
  transition: 'opacity .15s',
})

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '0.5rem 1.25rem',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? '#fff' : 'var(--text)',
  transition: 'all .15s',
})

const badge = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  background: `${color}22`,
  color,
  borderRadius: 12,
  fontSize: 12,
  fontWeight: 600,
})

const kv: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '140px 1fr',
  gap: '0.35rem 0.75rem',
  fontSize: 13,
}

/* ── Helpers ──────────────────────────────────────────────── */

const statusDot = (ok: boolean) => (
  <span style={{
    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
    background: ok ? '#10b981' : '#6b7280', marginRight: 6,
  }} />
)

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : '—'

const peerStatusRank = (status: string): number => {
  if (status === 'reachable') return 2
  if (status === 'connected') return 1
  return 0
}

const preferPeer = (current: PeerInfo, candidate: PeerInfo): PeerInfo => {
  const currentRank = peerStatusRank(current.status)
  const candidateRank = peerStatusRank(candidate.status)

  const mergedCurrent: PeerInfo = {
    ...current,
    endpoint: current.endpoint || candidate.endpoint,
    addresses: current.addresses?.length ? current.addresses : candidate.addresses,
  }

  const mergedCandidate: PeerInfo = {
    ...candidate,
    endpoint: candidate.endpoint || current.endpoint,
    addresses: candidate.addresses?.length ? candidate.addresses : current.addresses,
  }

  if (candidateRank > currentRank) {
    return mergedCandidate
  }
  if (currentRank > candidateRank) {
    return mergedCurrent
  }

  const currentLatency = typeof current.latency_ms === 'number' ? current.latency_ms : -1
  const candidateLatency = typeof candidate.latency_ms === 'number' ? candidate.latency_ms : -1
  if (candidateLatency >= 0 && (currentLatency < 0 || candidateLatency < currentLatency)) {
    return mergedCandidate
  }

  return mergedCurrent
}

const dedupeNetworkPeers = (peers: PeerInfo[]): PeerInfo[] => {
  const byHospitalId = new Map<string, PeerInfo>()
  const withoutId: PeerInfo[] = []

  for (const peer of peers) {
    if (!peer) {
      continue
    }
    if (!peer.id) {
      withoutId.push(peer)
      continue
    }

    const existing = byHospitalId.get(peer.id)
    if (!existing) {
      byHospitalId.set(peer.id, peer)
      continue
    }

    byHospitalId.set(peer.id, preferPeer(existing, peer))
  }

  return [...byHospitalId.values(), ...withoutId]
}

/* ── Component ────────────────────────────────────────────── */

type Tab = 'network' | 'registry' | 'transfers'

export function FederationNetwork() {
  const [tab, setTab] = useState<Tab>('network')

  // Data
  const [net, setNet] = useState<NetworkStatus | null>(null)
  const [registry, setRegistry] = useState<RegistryData | null>(null)
  const [transfers, setTransfers] = useState<TransferStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Actions
  const [registering, setRegistering] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [testingPeer, setTestingPeer] = useState<string | null>(null)
  const [peerTestResult, setPeerTestResult] = useState<PeerTestResult | null>(null)

  // Detail modal
  const [hospitalDetail, setHospitalDetail] = useState<HospitalDetail | null>(null)

  /* ── Fetch data ─────────────────────────────────────────── */
  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statusRes, registryRes, transfersRes] = await Promise.allSettled([
        fetch('/api/federation/network/status').then(r => { if (!r.ok) throw new Error(`Status ${r.status}`); return r.json() }),
        fetch('/api/federation/registry/list').then(r => { if (!r.ok) throw new Error(`Registry ${r.status}`); return r.json() }),
        getTransferHistory(undefined, 50).catch(() => [] as TransferStatus[]),
      ])

      if (statusRes.status === 'fulfilled') {
        const raw = statusRes.value as NetworkStatus
        const dedupedPeers = dedupeNetworkPeers(raw.peers || [])
        setNet({
          ...raw,
          peers: dedupedPeers,
          federation: {
            ...raw.federation,
            peers_count: dedupedPeers.length,
            active_connections: dedupedPeers.filter(p => p.status === 'reachable' || p.status === 'connected').length,
          },
        })
      }
      if (registryRes.status === 'fulfilled') setRegistry(registryRes.value as RegistryData)
      if (transfersRes.status === 'fulfilled') setTransfers(transfersRes.value as TransferStatus[])

      if (statusRes.status === 'rejected' && registryRes.status === 'rejected') {
        setError('Failed to reach federation APIs. Is the backend running?')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fetch failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const iv = setInterval(fetchAll, 30_000)
    return () => clearInterval(iv)
  }, [fetchAll])

  /* ── Actions ────────────────────────────────────────────── */
  const selfRegister = async () => {
    setRegistering(true)
    try {
      const res = await fetch('/api/federation/registry/self-register', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        await fetchAll()
      } else {
        setError(`Registration failed: ${data.message || 'Unknown error'}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Registration error')
    } finally {
      setRegistering(false)
    }
  }

  const discoverPeers = async () => {
    setDiscovering(true)
    try {
      const res = await fetch('/api/federation/registry/discover-now', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        await fetchAll()
      } else {
        setError(`Discovery failed: ${data.message || 'Unknown error'}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Discovery error')
    } finally {
      setDiscovering(false)
    }
  }

  const testPeer = async (peerId: string) => {
    setTestingPeer(peerId)
    setPeerTestResult(null)
    try {
      const res = await fetch(`/api/federation/peers/${peerId}/test`, { method: 'POST' })
      const data = await res.json() as PeerTestResult
      setPeerTestResult(data)
    } catch {
      setPeerTestResult({ peer_id: peerId, endpoint: '', reachable: false, latency_ms: -1, timestamp: new Date().toISOString() })
    } finally {
      setTestingPeer(null)
    }
  }

  const viewHospitalDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/federation/registry/hospital/${id}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setHospitalDetail(await res.json())
    } catch {
      setError('Failed to load hospital details')
    }
  }

  /* ── Summary bar helper ─────────────────────────────────── */
  const healthyPeers = net?.peers.filter(p => p.status === 'reachable').length ?? 0
  const totalPeers = net?.peers.length ?? 0

  /* ═══════════════════════════ RENDER ═══════════════════════ */
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ margin: '0 0 0.15rem', fontSize: '1.5rem' }}>Federation Network</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
            {net ? `${net.hospital.name} — ${totalPeers} peer(s), ${healthyPeers} reachable` : 'Loading...'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={discoverPeers} disabled={discovering} style={btn('ghost', discovering)}>
            {discovering ? 'Discovering...' : 'Discover Peers'}
          </button>
          <button onClick={selfRegister} disabled={registering} style={btn('accent', registering)}>
            {registering ? 'Registering...' : 'Self-Register'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', padding: 4, borderRadius: 10, border: '1px solid var(--border)', marginBottom: '1.25rem' }}>
        {([
          { id: 'network' as Tab, label: 'Network Status' },
          { id: 'registry' as Tab, label: 'Registry' },
          { id: 'transfers' as Tab, label: `Transfers${transfers.length ? ` (${transfers.length})` : ''}` },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={tabBtn(tab === t.id)}>{t.label}</button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, color: '#ef4444', fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {error}
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 700, fontSize: 16 }}>x</button>
        </div>
      )}

      {loading && !net && (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>Loading federation data...</div>
      )}

      {/* ═══════ NETWORK STATUS TAB ═══════ */}
      {tab === 'network' && net && (
        <>
          {/* Security banner */}
          <div style={{
            ...card,
            padding: '1rem 1.25rem',
            marginBottom: '1rem',
            borderLeft: `4px solid ${net.security.mtls_enabled ? '#10b981' : '#f59e0b'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {statusDot(net.security.mtls_enabled)}
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {net.security.mtls_enabled ? 'Secure Federation (mTLS)' : 'Insecure Mode — Development'}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                    Encryption: {net.security.encryption || 'none'} | gRPC: {net.federation.grpc_service}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', textAlign: 'center' }}>
                {[
                  { label: 'Peers', value: totalPeers },
                  { label: 'Active', value: net.federation.active_connections },
                  { label: 'Exchanges', value: net.statistics.active_exchanges },
                ].map(s => (
                  <div key={s.label}>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* This hospital */}
          <div style={{ ...card, padding: '1rem 1.25rem', marginBottom: '1rem', borderLeft: '4px solid var(--accent)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  {statusDot(net.hospital.status === 'healthy')}
                  <span style={{ fontWeight: 600, fontSize: 16 }}>{net.hospital.name}</span>
                  <span style={badge('var(--accent)')}>THIS NODE</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  ID: {net.hospital.id} | Status: {net.hospital.status}
                </div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                Last updated: {fmtDate(net.timestamp)}
              </div>
            </div>
          </div>

          {/* Peer list */}
          <h2 style={{ fontSize: '1.05rem', margin: '1.25rem 0 0.75rem' }}>Peers ({totalPeers})</h2>

          {totalPeers === 0 ? (
            <div style={{ ...card, padding: '2.5rem', textAlign: 'center', color: 'var(--muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>--</div>
              <div>No peers configured. Use <strong>Discover Peers</strong> or <strong>Self-Register</strong> to join the federation.</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {net.peers.map(peer => {
                const reachable = peer.status === 'reachable'
                const endpoint = peer.endpoint || peer.addresses?.[0] || 'N/A'
                return (
                  <div key={peer.id} style={{ ...card, padding: '1rem 1.25rem', borderLeft: `4px solid ${reachable ? '#10b981' : '#6b7280'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          {statusDot(reachable)}
                          <span style={{ fontWeight: 600, fontSize: 15 }}>{peer.name}</span>
                          <span style={badge(reachable ? '#10b981' : '#6b7280')}>{peer.status}</span>
                          {peer.mtls_enabled && <span style={badge('#8b5cf6')}>mTLS</span>}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                          Endpoint: <code style={{ fontSize: 12 }}>{endpoint}</code>
                          {peer.latency_ms > 0 && <> | Latency: {peer.latency_ms}ms</>}
                        </div>
                      </div>
                      <button
                        onClick={() => testPeer(peer.id)}
                        disabled={testingPeer === peer.id}
                        style={btn('ghost', testingPeer === peer.id)}
                      >
                        {testingPeer === peer.id ? 'Testing...' : 'Test Connection'}
                      </button>
                    </div>

                    {/* Show test result inline */}
                    {peerTestResult && peerTestResult.peer_id === peer.id && (
                      <div style={{
                        marginTop: '0.75rem',
                        padding: '0.6rem 0.75rem',
                        borderRadius: 6,
                        background: peerTestResult.reachable ? 'rgba(16,185,129,.08)' : 'rgba(239,68,68,.08)',
                        border: `1px solid ${peerTestResult.reachable ? 'rgba(16,185,129,.2)' : 'rgba(239,68,68,.2)'}`,
                        fontSize: 13,
                      }}>
                        {peerTestResult.reachable
                          ? `Reachable — latency ${peerTestResult.latency_ms >= 0 ? peerTestResult.latency_ms + 'ms' : 'N/A'}`
                          : 'Unreachable — connection failed'}
                        <span style={{ float: 'right', color: 'var(--muted)', fontSize: 12 }}>{fmtDate(peerTestResult.timestamp)}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ═══════ REGISTRY TAB ═══════ */}
      {tab === 'registry' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              {registry ? `${registry.total_hospitals} hospital(s) registered` : 'Loading registry...'}
            </div>
          </div>

          {!registry || registry.hospitals.length === 0 ? (
            <div style={{ ...card, padding: '2.5rem', textAlign: 'center', color: 'var(--muted)' }}>
              No hospitals registered yet. Use <strong>Self-Register</strong> to add this hospital.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {registry.hospitals.map(h => {
                const isSelf = net?.hospital.id === h.hospital_id
                return (
                  <div key={h.hospital_id} style={{ ...card, padding: '1rem 1.25rem', borderLeft: isSelf ? '4px solid var(--accent)' : undefined }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          {statusDot(h.status === 'active')}
                          <span style={{ fontWeight: 600, fontSize: 15 }}>{h.hospital_name}</span>
                          {isSelf && <span style={badge('var(--accent)')}>THIS NODE</span>}
                          <span style={badge(h.status === 'active' ? '#10b981' : '#6b7280')}>{h.status}</span>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                          ID: <code style={{ fontSize: 12 }}>{h.hospital_id}</code> | Endpoint: <code style={{ fontSize: 12 }}>{h.federation_endpoint}</code>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                          Registered: {fmtDate(h.registered_at)}
                        </div>
                      </div>
                      <button onClick={() => viewHospitalDetail(h.hospital_id)} style={btn('ghost')}>
                        View Details
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Hospital detail modal */}
          {hospitalDetail && (
            <div
              onClick={() => setHospitalDetail(null)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}
            >
              <div
                onClick={e => e.stopPropagation()}
                style={{ ...card, maxWidth: 700, width: '100%', maxHeight: '85vh', overflow: 'auto', padding: 0, boxShadow: '0 12px 40px rgba(0,0,0,.25)' }}
              >
                {/* Header */}
                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{hospitalDetail.hospital_name}</h2>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>{hospitalDetail.organization}</div>
                  </div>
                  <button onClick={() => setHospitalDetail(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--muted)' }}>x</button>
                </div>

                {/* Body */}
                <div style={{ padding: '1.25rem 1.5rem', display: 'grid', gap: '1.25rem' }}>
                  {/* Identity */}
                  <section>
                    <h3 style={{ fontSize: 14, margin: '0 0 0.5rem', textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)' }}>Identity</h3>
                    <div style={kv}>
                      <span style={{ color: 'var(--muted)' }}>Hospital ID</span><code style={{ fontSize: 12 }}>{hospitalDetail.hospital_id}</code>
                      <span style={{ color: 'var(--muted)' }}>Contact</span><span>{hospitalDetail.contact_email}</span>
                      <span style={{ color: 'var(--muted)' }}>Version</span><span>{hospitalDetail.version}</span>
                      <span style={{ color: 'var(--muted)' }}>Status</span><span>{statusDot(hospitalDetail.status === 'active')}{hospitalDetail.status}</span>
                    </div>
                  </section>

                  {/* Network */}
                  <section>
                    <h3 style={{ fontSize: 14, margin: '0 0 0.5rem', textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)' }}>Network Endpoints</h3>
                    <div style={kv}>
                      <span style={{ color: 'var(--muted)' }}>Federation</span><code style={{ fontSize: 12 }}>{hospitalDetail.federation_endpoint}</code>
                      <span style={{ color: 'var(--muted)' }}>API</span><code style={{ fontSize: 12 }}>{hospitalDetail.api_endpoint}</code>
                    </div>
                  </section>

                  {/* Certificate */}
                  <section>
                    <h3 style={{ fontSize: 14, margin: '0 0 0.5rem', textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)' }}>Certificate</h3>
                    <div style={kv}>
                      <span style={{ color: 'var(--muted)' }}>Fingerprint</span>
                      <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{hospitalDetail.certificate_fingerprint || '—'}</code>
                      <span style={{ color: 'var(--muted)' }}>CA Fingerprint</span>
                      <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{hospitalDetail.ca_fingerprint || '—'}</code>
                      <span style={{ color: 'var(--muted)' }}>Valid From</span><span>{fmtDate(hospitalDetail.certificate_not_before)}</span>
                      <span style={{ color: 'var(--muted)' }}>Valid Until</span><span>{fmtDate(hospitalDetail.certificate_not_after)}</span>
                    </div>
                  </section>

                  {/* Capabilities */}
                  <section>
                    <h3 style={{ fontSize: 14, margin: '0 0 0.5rem', textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)' }}>Capabilities</h3>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {hospitalDetail.capabilities.file_sharing && <span style={badge('#10b981')}>File Sharing</span>}
                      {hospitalDetail.capabilities.patient_records && <span style={badge('#10b981')}>Patient Records</span>}
                      {hospitalDetail.capabilities.dicom_imaging && <span style={badge('#10b981')}>DICOM Imaging</span>}
                    </div>
                    <div style={kv}>
                      <span style={{ color: 'var(--muted)' }}>Max File Size</span><span>{hospitalDetail.capabilities.max_file_size_mb} MB</span>
                      <span style={{ color: 'var(--muted)' }}>Formats</span><span>{hospitalDetail.capabilities.supported_formats.join(', ')}</span>
                    </div>
                  </section>

                  {/* Registration */}
                  <section>
                    <h3 style={{ fontSize: 14, margin: '0 0 0.5rem', textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)' }}>Registration</h3>
                    <div style={kv}>
                      <span style={{ color: 'var(--muted)' }}>Registered</span><span>{fmtDate(hospitalDetail.registration_timestamp)}</span>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════ TRANSFERS TAB ═══════ */}
      {tab === 'transfers' && (
        <>
          <div style={{ marginBottom: '0.75rem', fontSize: 13, color: 'var(--muted)' }}>
            Cross-hospital file transfers — files shared with or received from other hospitals, including patient metadata
          </div>

          {transfers.length === 0 ? (
            <div style={{ ...card, padding: '2.5rem', textAlign: 'center', color: 'var(--muted)' }}>
              No file transfers yet. Use the <strong>Share</strong> button on a file in the Files page to send it to another hospital.
            </div>
          ) : (
            <div style={{ ...card, padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
                    {['Direction', 'File', 'Patient', 'From / To', 'Status', 'Time'].map(h => (
                      <th key={h} style={{ padding: '0.65rem 0.75rem', fontWeight: 600, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transfers.map(t => {
                    const statusColor =
                      t.status === 'completed' ? '#10b981'
                      : t.status === 'failed' ? '#ef4444'
                      : t.status === 'in_progress' ? '#f59e0b'
                      : '#6b7280'
                    return (
                      <tr key={t.transfer_id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.6rem 0.75rem' }}>
                          <span style={badge(t.direction === 'sent' ? '#3b82f6' : '#8b5cf6')}>
                            {t.direction === 'sent' ? 'Sent' : 'Received'}
                          </span>
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 500 }}>{t.original_filename}</div>
                          {t.file_size && (
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                              {t.file_size > 1048576 ? `${(t.file_size / 1048576).toFixed(1)} MB` : `${(t.file_size / 1024).toFixed(0)} KB`}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem' }}>
                          <div>{t.patient_name || '—'}</div>
                          {t.patient_mrn && <div style={{ fontSize: 11, color: 'var(--muted)' }}>MRN: {t.patient_mrn}</div>}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', fontSize: 12 }}>
                          {t.direction === 'sent'
                            ? <span>To: <strong>{t.dest_hospital_name || t.dest_hospital_id}</strong></span>
                            : <span>From: <strong>{t.source_hospital_name || t.source_hospital_id}</strong></span>
                          }
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem' }}>
                          <span style={badge(statusColor)}>{t.status.replace('_', ' ')}</span>
                          {t.error_message && (
                            <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }} title={t.error_message}>
                              {t.error_message.length > 40 ? t.error_message.slice(0, 40) + '...' : t.error_message}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', fontSize: 12, color: 'var(--muted)' }}>
                          {fmtDate(t.initiated_at)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ═════ Summary footer ═════ */}
      {net && (
        <div style={{ ...card, marginTop: '1.25rem', padding: '0.75rem 1.25rem', display: 'flex', justifyContent: 'space-around', textAlign: 'center', fontSize: 13 }}>
          {[
            { label: 'Reachable', value: healthyPeers, color: '#10b981' },
            { label: 'Unreachable', value: totalPeers - healthyPeers, color: '#6b7280' },
            { label: 'Transfers', value: transfers.length, color: 'var(--accent)' },
            { label: 'gRPC', value: net.federation.grpc_service, color: net.federation.grpc_service === 'healthy' ? '#10b981' : '#f59e0b' },
          ].map(s => (
            <div key={s.label}>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
