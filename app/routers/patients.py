"""Patient management API for DPA-compliant medical data storage."""
from datetime import datetime
from typing import Optional, List
import hashlib
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_

from database import get_db
from models import Patient, User, FileMetadata
from routers.auth import get_current_user
from audit import log_audit_event


router = APIRouter(prefix="/api/patients", tags=["patients"])


# ============ Pydantic Models ============

class PatientCreate(BaseModel):
    """Create a new patient record"""
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None  # ISO date string
    medical_record_number: Optional[str] = None
    address: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    notes: Optional[str] = None


class PatientUpdate(BaseModel):
    """Update patient information"""
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    address: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    notes: Optional[str] = None


class PatientResponse(BaseModel):
    """Patient record response"""
    id: int
    full_name: str
    email: Optional[str]
    phone: Optional[str]
    date_of_birth: Optional[str]
    medical_record_number: Optional[str]
    created_at: str
    updated_at: str
    is_active: bool
    file_count: int = 0


class PatientSearchRequest(BaseModel):
    """Search for patient by DPA-compliant identifiers"""
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None


# ============ Helper Functions ============

def compute_identifier_hashes(name: str, email: Optional[str], phone: Optional[str]) -> dict:
    """Compute DPA-compliant identifier hashes for patient matching."""
    hashes = {}
    
    # Normalize inputs
    name_norm = name.strip().lower()
    email_norm = email.strip().lower() if email else None
    phone_norm = phone.strip().replace("-", "").replace(" ", "") if phone else None
    
    # SHA256 hashes for different combinations
    if phone_norm:
        hashes['name_phone_hash'] = hashlib.sha256(f"{name_norm}:{phone_norm}".encode()).hexdigest()
    
    if email_norm:
        hashes['name_email_hash'] = hashlib.sha256(f"{name_norm}:{email_norm}".encode()).hexdigest()
    
    if email_norm and phone_norm:
        hashes['name_email_phone_hash'] = hashlib.sha256(f"{name_norm}:{email_norm}:{phone_norm}".encode()).hexdigest()
    
    return hashes


# ============ API Endpoints ============

@router.post("", response_model=PatientResponse)
def create_patient(
    body: PatientCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new patient record.
    
    Only doctors and admins can create patient records.
    """
    if current_user.role not in ["doctor", "admin"]:
        raise HTTPException(status_code=403, detail="Only doctors and admins can create patient records")
    
    # Compute identifier hashes
    hashes = compute_identifier_hashes(body.full_name, body.email, body.phone)
    
    # Check for existing patient with same identifiers
    existing = None
    if hashes:
        existing = db.query(Patient).filter(
            or_(
                *[getattr(Patient, k) == v for k, v in hashes.items()]
            )
        ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="Patient with these identifiers already exists")
    
    # Create patient record
    patient = Patient(
        full_name=body.full_name,
        email=body.email,
        phone=body.phone,
        date_of_birth=datetime.fromisoformat(body.date_of_birth.replace('Z', '+00:00')).date() if body.date_of_birth else None,
        medical_record_number=body.medical_record_number,
        address=body.address,
        emergency_contact_name=body.emergency_contact_name,
        emergency_contact_phone=body.emergency_contact_phone,
        notes=body.notes,
        created_by_user_id=current_user.id,
        **hashes
    )
    
    db.add(patient)
    db.commit()
    db.refresh(patient)
    
    # Audit log
    log_audit_event(
        db=db,
        event_type="patient.create",
        user_id=current_user.id,
        user_role=current_user.role,
        action=f"Created patient record: {patient.full_name}",
        resource="patient",
        resource_id=str(patient.id),
        status="success"
    )
    
    return PatientResponse(
        id=patient.id,
        full_name=patient.full_name,
        email=patient.email,
        phone=patient.phone,
        date_of_birth=patient.date_of_birth.isoformat() if patient.date_of_birth else None,
        medical_record_number=patient.medical_record_number,
        created_at=patient.created_at.isoformat(),
        updated_at=patient.updated_at.isoformat(),
        is_active=patient.is_active,
        file_count=0
    )


@router.get("", response_model=List[PatientResponse])
def list_patients(
    search: Optional[str] = Query(None, description="Search by name or MRN"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all patients with optional search.
    
    Doctors and admins can see all patients.
    Patients can only see their own record.
    """
    query = db.query(Patient).filter(Patient.is_active == True)
    
    # Role-based filtering
    if current_user.role == "patient":
        # Patients can only see their own record (match by email or phone)
        query = query.filter(
            or_(
                Patient.email == current_user.email,
                Patient.phone == current_user.phone
            )
        )
    
    # Search filter
    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            or_(
                Patient.full_name.ilike(search_pattern),
                Patient.medical_record_number.ilike(search_pattern),
                Patient.email.ilike(search_pattern)
            )
        )
    
    # Pagination
    offset = (page - 1) * page_size
    patients = query.offset(offset).limit(page_size).all()
    
    # Get file counts
    results = []
    for patient in patients:
        file_count = db.query(FileMetadata).filter(
            FileMetadata.patient_id == patient.id,
            FileMetadata.is_deleted == False
        ).count()
        
        results.append(PatientResponse(
            id=patient.id,
            full_name=patient.full_name,
            email=patient.email,
            phone=patient.phone,
            date_of_birth=patient.date_of_birth.isoformat() if patient.date_of_birth else None,
            medical_record_number=patient.medical_record_number,
            created_at=patient.created_at.isoformat(),
            updated_at=patient.updated_at.isoformat(),
            is_active=patient.is_active,
            file_count=file_count
        ))
    
    return results


