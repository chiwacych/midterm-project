from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, Float, ForeignKey, Enum as SQLEnum, Date
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import enum

Base = declarative_base()


class UserRole(str, enum.Enum):
    admin = "admin"
    doctor = "doctor"
    patient = "patient"


class User(Base):
    """User accounts with RBAC (admin, doctor, patient)"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255))
    role = Column(String(20), nullable=False, default=UserRole.patient.value)  # admin, doctor, patient
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Hospital/Institution for federated sharing
    hospital_id = Column(String(100), index=True)  # e.g., "hospital-a", "hospital-b"
    hospital_name = Column(String(255))  # Human-readable name
    
    # Link to patient record (unifies users and patients tables)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=True, unique=True, index=True)
    
    # Invitation token for doctor/admin-created patient accounts to set their password
    invitation_token = Column(String(255), nullable=True, unique=True, index=True)
    invitation_expires_at = Column(DateTime(timezone=True), nullable=True)
    
    # Profile fields
    phone = Column(String(50))
    department = Column(String(100))
    license_number = Column(String(100))
    date_of_birth = Column(Date)
    bio = Column(Text)
    
    # Emergency contact
    emergency_contact_name = Column(String(255))
    emergency_contact_phone = Column(String(50))
    emergency_contact_relationship = Column(String(100))
    
    # Preferences
    theme_preference = Column(String(20), default="dark")
    language_preference = Column(String(10), default="en")
    timezone_preference = Column(String(50), default="UTC")
    notifications_email = Column(Boolean, default=True)
    notifications_sms = Column(Boolean, default=False)
    notifications_push = Column(Boolean, default=True)
    
    # Security
    two_factor_enabled = Column(Boolean, default=False)
    last_password_change = Column(DateTime(timezone=True))

    def __repr__(self):
        return f"<User(id={self.id}, email='{self.email}', role='{self.role}')>"


class Consent(Base):
    """Consent records: patient consent for file/series access by role or principal - supports cross-hospital federation"""
    __tablename__ = "consents"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)  # patient who gave consent
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=True, index=True)  # patient record (if linked)
    subject_id = Column(Integer, nullable=True, index=True)  # file_id or null for scope-based
    scope = Column(String(100), nullable=True)  # e.g. "all", "patient:123", "series:xyz"
    granted_to_role = Column(String(20), nullable=True)  # doctor, admin, or specific user id
    granted_to_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    granted_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    
    # Cross-hospital federation fields
    granted_to_hospital_id = Column(String(100), index=True)  # Grant access to specific hospital
    granted_to_hospital_name = Column(String(255))  # Human-readable hospital name

    def __repr__(self):
        return f"<Consent(id={self.id}, user_id={self.user_id}, patient_id={self.patient_id}, scope='{self.scope}')>"


class FileMetadata(Base):
    """Store metadata about uploaded files"""
    __tablename__ = "file_metadata"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(255), nullable=False, index=True)
    original_filename = Column(String(255), nullable=False)
    file_size = Column(Integer, nullable=False)  # in bytes
    content_type = Column(String(100))
    user_id = Column(String(100), index=True)  # Uploader user ID
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=True, index=True)  # Patient this file belongs to
    bucket_name = Column(String(100), nullable=False)
    object_key = Column(String(500), nullable=False, unique=True)
    checksum = Column(String(64))  # MD5 or SHA256
    upload_timestamp = Column(DateTime(timezone=True), server_default=func.now())
    last_accessed = Column(DateTime(timezone=True))
    is_deleted = Column(Boolean, default=False)
    description = Column(Text)
    
    # DICOM-specific fields (parsed from DICOM metadata)
    dicom_study_id = Column(String(100), index=True)
    dicom_series_id = Column(String(100), index=True)
    dicom_modality = Column(String(50))  # CT, MRI, XR, etc.
    dicom_study_date = Column(Date)
    # Per-instance identifiers — critical for OHIF WADO lookup and slice ordering
    dicom_instance_uid = Column(String(100), index=True)   # SOPInstanceUID
    dicom_instance_number = Column(Integer, nullable=True)  # InstanceNumber (slice order)
    
    def __repr__(self):
        return f"<FileMetadata(id={self.id}, filename='{self.filename}', patient_id={self.patient_id})>"


class UploadLog(Base):
    """Track all upload operations"""
    __tablename__ = "upload_logs"

    id = Column(Integer, primary_key=True, index=True)
    file_id = Column(Integer, index=True)
    filename = Column(String(255), nullable=False)
    user_id = Column(String(100))
    status = Column(String(50), nullable=False)  # success, failed, partial
    minio_node = Column(String(50))  # which node received the upload
    error_message = Column(Text)
    upload_timestamp = Column(DateTime(timezone=True), server_default=func.now())
    upload_duration = Column(Float)  # in seconds
    
    def __repr__(self):
        return f"<UploadLog(id={self.id}, filename='{self.filename}', status='{self.status}')>"


class ReplicationStatus(Base):
    """Track replication status across MinIO nodes"""
    __tablename__ = "replication_status"

    id = Column(Integer, primary_key=True, index=True)
    file_id = Column(Integer, index=True)
    object_key = Column(String(500), nullable=False)
    node_name = Column(String(50), nullable=False)  # minio1, minio2, minio3
    is_replicated = Column(Boolean, default=False)
    replication_timestamp = Column(DateTime(timezone=True))
    verification_timestamp = Column(DateTime(timezone=True))
    is_verified = Column(Boolean, default=False)
    checksum = Column(String(64))
    error_message = Column(Text)
    
    def __repr__(self):
        return f"<ReplicationStatus(file_id={self.file_id}, node='{self.node_name}', replicated={self.is_replicated})>"


class NodeHealth(Base):
    """Monitor MinIO node health status"""
    __tablename__ = "node_health"

    id = Column(Integer, primary_key=True, index=True)
    node_name = Column(String(50), nullable=False, unique=True)
    endpoint = Column(String(100), nullable=False)
    is_healthy = Column(Boolean, default=True)
    last_check = Column(DateTime(timezone=True), server_default=func.now())
    total_files = Column(Integer, default=0)
    total_size = Column(Integer, default=0)  # in bytes
    status_message = Column(String(255))
    
    def __repr__(self):
        return f"<NodeHealth(node='{self.node_name}', healthy={self.is_healthy})>"


class Patient(Base):
    """Patient records for DPA-compliant medical data management"""
    __tablename__ = "patients"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(255), nullable=False, index=True)
    email = Column(String(255), index=True)  # nullable for privacy
    phone = Column(String(50), index=True)  # nullable for privacy
    date_of_birth = Column(Date)
    medical_record_number = Column(String(100), unique=True, index=True)  # MRN
    
    # DPA-compliant identifiers (combinations for patient matching)
    # Use name+phone, name+email, or name+email+phone for identification
    name_phone_hash = Column(String(64), index=True)  # SHA256(name+phone)
    name_email_hash = Column(String(64), index=True)  # SHA256(name+email)
    name_email_phone_hash = Column(String(64), index=True)  # SHA256(name+email+phone)
    
    # Metadata
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # doctor/admin who created
    is_active = Column(Boolean, default=True)
    
    # Additional fields
    address = Column(Text)
    emergency_contact_name = Column(String(255))
    emergency_contact_phone = Column(String(50))
    notes = Column(Text)  # Medical notes, allergies, etc.

    def __repr__(self):
        return f"<Patient(id={self.id}, name='{self.full_name}', mrn='{self.medical_record_number}')>"


class AccessRequest(Base):
    """Access request records for file/patient data access - supports cross-hospital federation"""
    __tablename__ = "access_requests"

    id = Column(Integer, primary_key=True, index=True)
    requester_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=True, index=True)
    file_id = Column(Integer, ForeignKey("file_metadata.id"), nullable=True, index=True)
    scope = Column(String(100))  # 'file', 'patient', 'all'
    reason = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="pending")  # pending, approved, denied, expired
    requested_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True))
    resolved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    expires_at = Column(DateTime(timezone=True))
    
    # Cross-hospital federation fields
    requester_hospital_id = Column(String(100), index=True)  # Requester's hospital
    target_hospital_id = Column(String(100), index=True)  # Target hospital where data resides
    # For cross-hospital requests, we need to identify users by name+email or name+phone
    requester_identifier = Column(String(500))  # "name|email" or "name|phone"

    def __repr__(self):
        return f"<AccessRequest(id={self.id}, requester_id={self.requester_id}, status='{self.status}')>"


class AuditLog(Base):
    """Audit trail for all significant actions in the system"""
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    event_type = Column(String(100), nullable=False, index=True)  # e.g. file.upload, auth.login
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    user_role = Column(String(50))
    action = Column(String(255), nullable=False)
    resource = Column(String(100))  # file, authentication, consent
    resource_id = Column(String(100))
    ip_address = Column(String(45))
    user_agent = Column(String(500))
    status = Column(String(20), default="success")  # success, failure, warning
    severity = Column(String(20), default="low")  # low, medium, high, critical
    details = Column(Text)  # JSON string for additional data

    def __repr__(self):
        return f"<AuditLog(id={self.id}, event_type='{self.event_type}', user_id={self.user_id})>"


class Notification(Base):
    """User notifications for system events"""
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    type = Column(String(50), nullable=False)  # info, success, warning, error, access_request, consent
    read = Column(Boolean, default=False, index=True)
    link = Column(String(500))  # Optional link to related resource
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    read_at = Column(DateTime(timezone=True))

    def __repr__(self):
        return f"<Notification(id={self.id}, user_id={self.user_id}, type='{self.type}', read={self.read})>"


class FederationTransfer(Base):
    """Track cross-hospital file transfers with patient metadata"""
    __tablename__ = "federation_transfers"

    id = Column(Integer, primary_key=True, index=True)
    
    # Transfer identifiers
    transfer_id = Column(String(100), unique=True, nullable=False, index=True)  # UUID for tracking
    direction = Column(String(10), nullable=False)  # 'sent' or 'received'
    
    # Source hospital
    source_hospital_id = Column(String(100), nullable=False, index=True)
    source_hospital_name = Column(String(255))
    
    # Destination hospital
    dest_hospital_id = Column(String(100), nullable=False, index=True)
    dest_hospital_name = Column(String(255))
    
    # File info
    file_id = Column(Integer, ForeignKey("file_metadata.id"), nullable=True)  # Local file_metadata.id
    original_filename = Column(String(255), nullable=False)
    file_size = Column(Integer)
    content_type = Column(String(100))
    checksum = Column(String(64))  # SHA256
    
    # Patient info carried with the transfer
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=True)  # Local patient id
    patient_name = Column(String(255))  # Name sent in transfer
    patient_mrn = Column(String(100))  # MRN sent in transfer
    patient_dob = Column(Date)
    
    # Consent/access
    consent_id = Column(Integer, ForeignKey("consents.id"), nullable=True)
    access_request_id = Column(Integer, ForeignKey("access_requests.id"), nullable=True)
    
    # Status tracking
    status = Column(String(50), nullable=False, default="pending")  # pending, in_progress, completed, failed
    error_message = Column(Text)
    
    # Timestamps
    initiated_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True))
    
    def __repr__(self):
        return f"<FederationTransfer(id={self.id}, transfer_id='{self.transfer_id}', direction='{self.direction}', status='{self.status}')>"

