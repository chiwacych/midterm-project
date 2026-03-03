import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  getProfile,
  updateProfile,
  changePassword,
  toggle2FA,
  UserProfile as ApiUserProfile,
  getComplianceReport,
  getAccessSummary,
  ComplianceSummary,
  AccessSummaryReport,
  listAuditEvents,
  AuditEvent as ApiAuditEvent,
} from '../api/client'

/* ────────────── Styles ────────────── */
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

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '0.6rem 1.25rem',
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? '#fff' : 'var(--text)',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: active ? 600 : 400,
  fontSize: 14,
  transition: 'all 0.2s',
})

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 14,
}

const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: 'var(--muted)',
  marginBottom: 4,
  fontWeight: 500,
}

/* ────────────── Profile transform ────────────── */
interface LocalProfile {
  id: string
  email: string
  firstName: string
  lastName: string
  role: 'patient' | 'doctor' | 'admin'
  phone: string
  department: string
  licenseNumber: string
  dateOfBirth: string
  bio: string
  emergencyContact: { name: string; phone: string; relationship: string }
  preferences: {
    theme: 'light' | 'dark' | 'auto'
    notifications: { email: boolean; sms: boolean; push: boolean }
    language: string
    timezone: string
  }
  security: { twoFactorEnabled: boolean; lastPasswordChange: string }
  stats: { filesUploaded: number; filesDownloaded: number; consentsGranted: number; lastLogin: string }
}

const toLocal = (p: ApiUserProfile): LocalProfile => {
  const parts = (p.full_name || '').split(' ')
  return {
    id: String(p.id),
    email: p.email,
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || '',
    role: p.role,
    phone: p.phone || '',
    department: p.department || '',
    licenseNumber: p.license_number || '',
    dateOfBirth: p.date_of_birth || '',
    bio: p.bio || '',
    emergencyContact: {
      name: p.emergency_contact?.name || '',
      phone: p.emergency_contact?.phone || '',
      relationship: p.emergency_contact?.relationship || '',
    },
    preferences: {
      theme: p.preferences?.theme || 'dark',
      notifications: p.preferences?.notifications || { email: true, sms: false, push: false },
      language: p.preferences?.language || 'en',
      timezone: p.preferences?.timezone || 'Africa/Nairobi',
    },
    security: {
      twoFactorEnabled: p.two_factor_enabled,
      lastPasswordChange: p.last_password_change || '',
    },
    stats: {
      filesUploaded: p.stats?.files_uploaded || 0,
      filesDownloaded: p.stats?.files_downloaded || 0,
      consentsGranted: p.stats?.consents_granted || 0,
      lastLogin: p.stats?.last_login || '',
    },
  }
}

/* ────────────── Audit helpers ────────────── */
interface AuditRow {
  id: string; timestamp: string; eventType: string; userId: string; userRole: string
  action: string; resource: string; resourceId: string; ipAddress: string
  status: 'success' | 'failure' | 'warning'; severity: 'low' | 'medium' | 'high' | 'critical'
  details: Record<string, unknown>
}

const toAudit = (e: ApiAuditEvent): AuditRow => ({
  id: String(e.id), timestamp: e.timestamp, eventType: e.event_type,
  userId: String(e.user_id ?? ''), userRole: e.user_role ?? '',
  action: e.action, resource: e.resource ?? '', resourceId: e.resource_id ?? '',
  ipAddress: e.ip_address ?? '', status: e.status, severity: e.severity,
  details: e.details ?? {},
})

const sevColor: Record<string, string> = { low: '#6b7280', medium: '#3b82f6', high: '#f97316', critical: '#ef4444' }
const statColor: Record<string, string> = { success: '#10b981', failure: '#ef4444', warning: '#f59e0b' }

/* ────────────── Component ────────────── */
type Tab = 'profile' | 'security' | 'compliance' | 'audit'

