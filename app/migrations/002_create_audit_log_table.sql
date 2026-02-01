-- Migration 002: Create audit_log table
-- Date: 2026-01-31
-- Description: Creates the audit_log table for tracking system events

CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    event_type VARCHAR(100) NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_role VARCHAR(50),
    action VARCHAR(255) NOT NULL,
    resource VARCHAR(255),
    resource_id VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'success', -- success, failure, warning
    severity VARCHAR(20) NOT NULL DEFAULT 'low',   -- low, medium, high, critical
    details JSONB DEFAULT '{}'
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_status ON audit_log(status);
CREATE INDEX IF NOT EXISTS idx_audit_log_severity ON audit_log(severity);

-- Composite index for date range queries with filters
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp_type ON audit_log(timestamp, event_type);