@router.post("/search", response_model=List[PatientResponse])
def search_patients(
    body: PatientSearchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Search for patients using DPA-compliant identifier combinations.
    
    Supports:
    - name + phone
    - name + email
    - name + email + phone
    """
    if current_user.role not in ["doctor", "admin"]:
        raise HTTPException(status_code=403, detail="Only doctors and admins can search patients")
    
    # Compute search hashes
    hashes = compute_identifier_hashes(body.full_name, body.email, body.phone)
    
    if not hashes:
        raise HTTPException(status_code=400, detail="Must provide at least name+email or name+phone")
    
    # Search by hash matches
    patients = db.query(Patient).filter(
        Patient.is_active == True,
        or_(
            *[getattr(Patient, k) == v for k, v in hashes.items()]
        )
    ).all()
    
    # Get file counts and build response
    results = []
    for patient in patients:
        file_count = db.query(FileMetadata).filter(
            FileMetadata.patient_id == patient.id,
            FileMetadata.is_deleted == False
        ).count()
        
        results.append(PatientResponse(
            id=patient.id,
            full_name=patient.full_name,
            email=patient.email,
            phone=patient.phone,
            date_of_birth=patient.date_of_birth.isoformat() if patient.date_of_birth else None,
            medical_record_number=patient.medical_record_number,
            created_at=patient.created_at.isoformat(),
            updated_at=patient.updated_at.isoformat(),
            is_active=patient.is_active,
            file_count=file_count
        ))
    
    return results


@router.get("/{patient_id}", response_model=PatientResponse)
def get_patient(
    patient_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific patient's details."""
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    # Check access permissions
    if current_user.role == "patient":
        # Patients can only see their own record
        if patient.email != current_user.email and patient.phone != current_user.phone:
            raise HTTPException(status_code=403, detail="Access denied")
    
    file_count = db.query(FileMetadata).filter(
        FileMetadata.patient_id == patient.id,
        FileMetadata.is_deleted == False
    ).count()
    
    return PatientResponse(
        id=patient.id,
        full_name=patient.full_name,
        email=patient.email,
        phone=patient.phone,
        date_of_birth=patient.date_of_birth.isoformat() if patient.date_of_birth else None,
        medical_record_number=patient.medical_record_number,
        created_at=patient.created_at.isoformat(),
        updated_at=patient.updated_at.isoformat(),
        is_active=patient.is_active,
        file_count=file_count
    )


@router.put("/{patient_id}", response_model=PatientResponse)
def update_patient(
    patient_id: int,
    body: PatientUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update patient information."""
    if current_user.role not in ["doctor", "admin"]:
        raise HTTPException(status_code=403, detail="Only doctors and admins can update patient records")
    
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    # Update fields
    if body.full_name is not None:
        patient.full_name = body.full_name
    if body.email is not None:
        patient.email = body.email
    if body.phone is not None:
        patient.phone = body.phone
    if body.date_of_birth is not None:
        patient.date_of_birth = datetime.fromisoformat(body.date_of_birth.replace('Z', '+00:00')).date()
    if body.address is not None:
        patient.address = body.address
    if body.emergency_contact_name is not None:
        patient.emergency_contact_name = body.emergency_contact_name
    if body.emergency_contact_phone is not None:
        patient.emergency_contact_phone = body.emergency_contact_phone
    if body.notes is not None:
        patient.notes = body.notes
    
    # Recompute identifier hashes
    hashes = compute_identifier_hashes(patient.full_name, patient.email, patient.phone)
    for key, value in hashes.items():
        setattr(patient, key, value)
    
    db.commit()
    db.refresh(patient)
    
    # Audit log
    log_audit_event(
        db=db,
        event_type="patient.update",
        user_id=current_user.id,
        user_role=current_user.role,
        action=f"Updated patient record: {patient.full_name}",
        resource="patient",
        resource_id=str(patient.id),
        status="success"
    )
    
    file_count = db.query(FileMetadata).filter(
        FileMetadata.patient_id == patient.id,
        FileMetadata.is_deleted == False
    ).count()
    
    return PatientResponse(
        id=patient.id,
        full_name=patient.full_name,
        email=patient.email,
        phone=patient.phone,
        date_of_birth=patient.date_of_birth.isoformat() if patient.date_of_birth else None,
        medical_record_number=patient.medical_record_number,
        created_at=patient.created_at.isoformat(),
        updated_at=patient.updated_at.isoformat(),
        is_active=patient.is_active,
        file_count=file_count
    )


@router.get("/{patient_id}/files")
def get_patient_files(
    patient_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all files for a specific patient."""
    patient = db.query(Patient).filter(Patient.id == patient_id).first()
    
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    # Check access permissions
    if current_user.role == "patient":
        if patient.email != current_user.email and patient.phone != current_user.phone:
            raise HTTPException(status_code=403, detail="Access denied")
    
    files = db.query(FileMetadata).filter(
        FileMetadata.patient_id == patient_id,
        FileMetadata.is_deleted == False
    ).all()
    
    return {
        "patient_id": patient_id,
        "patient_name": patient.full_name,
        "files": [
            {
                "id": f.id,
                "filename": f.filename,
                "size": f.file_size,
                "content_type": f.content_type,
                "user_id": f.user_id,
                "upload_timestamp": f.upload_timestamp.isoformat(),
                "checksum": f.checksum,
                "description": f.description,
                "dicom_study_id": f.dicom_study_id,
                "dicom_series_id": f.dicom_series_id,
                "dicom_modality": f.dicom_modality,
                "dicom_study_date": f.dicom_study_date.isoformat() if f.dicom_study_date else None,
            }
            for f in files
        ]
    }
