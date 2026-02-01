import { useState, useEffect } from 'react'
import { getProfile, updateProfile, changePassword, toggle2FA, UserProfile as ApiUserProfile } from '../api/client'

interface UserProfile {
  id: string
  email: string
  firstName: string
  lastName: string
  role: 'patient' | 'doctor' | 'admin'
  avatar: string
  bio: string
  phone: string
  department: string
  licenseNumber: string
  dateOfBirth: string
  emergencyContact: {
    name: string
    phone: string
    relationship: string
  }
  preferences: {
    theme: 'light' | 'dark' | 'auto'
    notifications: {
      email: boolean
      sms: boolean
      push: boolean
    }
    language: string
    timezone: string
  }
  security: {
    twoFactorEnabled: boolean
    lastPasswordChange: string
    loginAttempts: number
    accountLocked: boolean
  }
  stats: {
    filesUploaded: number
    filesDownloaded: number
    consentsGranted: number
    lastLogin: string
  }
}

// Transform API profile to local format
const transformProfile = (p: ApiUserProfile): UserProfile => {
  const nameParts = (p.full_name || '').split(' ')
  return {
    id: String(p.id),
    email: p.email,
    firstName: nameParts[0] || '',
    lastName: nameParts.slice(1).join(' ') || '',
    role: p.role,
    avatar: p.role === 'doctor' ? '👨‍⚕️' : p.role === 'admin' ? '👨‍💼' : '🧑‍🤝‍🧑',
    bio: p.bio || '',
    phone: p.phone || '',
    department: p.department || '',
    licenseNumber: p.license_number || '',
    dateOfBirth: p.date_of_birth || '',
    emergencyContact: {
      name: p.emergency_contact.name || '',
      phone: p.emergency_contact.phone || '',
      relationship: p.emergency_contact.relationship || ''
    },
    preferences: {
      theme: p.preferences.theme,
      notifications: p.preferences.notifications,
      language: p.preferences.language,
      timezone: p.preferences.timezone
    },
    security: {
      twoFactorEnabled: p.two_factor_enabled,
      lastPasswordChange: p.last_password_change || '',
      loginAttempts: 0,
      accountLocked: false
    },
    stats: {
      filesUploaded: p.stats.files_uploaded,
      filesDownloaded: p.stats.files_downloaded,
      consentsGranted: p.stats.consents_granted,
      lastLogin: p.stats.last_login || ''
    }
  }
}

