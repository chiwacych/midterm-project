const TOKEN_KEY = 'medimage_token'

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || String(err))
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export async function apiUpload(path: string, formData: FormData): Promise<unknown> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || String(err))
  }
  return res.json()
}

export interface FileInfo {
  id: number
  filename: string
  size: number
  content_type: string | null
  user_id: string
  upload_timestamp: string
  checksum: string | null
  description: string | null
}

export async function listFiles(patientId?: number): Promise<{ files: FileInfo[] }> {
  const query = patientId ? `?patient_id=${patientId}` : ''
  const data = await api<{ status: string; files?: FileInfo[] }>(`/files${query}`)
  return { files: data.files ?? [] }
}

export async function getFileInfo(fileId: number) {
  return api<{ file: FileInfo & { replication_status?: unknown[] } }>(`/files/${fileId}`)
}

export async function uploadFile(file: File, patientId: number, description?: string) {
  const form = new FormData()
  form.append('file', file)
  form.append('patient_id', patientId.toString())
  if (description) form.append('description', description)
  return apiUpload('/upload', form)
}

export async function deleteFile(fileId: number) {
  return api(`/files/${fileId}`, { method: 'DELETE' })
}

export interface ConsentItem {
  id: number
  user_id: number
  subject_id: number | null
  scope: string | null
  granted_to_role: string | null
  granted_to_user_id: number | null
  granted_to_hospital_id: string | null
  granted_to_hospital_name: string | null
  granted_at: string
  expires_at: string | null
  revoked_at: string | null
  status?: string
}

export async function listConsents(): Promise<ConsentItem[]> {
  const data = await api<ConsentItem[] | unknown>('/consent')
  return Array.isArray(data) ? (data as ConsentItem[]) : []
}

export interface GrantConsentBody {
  subject_id?: number
  scope?: string
  granted_to_role?: string
  granted_to_user_id?: number
  granted_to_hospital_id?: string
  granted_to_hospital_name?: string
  expires_at?: string
}

