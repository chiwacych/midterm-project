import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { Dashboard } from './pages/Dashboard'
import { FilesManager } from './pages/FilesManager'
import { Consent } from './pages/Consent'
import { ShareAccessPatient } from './pages/ShareAccessPatient'
import { FederationNetwork } from './pages/FederationNetwork'
import { AccountSettings } from './pages/AccountSettings'
import { SetupPassword } from './pages/SetupPassword'
import { DicomViewer } from './pages/DicomViewer'
import { TwoFactorSetup } from './pages/TwoFactorSetup'
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
      <Route path="/setup-password" element={user ? <Navigate to="/" replace /> : <SetupPassword />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        {/* Patient-accessible routes */}
        <Route path="consent" element={<Consent />} />
        <Route path="settings" element={<AccountSettings />} />
        <Route path="settings/2fa" element={<TwoFactorSetup />} />
        {/* Doctor/Admin only routes */}
        <Route path="files" element={<ProtectedRoute allowedRoles={['doctor', 'admin']}><FilesManager /></ProtectedRoute>} />
        <Route path="dicom-viewer" element={<ProtectedRoute allowedRoles={['doctor', 'admin']}><DicomViewer /></ProtectedRoute>} />
        <Route path="share" element={<ProtectedRoute allowedRoles={['doctor', 'admin']}><ShareAccessPatient /></ProtectedRoute>} />
        <Route path="federation" element={<ProtectedRoute allowedRoles={['doctor', 'admin']}><FederationNetwork /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App