export function UserProfileManagement() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'preferences' | 'activity'>('profile')
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState<Partial<UserProfile>>({})
  const [, setLoading] = useState(true)
  const [, setSaving] = useState(false)

  useEffect(() => {
    // Fetch user profile from API
    const fetchProfile = async () => {
      setLoading(true)
      try {
        const apiProfile = await getProfile()
        const transformed = transformProfile(apiProfile)
        setProfile(transformed)
        setEditForm(transformed)
      } catch (error) {
        console.error('Failed to fetch profile:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchProfile()
  }, [])

  const handleSave = async () => {
    if (profile && editForm) {
      setSaving(true)
      try {
        await updateProfile({
          full_name: `${editForm.firstName || ''} ${editForm.lastName || ''}`.trim(),
          phone: editForm.phone,
          department: editForm.department,
          license_number: editForm.licenseNumber,
          date_of_birth: editForm.dateOfBirth,
          bio: editForm.bio,
          emergency_contact_name: editForm.emergencyContact?.name,
          emergency_contact_phone: editForm.emergencyContact?.phone,
          emergency_contact_relationship: editForm.emergencyContact?.relationship
        })
        setProfile({ ...profile, ...editForm })
        setIsEditing(false)
        alert('✅ Profile updated successfully!')
      } catch (error) {
        alert('❌ Failed to update profile: ' + (error instanceof Error ? error.message : 'Unknown error'))
      } finally {
        setSaving(false)
      }
    }
  }

  const handleAvatarChange = (newAvatar: string) => {
    setEditForm(prev => ({ ...prev, avatar: newAvatar }))
  }

  const toggleTwoFactor = async () => {
    try {
      const result = await toggle2FA()
      setEditForm(prev => ({
        ...prev,
        security: {
          ...prev.security!,
          twoFactorEnabled: result.two_factor_enabled
        }
      }))
      setProfile(prev => prev ? {
        ...prev,
        security: {
          ...prev.security,
          twoFactorEnabled: result.two_factor_enabled
        }
      } : null)
      alert(`✅ Two-factor authentication ${result.two_factor_enabled ? 'enabled' : 'disabled'}`)
    } catch (error) {
      alert('❌ Failed to toggle 2FA: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const handleChangePassword = async () => {
    const currentPassword = prompt('Enter current password:')
    if (!currentPassword) return

    const newPassword = prompt('Enter new password:')
    if (!newPassword) return

    if (newPassword.length < 6) {
      alert('❌ Password must be at least 6 characters')
      return
    }

    try {
      await changePassword(currentPassword, newPassword)
      setEditForm(prev => ({
        ...prev,
        security: {
          ...prev.security!,
          lastPasswordChange: new Date().toISOString()
        }
      }))
      setProfile(prev => prev ? {
        ...prev,
        security: {
          ...prev.security,
          lastPasswordChange: new Date().toISOString()
        }
      } : null)
      alert('✅ Password changed successfully!')
    } catch (error) {
      alert('❌ Failed to change password: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  if (!profile) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading profile...</div>
  }

  const renderProfileTab = () => (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '2rem' }}>
      {/* Avatar and Basic Info */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '0.5rem',
        padding: '2rem',
        textAlign: 'center'
      }}>
        <div style={{ marginBottom: '1rem' }}>
          <div style={{
            fontSize: '4rem',
            marginBottom: '1rem',
            cursor: isEditing ? 'pointer' : 'default'
          }}>
            {editForm.avatar || profile.avatar}
          </div>
          {isEditing && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '1rem' }}>
              {['👨‍⚕️', '👩‍⚕️', '🧑‍🔬', '👨‍💼', '👩‍💼', '🏥'].map(emoji => (
                <button
                  key={emoji}
                  onClick={() => handleAvatarChange(emoji)}
                  style={{
                    padding: '0.5rem',
                    background: editForm.avatar === emoji ? 'var(--primary)' : 'var(--hover)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.25rem',
                    cursor: 'pointer',
                    fontSize: '1.5rem'
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        <h3>{profile.firstName} {profile.lastName}</h3>
        <p style={{
          background: 'var(--primary)',
          color: 'white',
          padding: '0.25rem 0.5rem',
          borderRadius: '1rem',
          fontSize: '0.9rem',
          fontWeight: 'bold',
          display: 'inline-block',
          marginBottom: '1rem'
        }}>
          {profile.role.toUpperCase()}
        </p>

        <div style={{ textAlign: 'left', fontSize: '0.9rem' }}>
          <div style={{ marginBottom: '0.5rem' }}>
            <strong>📧</strong> {profile.email}
          </div>
          <div style={{ marginBottom: '0.5rem' }}>
            <strong>📱</strong> {profile.phone}
          </div>
          <div style={{ marginBottom: '0.5rem' }}>
            <strong>🏢</strong> {profile.department}
          </div>
          {profile.licenseNumber && (
            <div style={{ marginBottom: '0.5rem' }}>
              <strong>📋</strong> License: {profile.licenseNumber}
            </div>
          )}
        </div>
      </div>

      {/* Detailed Info */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '0.5rem',
        padding: '2rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <h2>Profile Information</h2>
          <button
            onClick={() => isEditing ? handleSave() : setIsEditing(true)}
            style={{
              padding: '0.5rem 1rem',
              background: isEditing ? 'var(--success)' : 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer'
            }}
          >
            {isEditing ? '💾 Save' : '✏️ Edit'}
          </button>
        </div>

        <div style={{ display: 'grid', gap: '1.5rem' }}>
          {/* Personal Information */}
          <div>
            <h3>👤 Personal Information</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                  First Name
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.firstName || ''}
                    onChange={(e) => setEditForm(prev => ({ ...prev, firstName: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '0.25rem'
                    }}
                  />
                ) : (
                  <p>{profile.firstName}</p>
                )}
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                  Last Name
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.lastName || ''}
                    onChange={(e) => setEditForm(prev => ({ ...prev, lastName: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '0.25rem'
                    }}
                  />
                ) : (
                  <p>{profile.lastName}</p>
                )}
              </div>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                Bio
              </label>
              {isEditing ? (
                <textarea
                  value={editForm.bio || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, bio: e.target.value }))}
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border)',
                    borderRadius: '0.25rem',
                    resize: 'vertical'
                  }}
                />
              ) : (
                <p>{profile.bio}</p>
              )}
            </div>
          </div>

          {/* Emergency Contact */}
          <div>
            <h3>🚨 Emergency Contact</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                  Name
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.emergencyContact?.name || ''}
                    onChange={(e) => setEditForm(prev => ({
                      ...prev,
                      emergencyContact: { ...prev.emergencyContact!, name: e.target.value }
                    }))}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '0.25rem'
                    }}
                  />
                ) : (
                  <p>{profile.emergencyContact.name}</p>
                )}
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                  Phone
                </label>
                {isEditing ? (
                  <input
                    type="tel"
                    value={editForm.emergencyContact?.phone || ''}
                    onChange={(e) => setEditForm(prev => ({
                      ...prev,
                      emergencyContact: { ...prev.emergencyContact!, phone: e.target.value }
                    }))}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '0.25rem'
                    }}
                  />
                ) : (
                  <p>{profile.emergencyContact.phone}</p>
                )}
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                  Relationship
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.emergencyContact?.relationship || ''}
                    onChange={(e) => setEditForm(prev => ({
                      ...prev,
                      emergencyContact: { ...prev.emergencyContact!, relationship: e.target.value }
                    }))}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '0.25rem'
                    }}
                  />
                ) : (
                  <p>{profile.emergencyContact.relationship}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const renderSecurityTab = () => (
    <div style={{ maxWidth: '800px' }}>
      <h2>🔐 Security Settings</h2>

      <div style={{ display: 'grid', gap: '1.5rem' }}>
        {/* Password */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0.5rem',
          padding: '1.5rem'
        }}>
          <h3>Password</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p>Last changed: {new Date(profile.security.lastPasswordChange).toLocaleDateString()}</p>
              <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                Regular password changes help keep your account secure
              </p>
            </div>
            <button
              onClick={handleChangePassword}
              style={{
                padding: '0.5rem 1rem',
                background: 'var(--primary)',
                color: 'white',
                border: 'none',
                borderRadius: '0.25rem',
                cursor: 'pointer'
              }}
            >
              Change Password
            </button>
          </div>
        </div>

        {/* Two-Factor Authentication */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0.5rem',
          padding: '1.5rem'
        }}>
          <h3>Two-Factor Authentication</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p>Status: {profile.security.twoFactorEnabled ? '✅ Enabled' : '❌ Disabled'}</p>
              <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                Add an extra layer of security to your account
              </p>
            </div>
            <button
              onClick={toggleTwoFactor}
              style={{
                padding: '0.5rem 1rem',
                background: profile.security.twoFactorEnabled ? 'var(--error)' : 'var(--success)',
                color: 'white',
                border: 'none',
                borderRadius: '0.25rem',
                cursor: 'pointer'
              }}
            >
              {profile.security.twoFactorEnabled ? 'Disable' : 'Enable'} 2FA
            </button>
          </div>
        </div>

        {/* Login History */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0.5rem',
          padding: '1.5rem'
        }}>
          <h3>Recent Login Activity</h3>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: 'var(--hover)', borderRadius: '0.25rem' }}>
              <span>Today, 9:30 AM</span>
              <span style={{ color: 'var(--success)' }}>✅ Successful</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: 'var(--hover)', borderRadius: '0.25rem' }}>
              <span>Yesterday, 2:15 PM</span>
              <span style={{ color: 'var(--success)' }}>✅ Successful</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: 'var(--hover)', borderRadius: '0.25rem' }}>
              <span>Jan 10, 8:45 AM</span>
              <span style={{ color: 'var(--error)' }}>❌ Failed attempt</span>
            </div>
          </div>
        </div>

        {/* Account Status */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0.5rem',
          padding: '1.5rem'
        }}>
          <h3>Account Status</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <strong>Login Attempts:</strong> {profile.security.loginAttempts}
            </div>
            <div>
              <strong>Account Locked:</strong>
              <span style={{ color: profile.security.accountLocked ? 'var(--error)' : 'var(--success)' }}>
                {profile.security.accountLocked ? 'Yes' : 'No'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const renderPreferencesTab = () => (
    <div style={{ maxWidth: '800px' }}>
      <h2>⚙️ Preferences</h2>

      <div style={{ display: 'grid', gap: '1.5rem' }}>
        {/* Theme */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0.5rem',
          padding: '1.5rem'
        }}>
          <h3>Theme</h3>
          <div style={{ display: 'flex', gap: '1rem' }}>
            {[
              { value: 'light', label: '☀️ Light', desc: 'Bright and clean' },
              { value: 'dark', label: '🌙 Dark', desc: 'Easy on the eyes' },
              { value: 'auto', label: '🤖 Auto', desc: 'Follows system' }
            ].map(theme => (
              <button
                key={theme.value}
                onClick={() => {
                  // Update form state
                  setEditForm(prev => ({
                    ...prev,
                    preferences: { ...prev.preferences!, theme: theme.value as 'light' | 'dark' | 'auto' }
                  }))
                  
                  // Apply theme immediately
                  const selectedTheme = theme.value as 'light' | 'dark' | 'auto'
                  let effectiveTheme: 'light' | 'dark' = 'dark'
                  
                  if (selectedTheme === 'auto') {
                    effectiveTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
                  } else {
                    effectiveTheme = selectedTheme
                  }

                  if (effectiveTheme === 'light') {
                    document.documentElement.setAttribute('data-theme', 'light')
                  } else {
                    document.documentElement.removeAttribute('data-theme')
                  }
                  
                  localStorage.setItem('theme', selectedTheme)
                }}
                style={{
                  flex: 1,
                  padding: '1rem',
                  background: profile.preferences.theme === theme.value ? 'var(--primary)' : 'var(--hover)',
                  color: profile.preferences.theme === theme.value ? 'white' : 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  textAlign: 'center'
                }}
              >
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{theme.label.split(' ')[0]}</div>
                <div style={{ fontWeight: 'bold' }}>{theme.label.split(' ')[1]}</div>
                <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>{theme.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Notifications */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0.5rem',
          padding: '1.5rem'
        }}>
          <h3>Notifications</h3>
          <div style={{ display: 'grid', gap: '1rem' }}>
            {[
              { key: 'email', label: '📧 Email Notifications', desc: 'Receive updates via email' },
              { key: 'sms', label: '📱 SMS Notifications', desc: 'Get alerts on your phone' },
              { key: 'push', label: '🔔 Push Notifications', desc: 'Browser notifications' }
            ].map(notification => (
              <div key={notification.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 'bold' }}>{notification.label}</div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>{notification.desc}</div>
                </div>
                <label style={{ position: 'relative', display: 'inline-block', width: '50px', height: '24px' }}>
                  <input
                    type="checkbox"
                    checked={profile.preferences.notifications[notification.key as keyof typeof profile.preferences.notifications]}
                    onChange={(e) => setEditForm(prev => ({
                      ...prev,
                      preferences: {
                        ...prev.preferences!,
                        notifications: {
                          ...prev.preferences!.notifications,
                          [notification.key]: e.target.checked
                        }
                      }
                    }))}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    cursor: 'pointer',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: profile.preferences.notifications[notification.key as keyof typeof profile.preferences.notifications]
                      ? 'var(--primary)' : '#ccc',
                    borderRadius: '24px',
                    transition: '0.3s'
                  }}>
                    <span style={{
                      position: 'absolute',
                      height: '18px',
                      width: '18px',
                      left: '3px',
                      bottom: '3px',
                      background: 'white',
                      borderRadius: '50%',
                      transition: '0.3s',
                      transform: profile.preferences.notifications[notification.key as keyof typeof profile.preferences.notifications]
                        ? 'translateX(26px)' : 'translateX(0)'
                    }} />
                  </span>
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Language & Timezone */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0.5rem',
          padding: '1.5rem'
        }}>
          <h3>Language & Region</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                Language
              </label>
              <select
                value={profile.preferences.language}
                onChange={(e) => setEditForm(prev => ({
                  ...prev,
                  preferences: { ...prev.preferences!, language: e.target.value }
                }))}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '0.25rem'
                }}
              >
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 'bold' }}>
                Timezone
              </label>
              <select
                value={profile.preferences.timezone}
                onChange={(e) => setEditForm(prev => ({
                  ...prev,
                  preferences: { ...prev.preferences!, timezone: e.target.value }
                }))}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border)',
                  borderRadius: '0.25rem'
                }}
              >
                <option value="America/New_York">Eastern Time</option>
                <option value="America/Chicago">Central Time</option>
                <option value="America/Denver">Mountain Time</option>
                <option value="America/Los_Angeles">Pacific Time</option>
                <option value="Europe/London">London</option>
                <option value="Europe/Paris">Paris</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const renderActivityTab = () => (
    <div style={{ maxWidth: '1000px' }}>
      <h2>📈 Activity Overview</h2>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0.5rem',
          padding: '1.5rem',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📤</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--primary)' }}>
            {profile.stats.filesUploaded}
          </div>
          <div style={{ color: 'var(--muted)' }}>Files Uploaded</div>
        </div>

        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0.5rem',
          padding: '1.5rem',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📥</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--primary)' }}>
            {profile.stats.filesDownloaded}
          </div>
          <div style={{ color: 'var(--muted)' }}>Files Downloaded</div>
        </div>

        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0.5rem',
          padding: '1.5rem',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📋</div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--primary)' }}>
            {profile.stats.consentsGranted}
          </div>
          <div style={{ color: 'var(--muted)' }}>Consents Granted</div>
        </div>

        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0.5rem',
          padding: '1.5rem',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🕒</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--primary)' }}>
            {new Date(profile.stats.lastLogin).toLocaleDateString()}
          </div>
          <div style={{ color: 'var(--muted)' }}>Last Login</div>
        </div>
      </div>

      {/* Recent Activity */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '0.5rem',
        padding: '1.5rem'
      }}>
        <h3>Recent Activity</h3>
        <div style={{ display: 'grid', gap: '1rem' }}>
          {[
            { icon: '📤', action: 'Uploaded chest CT scan', time: '2 hours ago', type: 'upload' },
            { icon: '📥', action: 'Downloaded patient MRI', time: '5 hours ago', type: 'download' },
            { icon: '📋', action: 'Granted consent for radiology review', time: '1 day ago', type: 'consent' },
            { icon: '🔐', action: 'Changed password', time: '3 days ago', type: 'security' },
            { icon: '📤', action: 'Uploaded X-ray series', time: '1 week ago', type: 'upload' }
          ].map((activity, index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                padding: '1rem',
                background: 'var(--hover)',
                borderRadius: '0.5rem'
              }}
            >
              <div style={{ fontSize: '1.5rem' }}>{activity.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold' }}>{activity.action}</div>
                <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>{activity.time}</div>
              </div>
              <div style={{
                padding: '0.25rem 0.5rem',
                background: 'var(--primary)',
                color: 'white',
                borderRadius: '0.25rem',
                fontSize: '0.8rem',
                fontWeight: 'bold'
              }}>
                {activity.type.toUpperCase()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ margin: 0, color: 'var(--primary)' }}>👤 Profile Management</h1>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--muted)' }}>
            Manage your account settings and preferences
          </p>
        </div>
        {isEditing && (
          <button
            onClick={() => setIsEditing(false)}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--error)',
              color: 'white',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Tab Navigation */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border)',
        background: 'var(--hover)',
        marginBottom: '2rem'
      }}>
        {[
          { id: 'profile', label: '👤 Profile', icon: '👤' },
          { id: 'security', label: '🔐 Security', icon: '🔐' },
          { id: 'preferences', label: '⚙️ Preferences', icon: '⚙️' },
          { id: 'activity', label: '📈 Activity', icon: '📈' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as 'profile' | 'security' | 'preferences' | 'activity')}
            style={{
              flex: 1,
              padding: '1rem',
              background: activeTab === tab.id ? 'var(--surface)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--primary)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontWeight: activeTab === tab.id ? 'bold' : 'normal'
            }}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'profile' && renderProfileTab()}
      {activeTab === 'security' && renderSecurityTab()}
      {activeTab === 'preferences' && renderPreferencesTab()}
      {activeTab === 'activity' && renderActivityTab()}
    </div>
  )
}