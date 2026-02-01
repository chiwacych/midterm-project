# DPA-Compliant Patient-Centered Medical Imaging Platform

## Overview
This platform has been transformed into a **DPA-compliant, patient-centered medical imaging storage and sharing system** that observes data protection regulations while enabling secure federated sharing of medical images.

## Key Features Implemented

### 1. Patient-Centered Architecture ✅
All file operations are now centered around **Patient records**, not just files.

#### Database Schema
- **`patients` table**: Stores patient information with DPA-compliant identifier hashing
  - Uses SHA256 hashes of name+phone, name+email, or name+email+phone for privacy-preserving patient matching
  - Medical Record Number (MRN) for hospital integration
  - Emergency contacts and medical notes
  
- **`file_metadata` updates**:
  - Added `patient_id` foreign key (REQUIRED for all uploads)
  - Added DICOM-specific fields: `dicom_study_id`, `dicom_series_id`, `dicom_modality`, `dicom_study_date`
  
- **`consents` updates**:
  - Added `patient_id` to link consents to patient records
  - Supports patient-level consent scopes

- **`access_requests` table** (new):
  - Formal access request tracking
  - Links to both patients and specific files
  - Status tracking (pending, approved, denied, expired)

#### API Endpoints
**Patient Management** (`/api/patients`):
- `POST /api/patients` - Create new patient record (doctors/admins only)
- `GET /api/patients` - List all patients with search
- `POST /api/patients/search` - DPA-compliant patient search by name+email/phone combinations
- `GET /api/patients/{id}` - Get patient details
- `PUT /api/patients/{id}` - Update patient information
- `GET /api/patients/{id}/files` - Get all files for a patient

**Upload Requirements**:
- All uploads now REQUIRE `patient_id` parameter
- Access control: Patients can only upload to their own records
- Doctors/admins can upload to any patient

### 2. Enhanced Dashboard ✅
The dashboard now displays:
- **System Statistics**: Total files, storage usage, patient count (for doctors/admins), upload success rate
- **Pending Access Requests**: Shows pending consent requests with requester info, reason, and action buttons
- **Storage Node Health**: Real-time health status of all 3 MinIO nodes with visual indicators
  - Green: Healthy
  - Red: Offline
  - Shows last check time and file counts

### 3. DICOM Viewer Integration ✅
Replaced mock DICOM preview with **DWV (DICOM Web Viewer)** library:
- **Route**: `/dicom-viewer?fileId={id}`
- **Features**:
  - Native DICOM file rendering in browser
  - Tools: Scroll, Zoom/Pan, Window/Level adjustment, Measurement ruler
  - Reset view functionality
  - Automatic detection: Files with `.dcm`, `.dicom` extensions or `dicom` content type show "View DICOM" button in FileBrowser

### 4. Patient-Centered Share Access ✅
Complete rebuild of the Share Access system:

#### Features:
- **Patient Selection**: Browse and search patients using DPA-compliant identifiers
- **Three Tabs**:
  1. **Patients**: Search and select patients (by name+email, name+phone, or name+MRN)
  2. **Share Access**: Grant/revoke consent for selected patient's data
  3. **Access Requests**: Approve/deny pending requests (doctors/admins only)

#### DPA-Compliant Patient Search:
- Search by exact name + email
- Search by exact name + phone
- Search by name + email + phone (triple verification)
- Uses SHA256 hashes for privacy-preserving matching

#### Access Control:
- **Patients**: Can only view their own records
- **Doctors/Admins**: Can manage all patients and grant/revoke access
- **Role-based consent**: Grant access to all doctors, specific users, or by role

### 5. Data Flow & Security

#### Upload Flow:
```
1. User selects patient from dropdown/search
2. User uploads file (DICOM or other medical image)
3. Backend validates patient_id and user permissions
4. File stored in MinIO with metadata linked to patient
5. Audit log created
6. File replicated to all 3 nodes
```

#### Access Control Flow:
```
1. User requests access to patient data
2. Request stored in access_requests table
3. Patient or doctor reviews request
4. If approved, consent record created
5. User can access patient's files within consent scope/expiration
6. All access logged in audit_logs
```

## Frontend Structure

### Pages:
- **Dashboard** (`/`): Overview with stats, requests, node health
- **Files** (`/files`): File browser with DICOM viewer links
- **DICOM Viewer** (`/dicom-viewer?fileId={id}`): Medical image viewer
- **Share Access** (`/share`): Patient-centered access management
- **Consent Management** (`/consent-management`): Consent tree view
- **Federation Network** (`/federation`): Federation node monitoring
- **Audit Logs** (`/audit`): Complete audit trail
- **Profile** (`/profile`): User profile management

### API Client Updates:
All API endpoints are typed and integrated:
- Patient CRUD operations
- Patient search with DPA compliance
- File operations with patient linking
- Consent management
- Access request handling

## Migration Guide

### 1. Run Database Migration:
```bash
cd scripts
python migrate_to_patient_centered.py
```