export async function grantConsent(body: GrantConsentBody): Promise<ConsentItem> {
  return api<ConsentItem>('/consent', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function revokeConsent(consentId: number): Promise<void> {
  await api(`/consent/${consentId}/revoke`, { method: 'POST' })
}

/** Trigger download with Bearer token (browser won't send token on <a href>) */
export async function downloadFile(fileId: number, filename: string): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`/api/files/${fileId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error('Download failed')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export interface AccessRequest {
  id: number
  requester_id: number
  requester_email: string
  requester_role: string
  file_id: number | null
  scope: string | null
  reason: string
  status: 'pending' | 'approved' | 'denied' | 'expired'
  requested_at: string
  resolved_at: string | null
  resolved_by: number | null
}

export interface AccessRequestList {
  requests: AccessRequest[]
  total: number
  page: number
  page_size: number
}

export interface CreateAccessRequestBody {
  file_id?: number
  scope?: string
  reason: string
}

export async function listAccessRequests(status?: string, page = 1): Promise<AccessRequestList> {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  params.set('page', page.toString())
  return api(`/access-requests?${params.toString()}`)
}

export async function createAccessRequest(fileId: number | null, scope: string, reason: string): Promise<AccessRequest> {
  return api('/access-requests', {
    method: 'POST',
    body: JSON.stringify({ file_id: fileId, scope, reason })
  })
}

export async function approveAccessRequest(requestId: number, expiresDays = 30): Promise<AccessRequest> {
  return api<AccessRequest>(`/access-requests/${requestId}/approve?expires_days=${expiresDays}`, { method: 'PUT' })
}

export async function denyAccessRequest(requestId: number): Promise<AccessRequest> {
  return api<AccessRequest>(`/access-requests/${requestId}/deny`, { method: 'PUT' })
}

export interface AuditEvent {
  id: number
  timestamp: string
  event_type: string
  user_id: number | null
  user_role: string | null
  action: string
  resource: string | null
  resource_id: string | null
  ip_address: string | null
  user_agent: string | null
  status: 'success' | 'failure' | 'warning'
  severity: 'low' | 'medium' | 'high' | 'critical'
  details: Record<string, unknown> | null
}

export interface AuditFilters {
  event_type?: string
  user_id?: number
  status?: string
  severity?: string
  date_from?: string
  date_to?: string
  page?: number
  page_size?: number
}

export async function listAuditEvents(filters?: AuditFilters): Promise<{ events: AuditEvent[]; total: number; page: number; page_size: number }> {
  const queryParams = new URLSearchParams()
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        queryParams.set(key, value.toString())
      }
    })
  }
  const query = queryParams.toString()
  return api(`/audit${query ? `?${query}` : ''}`)
}

export interface MinioNodeHealth {
  id: string
  name: string
  endpoint: string
  healthy: boolean
  message: string
  status: 'healthy' | 'degraded' | 'offline'
  last_seen: string
  region: string
  total_files: number
  total_size: number
}

export async function getNodesHealth(): Promise<{ nodes: Record<string, MinioNodeHealth> }> {
  return api('/health/nodes')
}

export interface EmergencyContact {
  name: string
  phone: string
  relationship: string
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'auto'
  notifications: {
    email: boolean
    sms: boolean
    push: boolean
  }
  language: string
  timezone: string
}

export interface UserProfile {
  id: string
  email: string
  firstName: string
  lastName: string
  role: 'patient' | 'doctor' | 'admin'
  full_name: string | null
  phone: string | null
  department: string | null
  license_number: string | null
  date_of_birth: string | null
  bio: string | null
  emergency_contact: EmergencyContact
  preferences: UserPreferences
  two_factor_enabled: boolean
  last_password_change: string | null
  stats: {
    files_uploaded: number
    files_downloaded: number
    consents_granted: number
    last_login: string | null
  }
}

export interface UpdateProfileBody {
  firstName?: string
  lastName?: string
  full_name?: string
  phone?: string
  department?: string
  license_number?: string
  date_of_birth?: string
  bio?: string
  emergency_contact_name?: string
  emergency_contact_phone?: string
  emergency_contact_relationship?: string
  emergency_contact?: EmergencyContact
  preferences?: Partial<UserPreferences>
}

export async function getProfile(): Promise<UserProfile> {
  return api('/profile')
}

export async function updateProfile(body: UpdateProfileBody): Promise<UserProfile> {
  return api('/profile', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return api('/profile/password', {
    method: 'PUT',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
}

export async function toggle2FA(): Promise<{ two_factor_enabled: boolean }> {
  return api('/profile/2fa', {
    method: 'PUT',
  })
}

// ============ COMPLIANCE API ============

export interface ComplianceSummary {
  report_generated_at: string
  period_start: string
  period_end: string
  total_files: number
  total_users: number
  total_consents: number
  active_consents: number
  expired_consents: number
  revoked_consents: number
  total_audit_events: number
  failed_access_attempts: number
  high_severity_events: number
  compliance_score: number
}

export async function getComplianceReport(days = 30): Promise<ComplianceSummary> {
  return api(`/compliance/report?days=${days}`)
}

export interface AccessSummaryItem {
  user_id: number | null
  user_email: string | null
  role: string
  files_accessed: number
  files_uploaded: number
  files_downloaded: number
  files_deleted: number
  consents_granted: number
  last_activity: string | null
}

export interface AccessSummaryReport {
  report_generated_at: string
  period_start: string
  period_end: string
  total_accesses: number
  by_user: AccessSummaryItem[]
  by_role: Record<string, number>
}

export async function getAccessSummary(days = 30): Promise<AccessSummaryReport> {
  return api<AccessSummaryReport>(`/compliance/access-summary?days=${days}`)
}

// ============ PATIENTS API ============

export interface Patient {
  id: number
  full_name: string
  email: string | null
  phone: string | null
  date_of_birth: string | null
  medical_record_number: string | null
  created_at: string
  updated_at: string
  is_active: boolean
  file_count: number
}

export interface PatientCreate {
  full_name: string
  email?: string
  phone?: string
  date_of_birth?: string
  medical_record_number?: string
  address?: string
  emergency_contact_name?: string
  emergency_contact_phone?: string
  notes?: string
}

export interface PatientSearch {
  full_name: string
  email?: string
  phone?: string
}

export async function listPatients(search?: string, page = 1): Promise<Patient[]> {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  params.set('page', page.toString())
  return api(`/patients?${params.toString()}`)
}

export async function createPatient(body: PatientCreate): Promise<Patient> {
  return api('/patients', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function searchPatients(body: PatientSearch): Promise<Patient[]> {
  return api('/patients/search', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function getPatient(patientId: number): Promise<Patient> {
  return api(`/patients/${patientId}`)
}

export async function getPatientFiles(patientId: number): Promise<{ patient_id: number; patient_name: string; files: FileInfo[] }> {
  return api(`/patients/${patientId}/files`)
}
