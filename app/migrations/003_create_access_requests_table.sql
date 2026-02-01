-- Migration 003: Create access_requests table
-- Date: 2026-01-31
-- Description: Creates the access_requests table for managing file access requests

CREATE TABLE IF NOT EXISTS access_requests (
    id SERIAL PRIMARY KEY,
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_id INTEGER REFERENCES file_metadata(id) ON DELETE CASCADE,
    scope VARCHAR(50),
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, approved, denied, expired
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_access_requests_requester ON access_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);
CREATE INDEX IF NOT EXISTS idx_access_requests_file ON access_requests(file_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_pending ON access_requests(status) WHERE status = 'pending';
