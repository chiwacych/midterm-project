-- Migration 004: Add patients, notifications tables and federation fields
-- Date: 2025-01-XX
-- Description:
--   1. Create 'patients' table for DPA-compliant patient records
--   2. Create 'notifications' table for user notifications
--   3. Add federation columns to access_requests (patient_id, hospital IDs, requester_identifier)
--   4. Add federation columns to consents (patient_id, granted_to_hospital_id/name)
--   5. Add patient_id to file_metadata
--   6. Rename audit_log -> audit_logs (fix table name mismatch with ORM model)

-- ============================================================
-- 1. Create patients table
-- ============================================================
CREATE TABLE IF NOT EXISTS patients (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    date_of_birth DATE,
    medical_record_number VARCHAR(100) UNIQUE,

    -- DPA-compliant hashed identifiers for patient matching
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

CREATE INDEX IF NOT EXISTS idx_patients_full_name ON patients(full_name);
CREATE INDEX IF NOT EXISTS idx_patients_email ON patients(email);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_mrn ON patients(medical_record_number);
CREATE INDEX IF NOT EXISTS idx_patients_name_phone_hash ON patients(name_phone_hash);
CREATE INDEX IF NOT EXISTS idx_patients_name_email_hash ON patients(name_email_hash);
CREATE INDEX IF NOT EXISTS idx_patients_name_email_phone_hash ON patients(name_email_phone_hash);

-- ============================================================
-- 2. Create notifications table
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,  -- info, success, warning, error, access_request, consent
    read BOOLEAN DEFAULT FALSE,
    link VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

-- ============================================================
-- 3. Add federation columns to access_requests
-- ============================================================
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patients(id);
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS requester_hospital_id VARCHAR(100);
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS target_hospital_id VARCHAR(100);
ALTER TABLE access_requests ADD COLUMN IF NOT EXISTS requester_identifier VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_access_requests_patient_id ON access_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_requester_hospital ON access_requests(requester_hospital_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_target_hospital ON access_requests(target_hospital_id);

-- ============================================================
-- 4. Add federation columns to consents
-- ============================================================
ALTER TABLE consents ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patients(id);
ALTER TABLE consents ADD COLUMN IF NOT EXISTS granted_to_hospital_id VARCHAR(100);
ALTER TABLE consents ADD COLUMN IF NOT EXISTS granted_to_hospital_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_consents_patient_id ON consents(patient_id);
CREATE INDEX IF NOT EXISTS idx_consents_granted_to_hospital ON consents(granted_to_hospital_id);

-- ============================================================
-- 5. Add patient_id to file_metadata
-- ============================================================
ALTER TABLE file_metadata ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patients(id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_patient_id ON file_metadata(patient_id);

-- ============================================================
-- 6. Rename audit_log -> audit_logs (fix ORM mismatch)
--    Migration 002 created 'audit_log', but the model uses 'audit_logs'
-- ============================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_log')
       AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
        ALTER TABLE audit_log RENAME TO audit_logs;
    END IF;
END $$;