This will:
- Create `patients` table
- Create `access_requests` table
- Add `patient_id` to `file_metadata`
- Add DICOM fields to `file_metadata`
- Add `patient_id` to `consents`

### 2. Create Initial Patients:
```python
# Example: Create a patient record
POST /api/patients
{
  "full_name": "John Doe",
  "email": "john.doe@example.com",
  "phone": "+1234567890",
  "date_of_birth": "1980-01-01",
  "medical_record_number": "MRN001"
}
```

### 3. Update Upload Forms:
All upload operations must now include `patient_id`:
```javascript
const formData = new FormData()
formData.append('file', file)
formData.append('patient_id', selectedPatient.id)
formData.append('description', description)
await uploadFile(formData)
```

### 4. Install Frontend Dependencies:
```bash
cd frontend
npm install
```
This will install the `dwv` DICOM viewer library.

### 5. Rebuild Frontend:
```bash
npm run build
```

### 6. Restart Services:
```bash
docker-compose down
docker-compose up -d --build
```

## Testing

### 1. Test Patient Creation:
- Login as doctor/admin
- Navigate to `/share`
- Click "Patients" tab
- Fill in patient search form with name+email or name+phone
- Verify patient can be found

### 2. Test File Upload:
- Try uploading without patient_id → Should fail with error
- Upload with valid patient_id → Should succeed
- Verify file appears in patient's file list

### 3. Test DICOM Viewer:
- Upload a DICOM file (`.dcm`)
- Click "View DICOM" in Files page
- Verify image displays correctly
- Test zoom, pan, and measurement tools

### 4. Test Access Sharing:
- Navigate to `/share`
- Select a patient
- Grant access to a doctor role
- Verify consent appears in "Share Access" tab
- Test revoke functionality

### 5. Test Dashboard:
- Verify stats display correctly
- Check pending requests show up
- Confirm node health indicators are working

## Security & Compliance

### DPA Compliance:
✅ Patient identifier hashing (SHA256)
✅ Minimal data exposure in searches
✅ Consent-based access control
✅ Complete audit trail
✅ Data encryption at rest (MinIO)
✅ Data encryption in transit (HTTPS)
✅ Role-based access control (RBAC)

### SDG Alignment:
- **SDG 3 (Good Health)**: Enabling better medical data sharing for improved patient care
- **SDG 9 (Industry, Innovation)**: Modern federated medical imaging infrastructure
- **SDG 16 (Peace, Justice)**: Transparent audit logging and data governance

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React/Vite)                   │
│  Dashboard | Files | DICOM Viewer | Share | Consent | ...  │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS/REST API
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI Backend                          │
│  /api/patients | /api/upload | /api/dashboard | ...        │
├─────────────────────────────────────────────────────────────┤
│  Auth (JWT RS256) | Consent Check | Audit Log              │
└─────┬────────────┬────────────────┬──────────────┬─────────┘
      │            │                │              │
      ▼            ▼                ▼              ▼
┌──────────┐  ┌──────────┐    ┌────────┐    ┌──────────┐
│PostgreSQL│  │  Redis   │    │ MinIO  │    │ Kafka    │
│ Metadata │  │  Cache   │    │ Cluster│    │ Events   │
│ Patients │  │  Health  │    │ 3 Nodes│    │ (Audit)  │
└──────────┘  └──────────┘    └────────┘    └──────────┘
```

## Next Steps

### Recommended Enhancements:
1. **HL7/FHIR Integration**: Connect to hospital EMR systems
2. **DICOM Worklist**: Integrate DICOM modality worklist
3. **AI/ML Pipeline**: Add medical image analysis
4. **Mobile App**: React Native app for doctors
5. **Backup/DR**: Automated backup to cloud storage
6. **Multi-tenancy**: Support multiple hospitals/clinics
7. **Advanced DICOM Tools**: Annotations, MPR, 3D rendering

### Documentation:
- See `docs/migration-roadmap.md` for detailed migration plan
- See `docs/testing.md` for comprehensive test scenarios
- See `README.md` for architecture overview

## Support & Troubleshooting

### Common Issues:

**Upload fails with "patient_id required"**:
- Ensure patient record exists first
- Update upload form to include patient_id

**DICOM viewer shows blank screen**:
- Check browser console for DWV errors
- Verify DWV script loaded from CDN
- Ensure file is valid DICOM format

**Patient search returns no results**:
- Verify exact name+email or name+phone match
- Check for typos in search form
- Ensure patient exists in database

### Getting Help:
- Check logs: `docker-compose logs -f fastapi`
- Verify database: `docker-compose exec postgres psql -U dfsuser -d dfs_metadata`
- Check MinIO: Access consoles at ports 9001, 9002, 9003

## Conclusion

Your medical imaging platform is now fully DPA-compliant with:
- ✅ Patient-centered architecture
- ✅ DPA-compliant identifier hashing
- ✅ Real-time dashboard with node health
- ✅ Professional DICOM viewer
- ✅ Patient-centered access sharing
- ✅ Complete audit trail

All uploads are now tied to patients, ensuring proper data governance and enabling better medical workflows!
