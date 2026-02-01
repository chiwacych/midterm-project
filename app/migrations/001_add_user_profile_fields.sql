-- Migration 001: Add user profile fields
-- Date: 2026-01-31
-- Description: Adds profile-related columns to the users table

-- Add phone column
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);

-- Add department column
ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(100);

-- Add bio column
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;

-- Add emergency contact column
ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(200);

-- Add preferences JSON column with default empty object
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}';

-- Add two-factor authentication fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret VARCHAR(100);

-- Add last password change timestamp
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_password_change TIMESTAMP;

-- Create index on two_factor_enabled for faster auth queries
CREATE INDEX IF NOT EXISTS idx_users_two_factor_enabled ON users(two_factor_enabled);