export function AccountSettings() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isStaff = user?.role === 'doctor' || user?.role === 'admin'

  // ── Profile state ──
  const [profile, setProfile] = useState<LocalProfile | null>(null)
  const [editForm, setEditForm] = useState<Partial<LocalProfile>>({})
  const [isEditing, setIsEditing] = useState(false)
  const [profileLoading, setProfileLoading] = useState(true)

  // ── Compliance state ──
  const [compliance, setCompliance] = useState<ComplianceSummary | null>(null)
  const [accessSummary, setAccessSummary] = useState<AccessSummaryReport | null>(null)
  const [compDays, setCompDays] = useState(30)
  const [compLoading, setCompLoading] = useState(false)

  // ── Audit state ──
  const [auditRows, setAuditRows] = useState<AuditRow[]>([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage] = useState(1)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditSearch, setAuditSearch] = useState('')
  const [auditFilters, setAuditFilters] = useState({ event_type: '', status: '', severity: '' })
  const [selectedEvent, setSelectedEvent] = useState<AuditRow | null>(null)

  // ── Global ──
  const [activeTab, setActiveTab] = useState<Tab>('profile')
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => { if (successMsg) { const t = setTimeout(() => setSuccessMsg(null), 4000); return () => clearTimeout(t) } }, [successMsg])

  // ── Load profile ──
  useEffect(() => {
    (async () => {
      setProfileLoading(true)
      try { const p = await getProfile(); const l = toLocal(p); setProfile(l); setEditForm(l) }
      catch (e) { setErrorMsg(e instanceof Error ? e.message : 'Failed to load profile') }
      finally { setProfileLoading(false) }
    })()
  }, [])

  // ── Load compliance ──
  useEffect(() => {
    if (!isAdmin || activeTab !== 'compliance') return
    ;(async () => {
      setCompLoading(true)
      try {
        const [c, a] = await Promise.all([getComplianceReport(compDays), getAccessSummary(compDays)])
        setCompliance(c); setAccessSummary(a)
      } catch (e) { setErrorMsg(e instanceof Error ? e.message : 'Failed to load compliance data') }
      finally { setCompLoading(false) }
    })()
  }, [isAdmin, activeTab, compDays])

  // ── Load audit ──
  useEffect(() => {
    if (!isStaff || activeTab !== 'audit') return
    ;(async () => {
      setAuditLoading(true)
      try {
        const f: Record<string, string | number> = { page: auditPage, page_size: 20 }
        if (auditFilters.event_type) f.event_type = auditFilters.event_type
        if (auditFilters.status) f.status = auditFilters.status
        if (auditFilters.severity) f.severity = auditFilters.severity
        const res = await listAuditEvents(f as any)
        setAuditRows(res.events.map(toAudit))
        setAuditTotal(res.total)
      } catch (e) { setErrorMsg(e instanceof Error ? e.message : 'Failed to load audit logs') }
      finally { setAuditLoading(false) }
    })()
  }, [isStaff, activeTab, auditPage, auditFilters])

  // ── Profile handlers ──
  const handleSave = async () => {
    if (!profile || !editForm) return
    try {
      await updateProfile({
        full_name: `${editForm.firstName || ''} ${editForm.lastName || ''}`.trim(),
        phone: editForm.phone, department: editForm.department,
        license_number: editForm.licenseNumber, date_of_birth: editForm.dateOfBirth,
        bio: editForm.bio,
        emergency_contact_name: editForm.emergencyContact?.name,
        emergency_contact_phone: editForm.emergencyContact?.phone,
        emergency_contact_relationship: editForm.emergencyContact?.relationship,
      })
      setProfile({ ...profile, ...editForm } as LocalProfile)
      setIsEditing(false)
      setSuccessMsg('Profile updated')
    } catch (e) { setErrorMsg(e instanceof Error ? e.message : 'Save failed') }
  }

  const handleChangePassword = async () => {
    const cur = prompt('Enter current password:')
    if (!cur) return
    const nw = prompt('Enter new password (min 6 chars):')
    if (!nw || nw.length < 6) { setErrorMsg('Password must be at least 6 characters'); return }
    try {
      await changePassword(cur, nw)
      setProfile(p => p ? { ...p, security: { ...p.security, lastPasswordChange: new Date().toISOString() } } : null)
      setSuccessMsg('Password changed')
    } catch (e) { setErrorMsg(e instanceof Error ? e.message : 'Password change failed') }
  }

  const handleToggle2FA = async () => {
    try {
      const r = await toggle2FA()
      setProfile(p => p ? { ...p, security: { ...p.security, twoFactorEnabled: r.two_factor_enabled } } : null)
      setSuccessMsg(`2FA ${r.two_factor_enabled ? 'enabled' : 'disabled'}`)
    } catch (e) { setErrorMsg(e instanceof Error ? e.message : '2FA toggle failed') }
  }

  // ── Filtered audit rows ──
  const filteredAudit = auditSearch
    ? auditRows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(auditSearch.toLowerCase())))
    : auditRows
  const auditPages = Math.max(1, Math.ceil(auditTotal / 20))

  // ── Determine available tabs ──
  const tabs: { id: Tab; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'security', label: 'Security' },
    ...(isAdmin ? [{ id: 'compliance' as Tab, label: 'Compliance' }] : []),
    ...(isStaff ? [{ id: 'audit' as Tab, label: 'Audit Trail' }] : []),
  ]

  if (profileLoading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Loading account...</div>
  }

  if (!profile) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>Could not load profile.</div>
  }

  /* ═══════════════ RENDER ═══════════════ */
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div>
          <h1 style={{ margin: '0 0 0.15rem', fontSize: '1.5rem' }}>Account &amp; Administration</h1>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
            Manage your profile, security settings{isAdmin ? ', compliance reports,' : ''}{isStaff ? ' and audit trail' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: 32 }}>
            {profile.role === 'doctor' ? '👨‍⚕️' : profile.role === 'admin' ? '👨‍💼' : '🧑‍🤝‍🧑'}
          </span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{profile.firstName} {profile.lastName}</div>
            <span style={badge(profile.role === 'admin' ? '#8b5cf6' : profile.role === 'doctor' ? '#3b82f6' : '#10b981')}>
              {profile.role.toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={tabBtn(activeTab === t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Alerts ── */}
      {errorMsg && (
        <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#ef4444', fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {errorMsg}
          <button onClick={() => setErrorMsg(null)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 700, fontSize: 16 }}>×</button>
        </div>
      )}
      {successMsg && (
        <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, color: '#10b981', fontSize: 14 }}>
          {successMsg}
        </div>
      )}

      {/* ═══════════ PROFILE TAB ═══════════ */}
      {activeTab === 'profile' && (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '1.25rem' }}>
          {/* Sidebar card */}
          <div style={{ ...card, textAlign: 'center' }}>
            <div style={{ fontSize: '3.5rem', marginBottom: '0.5rem' }}>
              {profile.role === 'doctor' ? '👨‍⚕️' : profile.role === 'admin' ? '👨‍💼' : '🧑‍🤝‍🧑'}
            </div>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 2 }}>{profile.firstName} {profile.lastName}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: '1rem' }}>{profile.email}</div>

            <div style={{ textAlign: 'left', fontSize: 13, display: 'grid', gap: '0.4rem' }}>
              {profile.phone && <div>Phone: {profile.phone}</div>}
              {profile.department && <div>Dept: {profile.department}</div>}
              {profile.licenseNumber && <div>License: {profile.licenseNumber}</div>}
            </div>

            {/* Activity summary */}
            <div style={{ borderTop: '1px solid var(--border)', marginTop: '1rem', paddingTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: 12 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>{profile.stats.filesUploaded}</div>
                <div style={{ color: 'var(--muted)' }}>Uploads</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>{profile.stats.filesDownloaded}</div>
                <div style={{ color: 'var(--muted)' }}>Downloads</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>{profile.stats.consentsGranted}</div>
                <div style={{ color: 'var(--muted)' }}>Consents</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                  {profile.stats.lastLogin ? new Date(profile.stats.lastLogin).toLocaleDateString() : '—'}
                </div>
                <div style={{ color: 'var(--muted)' }}>Last login</div>
              </div>
            </div>
          </div>

          {/* Edit form */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Personal Information</h2>
              <button
                onClick={() => isEditing ? handleSave() : setIsEditing(true)}
                style={{ padding: '0.4rem 1rem', background: isEditing ? '#10b981' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
              >
                {isEditing ? 'Save Changes' : 'Edit Profile'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={fieldLabel}>First Name</label>
                {isEditing
                  ? <input value={editForm.firstName || ''} onChange={e => setEditForm(p => ({ ...p, firstName: e.target.value }))} style={inputStyle} />
                  : <div style={{ fontSize: 14, padding: '0.5rem 0' }}>{profile.firstName || '—'}</div>}
              </div>
              <div>
                <label style={fieldLabel}>Last Name</label>
                {isEditing
                  ? <input value={editForm.lastName || ''} onChange={e => setEditForm(p => ({ ...p, lastName: e.target.value }))} style={inputStyle} />
                  : <div style={{ fontSize: 14, padding: '0.5rem 0' }}>{profile.lastName || '—'}</div>}
              </div>
              <div>
                <label style={fieldLabel}>Phone</label>
                {isEditing
                  ? <input value={editForm.phone || ''} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))} style={inputStyle} />
                  : <div style={{ fontSize: 14, padding: '0.5rem 0' }}>{profile.phone || '—'}</div>}
              </div>
              <div>
                <label style={fieldLabel}>Department</label>
                {isEditing
                  ? <input value={editForm.department || ''} onChange={e => setEditForm(p => ({ ...p, department: e.target.value }))} style={inputStyle} />
                  : <div style={{ fontSize: 14, padding: '0.5rem 0' }}>{profile.department || '—'}</div>}
              </div>
              <div>
                <label style={fieldLabel}>License Number</label>
                {isEditing
                  ? <input value={editForm.licenseNumber || ''} onChange={e => setEditForm(p => ({ ...p, licenseNumber: e.target.value }))} style={inputStyle} />
                  : <div style={{ fontSize: 14, padding: '0.5rem 0' }}>{profile.licenseNumber || '—'}</div>}
              </div>
              <div>
                <label style={fieldLabel}>Date of Birth</label>
                {isEditing
                  ? <input type="date" value={editForm.dateOfBirth || ''} onChange={e => setEditForm(p => ({ ...p, dateOfBirth: e.target.value }))} style={inputStyle} />
                  : <div style={{ fontSize: 14, padding: '0.5rem 0' }}>{profile.dateOfBirth || '—'}</div>}
              </div>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <label style={fieldLabel}>Bio</label>
              {isEditing
                ? <textarea value={editForm.bio || ''} onChange={e => setEditForm(p => ({ ...p, bio: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
                : <div style={{ fontSize: 14, padding: '0.5rem 0' }}>{profile.bio || '—'}</div>}
            </div>

            {/* Emergency Contact */}
            <h3 style={{ fontSize: '1rem', marginTop: '1.5rem', marginBottom: '0.75rem' }}>Emergency Contact</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={fieldLabel}>Name</label>
                {isEditing
                  ? <input value={editForm.emergencyContact?.name || ''} onChange={e => setEditForm(p => ({ ...p, emergencyContact: { ...p.emergencyContact!, name: e.target.value } }))} style={inputStyle} />
                  : <div style={{ fontSize: 14, padding: '0.5rem 0' }}>{profile.emergencyContact.name || '—'}</div>}
              </div>
              <div>
                <label style={fieldLabel}>Phone</label>
                {isEditing
                  ? <input value={editForm.emergencyContact?.phone || ''} onChange={e => setEditForm(p => ({ ...p, emergencyContact: { ...p.emergencyContact!, phone: e.target.value } }))} style={inputStyle} />
                  : <div style={{ fontSize: 14, padding: '0.5rem 0' }}>{profile.emergencyContact.phone || '—'}</div>}
              </div>
              <div>
                <label style={fieldLabel}>Relationship</label>
                {isEditing
                  ? <input value={editForm.emergencyContact?.relationship || ''} onChange={e => setEditForm(p => ({ ...p, emergencyContact: { ...p.emergencyContact!, relationship: e.target.value } }))} style={inputStyle} />
                  : <div style={{ fontSize: 14, padding: '0.5rem 0' }}>{profile.emergencyContact.relationship || '—'}</div>}
              </div>
            </div>

            {isEditing && (
              <div style={{ marginTop: '1rem', textAlign: 'right' }}>
                <button onClick={() => { setIsEditing(false); setEditForm(profile) }} style={{ padding: '0.4rem 1rem', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 13, marginRight: '0.5rem' }}>
                  Cancel
                </button>
                <button onClick={handleSave} style={{ padding: '0.4rem 1rem', background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                  Save Changes
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ SECURITY TAB ═══════════ */}
      {activeTab === 'security' && (
        <div style={{ maxWidth: 700, display: 'grid', gap: '1rem' }}>
          {/* Password */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>Password</h3>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Last changed: {profile.security.lastPasswordChange ? new Date(profile.security.lastPasswordChange).toLocaleDateString() : 'Never'}
                </div>
              </div>
              <button onClick={handleChangePassword} style={{ padding: '0.4rem 1rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 500, fontSize: 13 }}>
                Change Password
              </button>
            </div>
          </div>

          {/* 2FA */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>Two-Factor Authentication</h3>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Status: <span style={{ color: profile.security.twoFactorEnabled ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                    {profile.security.twoFactorEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>
              <button onClick={handleToggle2FA} style={{ padding: '0.4rem 1rem', background: profile.security.twoFactorEnabled ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)', color: profile.security.twoFactorEnabled ? '#ef4444' : '#10b981', border: `1px solid ${profile.security.twoFactorEnabled ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`, borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                {profile.security.twoFactorEnabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          </div>

          {/* Theme preference */}
          <div style={card}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Appearance</h3>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {([
                { val: 'light' as const, icon: '☀️', label: 'Light' },
                { val: 'dark' as const, icon: '🌙', label: 'Dark' },
                { val: 'auto' as const, icon: '💻', label: 'System' },
              ]).map(t => (
                <button
                  key={t.val}
                  onClick={() => {
                    setEditForm(p => ({ ...p, preferences: { ...p.preferences!, theme: t.val } }))
                    const eff = t.val === 'auto'
                      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
                      : t.val
                    if (eff === 'light') document.documentElement.setAttribute('data-theme', 'light')
                    else document.documentElement.removeAttribute('data-theme')
                    localStorage.setItem('theme', t.val)
                  }}
                  style={{
                    flex: 1, padding: '0.75rem', textAlign: 'center', borderRadius: 6, cursor: 'pointer',
                    background: (editForm.preferences?.theme || profile.preferences.theme) === t.val ? 'var(--accent)' : 'var(--bg)',
                    color: (editForm.preferences?.theme || profile.preferences.theme) === t.val ? '#fff' : 'var(--text)',
                    border: '1px solid var(--border)',
                    fontWeight: 500,
                  }}
                >
                  <div style={{ fontSize: 20 }}>{t.icon}</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>{t.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Notification prefs */}
          <div style={card}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Notifications</h3>
            {([
              { key: 'email' as const, label: 'Email notifications' },
              { key: 'sms' as const, label: 'SMS alerts' },
              { key: 'push' as const, label: 'Browser push' },
            ]).map(n => (
              <label key={n.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', cursor: 'pointer' }}>
                <span style={{ fontSize: 14 }}>{n.label}</span>
                <input
                  type="checkbox"
                  checked={profile.preferences.notifications[n.key]}
                  onChange={e => {
                    const v = e.target.checked
                    setProfile(p => p ? { ...p, preferences: { ...p.preferences, notifications: { ...p.preferences.notifications, [n.key]: v } } } : null)
                  }}
                  style={{ width: 18, height: 18, cursor: 'pointer' }}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════ COMPLIANCE TAB (admin only) ═══════════ */}
      {activeTab === 'compliance' && isAdmin && (
        <div>
          {/* Period selector */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Compliance &amp; Access Control</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>Period:</span>
              <select value={compDays} onChange={e => setCompDays(Number(e.target.value))} style={{ ...inputStyle, width: 'auto' }}>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
              </select>
            </div>
          </div>

          {compLoading ? (
            <div style={{ ...card, textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>Loading compliance data...</div>
          ) : compliance ? (
            <>
              {/* Score + stat cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                <div style={{ ...card, textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: 48, fontWeight: 700, color: compliance.compliance_score >= 90 ? '#10b981' : compliance.compliance_score >= 70 ? '#f59e0b' : '#ef4444' }}>
                    {compliance.compliance_score}%
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>Compliance Score</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    {compliance.total_audit_events} events
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                  {[
                    { label: 'Total Files', value: compliance.total_files, color: 'var(--text)' },
                    { label: 'Total Users', value: compliance.total_users, color: 'var(--text)' },
                    { label: 'Active Consents', value: compliance.active_consents, color: '#10b981' },
                    { label: 'Expired Consents', value: compliance.expired_consents, color: '#f59e0b' },
                    { label: 'Revoked Consents', value: compliance.revoked_consents, color: '#ef4444' },
                    { label: 'Failed Attempts', value: compliance.failed_access_attempts, color: '#ef4444' },
                  ].map(s => (
                    <div key={s.label} style={{ ...card, textAlign: 'center', padding: '0.75rem' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Access by role */}
              {accessSummary && (
                <>
                  <div style={{ ...card, marginBottom: '1rem' }}>
                    <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Access by Role</h3>
                    <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                      {Object.entries(accessSummary.by_role).map(([role, count]) => (
                        <div key={role} style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 24, fontWeight: 700 }}>{count}</div>
                          <div style={{ fontSize: 13, color: 'var(--muted)', textTransform: 'capitalize' }}>{role}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* User activity table */}
                  <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
                      <h3 style={{ margin: 0, fontSize: '1rem' }}>User Activity</h3>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                        <thead>
                          <tr style={{ background: 'var(--bg)' }}>
                            {['User', 'Role', 'Uploads', 'Downloads', 'Deletes', 'Consents', 'Last Active'].map(h => (
                              <th key={h} style={{ padding: '0.6rem 0.75rem', textAlign: h === 'User' || h === 'Role' || h === 'Last Active' ? 'left' : 'center', fontWeight: 600, borderBottom: '2px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {accessSummary.by_user.length === 0 ? (
                            <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>No activity in this period</td></tr>
                          ) : accessSummary.by_user.map((u, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '0.6rem 0.75rem' }}>{u.user_email || `User #${u.user_id}`}</td>
                              <td style={{ padding: '0.6rem 0.75rem', textTransform: 'capitalize' }}>{u.role}</td>
                              <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>{u.files_uploaded}</td>
                              <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>{u.files_downloaded}</td>
                              <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>{u.files_deleted}</td>
                              <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>{u.consents_granted}</td>
                              <td style={{ padding: '0.6rem 0.75rem', fontSize: 13 }}>{u.last_activity ? new Date(u.last_activity).toLocaleString() : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* ═══════════ AUDIT TRAIL TAB (doctor/admin) ═══════════ */}
      {activeTab === 'audit' && isStaff && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Audit Trail</h2>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>{auditTotal} total events</span>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search logs..."
              value={auditSearch}
              onChange={e => setAuditSearch(e.target.value)}
              style={{ ...inputStyle, flex: 1, minWidth: 180 }}
            />
            <select value={auditFilters.event_type} onChange={e => { setAuditFilters(p => ({ ...p, event_type: e.target.value })); setAuditPage(1) }} style={{ ...inputStyle, width: 'auto' }}>
              <option value="">All Events</option>
              <option value="file.upload">Upload</option>
              <option value="file.download">Download</option>
              <option value="file.delete">Delete</option>
              <option value="auth.login">Login</option>
              <option value="consent.granted">Consent Grant</option>
              <option value="consent.revoked">Consent Revoke</option>
            </select>
            <select value={auditFilters.status} onChange={e => { setAuditFilters(p => ({ ...p, status: e.target.value })); setAuditPage(1) }} style={{ ...inputStyle, width: 'auto' }}>
              <option value="">All Status</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="warning">Warning</option>
            </select>
            <select value={auditFilters.severity} onChange={e => { setAuditFilters(p => ({ ...p, severity: e.target.value })); setAuditPage(1) }} style={{ ...inputStyle, width: 'auto' }}>
              <option value="">All Severity</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            {(auditFilters.event_type || auditFilters.status || auditFilters.severity || auditSearch) && (
              <button onClick={() => { setAuditFilters({ event_type: '', status: '', severity: '' }); setAuditSearch(''); setAuditPage(1) }} style={{ padding: '0.4rem 0.75rem', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
                Clear
              </button>
            )}
          </div>

          {/* Table + detail panel */}
          <div style={{ display: 'grid', gridTemplateColumns: selectedEvent ? '1fr 340px' : '1fr', gap: '1rem' }}>
            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              {auditLoading ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>Loading audit logs...</div>
              ) : filteredAudit.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>No audit events found.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
                        {['Time', 'Event', 'User', 'Action', 'Status', 'Severity'].map(h => (
                          <th key={h} style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAudit.map((ev, i) => (
                        <tr
                          key={ev.id}
                          onClick={() => setSelectedEvent(ev)}
                          style={{
                            borderBottom: i < filteredAudit.length - 1 ? '1px solid var(--border)' : 'none',
                            cursor: 'pointer',
                            background: selectedEvent?.id === ev.id ? 'rgba(59,130,246,0.06)' : 'transparent',
                          }}
                        >
                          <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap', fontSize: 12 }}>
                            {new Date(ev.timestamp).toLocaleString()}
                          </td>
                          <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap' }}>{ev.eventType}</td>
                          <td style={{ padding: '0.6rem 0.75rem' }}>
                            <div>{ev.userId}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{ev.userRole}</div>
                          </td>
                          <td style={{ padding: '0.6rem 0.75rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ev.action}
                          </td>
                          <td style={{ padding: '0.6rem 0.75rem' }}>
                            <span style={{ ...badge(statColor[ev.status] || '#6b7280'), fontSize: 11 }}>
                              {ev.status}
                            </span>
                          </td>
                          <td style={{ padding: '0.6rem 0.75rem' }}>
                            <span style={{ ...badge(sevColor[ev.severity] || '#6b7280'), fontSize: 11 }}>
                              {ev.severity}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {auditPages > 1 && (
                <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', background: 'var(--bg)', fontSize: 13 }}>
                  <button disabled={auditPage === 1} onClick={() => setAuditPage(p => p - 1)} style={{ padding: '0.3rem 0.75rem', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', cursor: auditPage === 1 ? 'not-allowed' : 'pointer', opacity: auditPage === 1 ? 0.5 : 1 }}>Prev</button>
                  <span>Page {auditPage} / {auditPages}</span>
                  <button disabled={auditPage >= auditPages} onClick={() => setAuditPage(p => p + 1)} style={{ padding: '0.3rem 0.75rem', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', cursor: auditPage >= auditPages ? 'not-allowed' : 'pointer', opacity: auditPage >= auditPages ? 0.5 : 1 }}>Next</button>
                </div>
              )}
            </div>

            {/* Event detail side panel */}
            {selectedEvent && (
              <div style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Event Detail</h3>
                  <button onClick={() => setSelectedEvent(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 16 }}>×</button>
                </div>
                <div style={{ display: 'grid', gap: '0.5rem', fontSize: 13 }}>
                  <div><span style={{ color: 'var(--muted)' }}>ID:</span> {selectedEvent.id}</div>
                  <div><span style={{ color: 'var(--muted)' }}>Time:</span> {new Date(selectedEvent.timestamp).toLocaleString()}</div>
                  <div><span style={{ color: 'var(--muted)' }}>Type:</span> {selectedEvent.eventType}</div>
                  <div><span style={{ color: 'var(--muted)' }}>User:</span> {selectedEvent.userId} ({selectedEvent.userRole})</div>
                  <div><span style={{ color: 'var(--muted)' }}>Action:</span> {selectedEvent.action}</div>
                  <div><span style={{ color: 'var(--muted)' }}>Resource:</span> {selectedEvent.resource} {selectedEvent.resourceId && `(${selectedEvent.resourceId})`}</div>
                  <div><span style={{ color: 'var(--muted)' }}>IP:</span> {selectedEvent.ipAddress || '—'}</div>
                  <div>
                    <span style={{ color: 'var(--muted)' }}>Status:</span>{' '}
                    <span style={{ ...badge(statColor[selectedEvent.status] || '#6b7280') }}>{selectedEvent.status}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--muted)' }}>Severity:</span>{' '}
                    <span style={{ ...badge(sevColor[selectedEvent.severity] || '#6b7280') }}>{selectedEvent.severity}</span>
                  </div>
                  {Object.keys(selectedEvent.details).length > 0 && (
                    <div>
                      <div style={{ color: 'var(--muted)', marginBottom: 4 }}>Details:</div>
                      <pre style={{ background: 'var(--bg)', padding: '0.5rem', borderRadius: 4, fontSize: 12, overflow: 'auto', maxHeight: 160, margin: 0 }}>
                        {JSON.stringify(selectedEvent.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
