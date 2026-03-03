-- Migration 005: Link users to patients + invitation token flow
-- Date: 2025-01-XX
-- Description:
--   1. Add patient_id FK on users table (1:1 link to patients)
--   2. Add invitation_token + invitation_expires_at for doctor-created patient login setup
--   3. Indexes for performance

-- ============================================================
-- 1. Add patient_id FK to users table
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_id INTEGER UNIQUE REFERENCES patients(id);

-- ============================================================
-- 2. Add invitation token columns
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_token VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_expires_at TIMESTAMP WITH TIME ZONE;

-- ============================================================
-- 3. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_patient_id ON users(patient_id);
CREATE INDEX IF NOT EXISTS idx_users_invitation_token ON users(invitation_token);

-- ============================================================
-- 4. Back-fill: link existing patient-role users to matching patient records
-- ============================================================
UPDATE users u
SET patient_id = p.id
FROM patients p
WHERE u.role = 'patient'
  AND u.patient_id IS NULL
  AND u.email IS NOT NULL
  AND u.email = p.email
  AND NOT EXISTS (
      SELECT 1 FROM users u2 WHERE u2.patient_id = p.id
  );
