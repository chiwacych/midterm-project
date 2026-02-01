import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { Dashboard } from './pages/Dashboard'
import { FileBrowser } from './pages/FileBrowser'
import { Consent } from './pages/Consent'
import { AdvancedSearch } from './pages/AdvancedSearch'
import { UploadQueue } from './pages/UploadQueue'
import { DicomViewer } from './pages/DicomViewer'
import { ShareAccessPatient } from './pages/ShareAccessPatient'
import { ConsentManagement } from './pages/ConsentManagement'
import { FederationNetwork } from './pages/FederationNetwork'
import { AuditLogViewer } from './pages/AuditLogViewer'
import { UserProfileManagement } from './pages/UserProfileManagement'
import { SettingsAccessControl } from './pages/SettingsAccessControl'
import { useAuth } from './contexts/AuthContext'

function App() {
  const { user, isReady } = useAuth()

  if (!isReady) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
        Loading...
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/signup" element={user ? <Navigate to="/" replace /> : <Signup />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="files" element={<FileBrowser />} />
        <Route path="consent" element={<Consent />} />
        <Route path="search" element={<AdvancedSearch />} />
        <Route path="upload" element={<UploadQueue />} />
        <Route path="dicom-viewer" element={<DicomViewer />} />
        <Route path="share" element={<ShareAccessPatient />} />
        <Route path="consent-management" element={<ConsentManagement />} />
        <Route path="federation" element={<FederationNetwork />} />
        <Route path="audit" element={<AuditLogViewer />} />
        <Route path="profile" element={<UserProfileManagement />} />
        <Route path="access-control" element={<SettingsAccessControl />} />
        <Route path="admin" element={<div style={{ padding: '1rem' }}>Admin panel</div>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App