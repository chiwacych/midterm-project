-- DPA-Compliant Patient-Centered Architecture Migration
-- Run this SQL script to add patient-centered features to your database

-- 1. Create patients table
CREATE TABLE IF NOT EXISTS patients (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    date_of_birth DATE,
    medical_record_number VARCHAR(100) UNIQUE,
    
    -- DPA-compliant identifier hashes
    name_phone_hash VARCHAR(64),
    name_email_hash VARCHAR(64),
    name_email_phone_hash VARCHAR(64),
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by_user_id INTEGER REFERENCES users(id),
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Additional fields
    address TEXT,
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(50),
    notes TEXT
);

-- Create indexes for patient search
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(full_name);
CREATE INDEX IF NOT EXISTS idx_patients_email ON patients(email);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_mrn ON patients(medical_record_number);
CREATE INDEX IF NOT EXISTS idx_patients_name_phone_hash ON patients(name_phone_hash);
CREATE INDEX IF NOT EXISTS idx_patients_name_email_hash ON patients(name_email_hash);
CREATE INDEX IF NOT EXISTS idx_patients_name_email_phone_hash ON patients(name_email_phone_hash);

-- 2. Create access_requests table
CREATE TABLE IF NOT EXISTS access_requests (
    id SERIAL PRIMARY KEY,
    requester_id INTEGER NOT NULL REFERENCES users(id),
    patient_id INTEGER REFERENCES patients(id),
    file_id INTEGER REFERENCES file_metadata(id),
    scope VARCHAR(100),
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by INTEGER REFERENCES users(id),
    expires_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for access_requests
CREATE INDEX IF NOT EXISTS idx_access_requests_requester ON access_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_patient ON access_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_file ON access_requests(file_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);

-- 3. Add patient_id to file_metadata
ALTER TABLE file_metadata 
ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patients(id);

-- 4. Add DICOM fields to file_metadata
ALTER TABLE file_metadata 
ADD COLUMN IF NOT EXISTS dicom_study_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS dicom_series_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS dicom_modality VARCHAR(50),
ADD COLUMN IF NOT EXISTS dicom_study_date DATE;

-- Create indexes for file_metadata
CREATE INDEX IF NOT EXISTS idx_file_metadata_patient ON file_metadata(patient_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_dicom_study ON file_metadata(dicom_study_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_dicom_series ON file_metadata(dicom_series_id);

-- 5. Add patient_id to consents
ALTER TABLE consents 
ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patients(id);

-- Create index for consents
CREATE INDEX IF NOT EXISTS idx_consents_patient ON consents(patient_id);

-- 6. Update trigger for patients.updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_patients_updated_at ON patients;
CREATE TRIGGER update_patients_updated_at
    BEFORE UPDATE ON patients
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ Migration completed successfully!';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️  IMPORTANT: All file uploads now require a patient_id.';
    RAISE NOTICE '   You may need to:';
    RAISE NOTICE '   1. Create patient records for existing users';
    RAISE NOTICE '   2. Update existing files to link to patients';
    RAISE NOTICE '   3. Update your frontend upload forms to include patient selection';
END $$;
