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

export async function listFiles(): Promise<{ files: FileInfo[] }> {
  const data = await api<{ status: string; files?: FileInfo[] }>('/files')
  return { files: data.files ?? [] }
}

export async function getFileInfo(fileId: number) {
  return api<{ file: FileInfo & { replication_status?: unknown[] } }>(`/files/${fileId}`)
}

export async function uploadFile(file: File, description?: string) {
  const form = new FormData()
  form.append('file', file)
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
  phone?: string
  department?: string
  bio?: string
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