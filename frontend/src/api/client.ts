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
  patient_id?: number | null
  upload_timestamp: string
  checksum: string | null
  description: string | null
  dicom_study_id?: string | null
  dicom_series_id?: string | null
  dicom_modality?: string | null
  dicom_study_date?: string | null
  dicom_body_part?: string | null
  dicom_instance_count?: number
  grouped_file_ids?: number[]
  is_study_group?: boolean
}

export interface ListFilesParams {
  page?: number
  page_size?: number
  search?: string
  content_type?: string
  size_min?: number
  size_max?: number
  date_from?: string
  date_to?: string
  dicom_modality?: string
  dicom_study_id?: string
  dicom_series_id?: string
  dicom_body_part?: string
  group_by_study?: boolean
}

export interface ListFilesResponse {
  files: FileInfo[]
  total: number
  page: number
  page_size: number
}

export async function listFiles(patientId?: number, params?: ListFilesParams): Promise<ListFilesResponse> {
  const queryParams = new URLSearchParams()
  if (patientId) queryParams.set('patient_id', String(patientId))
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        queryParams.set(key, String(value))
      }
    })
  }
  const query = queryParams.toString()
  const data = await api<{ status: string; files?: FileInfo[]; total?: number; page?: number; page_size?: number }>(`/files${query ? `?${query}` : ''}`)
  const files = data.files ?? []
  return {
    files,
    total: data.total ?? files.length,
    page: data.page ?? 1,
    page_size: data.page_size ?? files.length,
  }
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
  file_ids?: number[]
  scope?: string
  granted_to_role?: string
  granted_to_user_id?: number
  granted_to_hospital_id?: string
  granted_to_hospital_name?: string
  expires_at?: string
  expires_days?: number
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
  requester_name?: string | null
  requester_email: string
  requester_role: string
  patient_id?: number | null
  patient_name?: string | null
  file_id: number | null
  file_ids?: number[] | null
  scope: string | null
  reason: string
  urgency?: string
  status: 'pending' | 'approved' | 'denied' | 'expired'
  requested_at: string
  resolved_at: string | null
  resolved_by: number | null
  resolved_by_name?: string | null
  is_emergency?: boolean
  is_proxy?: boolean
  requester_hospital_id?: string | null
  target_hospital_id?: string | null
}

export interface AccessRequestList {
  requests: AccessRequest[]
  total: number
  page: number
  page_size: number
}

export interface ConsentRequestBody {
  patient_id: number
  file_ids?: number[]
  scope?: string
  reason: string
  urgency?: 'normal' | 'urgent' | 'emergency'
  target_hospital_id?: string
  target_hospital_name?: string
}

export interface EmergencyOverrideBody {
  patient_id: number
  file_ids: number[]
  reason: string
  clinical_justification: string
}

export interface ProxyApprovalBody {
  request_id: number
  proxy_reason: string
  verification_method: 'verbal' | 'written' | 'witness'
}

export async function listAccessRequests(status?: string, page = 1): Promise<AccessRequestList> {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  params.set('page', page.toString())
  return api(`/access-requests?${params.toString()}`)
}

export async function listPendingForMe(page = 1): Promise<AccessRequestList> {
  return api(`/access-requests/pending-for-me?page=${page}`)
}

export async function sendConsentRequest(body: ConsentRequestBody): Promise<AccessRequest> {
  return api('/access-requests/consent-request', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function emergencyOverride(body: EmergencyOverrideBody): Promise<AccessRequest> {
  return api('/access-requests/emergency-override', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function proxyApproval(body: ProxyApprovalBody): Promise<AccessRequest> {
  return api('/access-requests/proxy-approval', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function createAccessRequest(body: ConsentRequestBody): Promise<AccessRequest> {
  return api('/access-requests', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function approveAccessRequest(requestId: number, expiresDays = 30): Promise<AccessRequest> {
  return api<AccessRequest>(`/access-requests/${requestId}/approve?expires_days=${expiresDays}`, { method: 'PUT' })
}

export async function denyAccessRequest(requestId: number): Promise<AccessRequest> {
  return api<AccessRequest>(`/access-requests/${requestId}/deny`, { method: 'PUT' })
}

// ============ PATIENT CONSENT PORTAL ============

export interface PatientFile {
  id: number
  filename: string
  original_filename: string
  file_size: number
  content_type: string | null
  upload_timestamp: string
  description: string | null
  has_active_consent: boolean
  consent_count: number
}

export async function getMyFiles(): Promise<PatientFile[]> {
  return api<PatientFile[]>('/consent/my-files')
}

export interface ConsentNotification {
  id: number
  title: string
  message: string
  type: string
  read: boolean
  link: string | null
  created_at: string
}

export async function getMyNotifications(unreadOnly = false): Promise<ConsentNotification[]> {
  return api<ConsentNotification[]>(`/consent/my-notifications?unread_only=${unreadOnly}`)
}

export async function markNotificationRead(notificationId: number): Promise<void> {
  await api(`/consent/notifications/${notificationId}/read`, { method: 'PUT' })
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

export async function request2FAChallenge(): Promise<{ status: string; message: string; expires_in: number; otp_hint?: string }> {
  return api('/profile/2fa/challenge', {
    method: 'POST',
  })
}

export async function verify2FA(code: string, enable: boolean): Promise<{ two_factor_enabled: boolean; message: string }> {
  return api('/profile/2fa/verify', {
    method: 'POST',
    body: JSON.stringify({ code, enable }),
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

// ============ FEDERATION API ============

export interface FederationPeer {
  id: string
  name: string
  endpoint: string
  status: string
  certificate_fingerprint?: string
  last_seen?: string
}

export interface FederationNetworkStatus {
  hospital_id: string
  peers: FederationPeer[]
  total_peers: number
}

export async function getFederationNetworkStatus(): Promise<FederationNetworkStatus> {
  return api<FederationNetworkStatus>('/federation/network/status')
}

// ============ FEDERATION TRANSFER API ============

export interface TransferPeer {
  hospital_id: string
  hospital_name: string
  api_endpoint: string
  grpc_endpoint: string
  source: string
}

export interface TransferStatus {
  id: number
  transfer_id: string
  direction: 'sent' | 'received'
  source_hospital_id: string
  source_hospital_name: string | null
  dest_hospital_id: string
  dest_hospital_name: string | null
  original_filename: string
  file_size: number | null
  patient_name: string | null
  patient_mrn: string | null
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  initiated_at: string | null
  completed_at: string | null
  error_message: string | null
}

export async function getTransferPeers(): Promise<{ peers: TransferPeer[]; total: number }> {
  return api('/federation/transfer/peers')
}

export async function shareFileToHospital(
  fileId: number,
  targetHospitalId: string,
  targetEndpoint: string,
  reason: string = 'Clinical consultation'
): Promise<{ success: boolean; transfer_id: string; status: string; message: string }> {
  return api('/federation/transfer/share', {
    method: 'POST',
    body: JSON.stringify({
      file_id: fileId,
      target_hospital_id: targetHospitalId,
      target_hospital_endpoint: targetEndpoint,
      reason,
    }),
  })
}

export async function getTransferHistory(
  direction?: 'sent' | 'received',
  limit: number = 50
): Promise<TransferStatus[]> {
  const params = new URLSearchParams()
  if (direction) params.set('direction', direction)
  params.set('limit', limit.toString())
  return api(`/federation/transfer/history?${params}`)
}

export async function getTransferStatus(transferId: string): Promise<TransferStatus> {
  return api(`/federation/transfer/status/${transferId}`)
}
