# Federation Registry and Discovery System
# Solves the initial trust and discovery problem in mTLS federation

"""
Hospital Discovery and Trust Establishment Protocol

Problem:
- New hospitals need to discover existing hospitals
- Existing hospitals need to trust new hospitals
- Initial mTLS handshake requires knowing endpoints and trusting certificates

Solution:
- Federation Registry Service (central or distributed)
- Hospital Metadata with cryptographic proof
- Automatic peer discovery
- Certificate verification workflow

Components:
1. Hospital Metadata Schema
2. Registration API with proof-of-identity
3. Discovery API for finding peers
4. Trust verification workflow
5. Automatic peer configuration
"""

from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict
from datetime import datetime
from cryptography import x509
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
import hashlib
import json
import os
import base64


class HospitalCapabilities(BaseModel):
    """Services and capabilities offered by the hospital"""
    file_sharing: bool = True
    patient_records: bool = True
    dicom_imaging: bool = True
    real_time_updates: bool = False
    max_file_size_mb: int = 500
    supported_formats: List[str] = ["DICOM", "NIFTI", "JPEG", "PNG"]


class HospitalMetadata(BaseModel):
    """
    Complete metadata published by a hospital for federation discovery.
    This is what new hospitals publish and existing hospitals consume.
    """
    
    # Core Identity
    hospital_id: str = Field(..., description="Unique identifier (e.g., hospital-a)")
    hospital_name: str = Field(..., description="Human-readable name")
    organization: str = Field(..., description="Legal organization name")
    
    # Network Information
    federation_endpoint: str = Field(..., description="gRPC endpoint (IP:port or DNS:port)")
    api_endpoint: str = Field(..., description="REST API endpoint (http://host:port)")
    
    # Certificate Information
    certificate_pem: str = Field(..., description="Base64-encoded public certificate")
    certificate_fingerprint: str = Field(..., description="SHA-256 fingerprint of certificate")
    ca_fingerprint: str = Field(..., description="SHA-256 fingerprint of CA certificate")
    certificate_not_before: datetime = Field(..., description="Certificate validity start")
    certificate_not_after: datetime = Field(..., description="Certificate validity end")
    
    # Capabilities
    capabilities: HospitalCapabilities = Field(default_factory=HospitalCapabilities)
    
    # Geographic and Contact
    country: str = Field(default="US")
    region: Optional[str] = None
    contact_email: str = Field(..., description="Technical contact email")
    
    # Trust and Verification
    registration_timestamp: datetime = Field(default_factory=datetime.utcnow)
    proof_of_identity: str = Field(..., description="Signature proving ownership of private key")
    
    # Metadata
    version: str = "1.0"
    status: str = "active"  # active, inactive, maintenance
    
    @validator('certificate_fingerprint', 'ca_fingerprint')
    def validate_fingerprint(cls, v):
        """Ensure fingerprints are valid SHA-256 hashes"""
        if len(v) != 64:  # SHA-256 produces 64 hex characters
            raise ValueError("Fingerprint must be a SHA-256 hash (64 hex characters)")
        return v.lower()
    
    def to_json(self) -> str:
        """Serialize to JSON"""
        return self.json(indent=2)
    
    @classmethod
    def from_json(cls, json_str: str) -> 'HospitalMetadata':
        """Deserialize from JSON"""
        return cls.parse_raw(json_str)


class FederationRegistry:
    """
    Registry service for hospital discovery and trust establishment.
    Can be run as:
    1. Centralized service (single registry server)
    2. Distributed (blockchain or gossip protocol)
    3. File-based (shared via secure channel)
    """
    
    def __init__(self, ca_cert_path: str):
        """
        Initialize registry with CA certificate for verification.
        
        Args:
            ca_cert_path: Path to CA certificate PEM file
        """
        self.hospitals: Dict[str, HospitalMetadata] = {}
        self.ca_cert_path = ca_cert_path
        
        # Load CA certificate
        with open(ca_cert_path, 'rb') as f:
            self.ca_cert = x509.load_pem_x509_certificate(f.read(), default_backend())
        
        self.ca_fingerprint = self._calculate_fingerprint(self.ca_cert)
    
    def _calculate_fingerprint(self, cert: x509.Certificate) -> str:
        """Calculate SHA-256 fingerprint of certificate"""
        return hashlib.sha256(
            cert.public_bytes(serialization.Encoding.DER)
        ).hexdigest()
    
    def _verify_proof_of_identity(self, metadata: HospitalMetadata) -> bool:
        """
        Verify that the hospital owns the private key for their certificate.
        They prove this by signing a challenge with their private key.
        """
        try:
            # Decode certificate
            cert_bytes = base64.b64decode(metadata.certificate_pem)
            cert = x509.load_pem_x509_certificate(cert_bytes, default_backend())
            
            # Verify certificate fingerprint matches
            actual_fingerprint = self._calculate_fingerprint(cert)
            if actual_fingerprint != metadata.certificate_fingerprint:
                return False
            
            # Verify certificate was issued by our CA
            try:
                # Check if certificate chain is valid (simplified)
                issuer = cert.issuer
                ca_subject = self.ca_cert.subject
                # In production, do full chain verification
                if issuer != ca_subject:
                    return False
            except Exception:
                return False
            
            # Verify proof of identity signature
            # The proof is: Sign(SHA256(hospital_id + federation_endpoint + timestamp))
            proof_bytes = base64.b64decode(metadata.proof_of_identity)
            
            # Create the message that was signed
            message = f"{metadata.hospital_id}{metadata.federation_endpoint}{metadata.registration_timestamp.isoformat()}"
            message_bytes = message.encode('utf-8')
            message_hash = hashlib.sha256(message_bytes).digest()
            
            # Verify signature using certificate's public key
            public_key = cert.public_key()
            public_key.verify(
                proof_bytes,
                message_hash,
                padding.PKCS1v15(),
                hashes.SHA256()
            )
            
            return True
            
        except Exception as e:
            print(f"Proof verification failed: {e}")
            return False
    
    def register_hospital(self, metadata: HospitalMetadata) -> Dict[str, any]:
        """
        Register a new hospital in the federation.
        
        Steps:
        1. Verify certificate was issued by trusted CA
        2. Verify proof of identity (they own the private key)
        3. Check certificate is currently valid
        4. Add to registry
        
        Returns:
            dict: Registration result with status and message
        """
        
        # Verify CA fingerprint matches
        if metadata.ca_fingerprint != self.ca_fingerprint:
            return {
                "success": False,
                "error": "CA fingerprint mismatch - not part of this federation"
            }
        
        # Verify certificate validity period
        now = datetime.utcnow()
        if now < metadata.certificate_not_before or now > metadata.certificate_not_after:
            return {
                "success": False,
                "error": "Certificate is not currently valid"
            }
        
        # Verify proof of identity
        if not self._verify_proof_of_identity(metadata):
            return {
                "success": False,
                "error": "Proof of identity verification failed"
            }
        
        # Register the hospital
        self.hospitals[metadata.hospital_id] = metadata
        
        return {
            "success": True,
            "hospital_id": metadata.hospital_id,
            "message": "Hospital registered successfully",
            "peer_count": len(self.hospitals) - 1  # Exclude self
        }
    
    def discover_peers(self, requesting_hospital_id: str) -> List[HospitalMetadata]:
        """
        Discover all other hospitals in the federation.
        
        Args:
            requesting_hospital_id: ID of hospital making the request
            
        Returns:
            List of hospital metadata for all peers (excluding requester)
        """
        return [
            hospital 
            for hospital_id, hospital in self.hospitals.items()
            if hospital_id != requesting_hospital_id and hospital.status == "active"
        ]
    
    def get_hospital(self, hospital_id: str) -> Optional[HospitalMetadata]:
        """Get metadata for a specific hospital"""
        return self.hospitals.get(hospital_id)
    
    def export_registry(self, file_path: str):
        """Export registry to JSON file for distribution"""
        os.makedirs(os.path.dirname(file_path) or ".", exist_ok=True)
        registry_data = {
            "ca_fingerprint": self.ca_fingerprint,
            "last_updated": datetime.utcnow().isoformat(),
            "hospitals": {
                hospital_id: hospital.dict()
                for hospital_id, hospital in self.hospitals.items()
            }
        }
        
        with open(file_path, 'w') as f:
            json.dump(registry_data, f, indent=2, default=str)
    
    def import_registry(self, file_path: str):
        """Import registry from JSON file"""
        with open(file_path, 'r') as f:
            registry_data = json.load(f)
        
        # Verify CA fingerprint matches
        if registry_data['ca_fingerprint'] != self.ca_fingerprint:
            raise ValueError("Registry CA fingerprint doesn't match local CA")
        
        # Import hospitals
        for hospital_id, hospital_data in registry_data['hospitals'].items():
            metadata = HospitalMetadata(**hospital_data)
            self.hospitals[hospital_id] = metadata


# Helper functions for hospitals to generate metadata

def generate_proof_of_identity(
    hospital_id: str,
    federation_endpoint: str,
    timestamp: datetime,
    private_key_path: str
) -> str:
    """
    Generate proof of identity by signing hospital info with private key.
    
    Args:
        hospital_id: Hospital identifier
        federation_endpoint: gRPC endpoint
        timestamp: Registration timestamp
        private_key_path: Path to private key PEM file
        
    Returns:
        Base64-encoded signature
    """
    from cryptography.hazmat.primitives.asymmetric import rsa
    
    # Load private key
    with open(private_key_path, 'rb') as f:
        private_key = serialization.load_pem_private_key(
            f.read(),
            password=None,
            backend=default_backend()
        )
    
    # Create message to sign
    message = f"{hospital_id}{federation_endpoint}{timestamp.isoformat()}"
    message_bytes = message.encode('utf-8')
    message_hash = hashlib.sha256(message_bytes).digest()
    
    # Sign with private key
    signature = private_key.sign(
        message_hash,
        padding.PKCS1v15(),
        hashes.SHA256()
    )
    
    return base64.b64encode(signature).decode('utf-8')


def create_hospital_metadata(
    hospital_id: str,
    hospital_name: str,
    organization: str,
    federation_endpoint: str,
    api_endpoint: str,
    cert_path: str,
    ca_cert_path: str,
    private_key_path: str,
    contact_email: str
) -> HospitalMetadata:
    """
    Create complete hospital metadata for registration.
    
    Args:
        hospital_id: Unique hospital identifier
        hospital_name: Human-readable name
        organization: Legal organization name
        federation_endpoint: gRPC endpoint (e.g., "192.168.1.10:50051")
        api_endpoint: REST API endpoint (e.g., "http://192.168.1.10")
        cert_path: Path to hospital certificate PEM
        ca_cert_path: Path to CA certificate PEM
        private_key_path: Path to hospital private key PEM
        contact_email: Technical contact email
        
    Returns:
        HospitalMetadata ready for registration
    """
    
    # Load certificates
    with open(cert_path, 'rb') as f:
        cert_bytes = f.read()
        cert = x509.load_pem_x509_certificate(cert_bytes, default_backend())
    
    with open(ca_cert_path, 'rb') as f:
        ca_cert_bytes = f.read()
        ca_cert = x509.load_pem_x509_certificate(ca_cert_bytes, default_backend())
    
    # Calculate fingerprints
    cert_fingerprint = hashlib.sha256(
        cert.public_bytes(serialization.Encoding.DER)
    ).hexdigest()
    
    ca_fingerprint = hashlib.sha256(
        ca_cert.public_bytes(serialization.Encoding.DER)
    ).hexdigest()
    
    # Get certificate validity
    not_before = cert.not_valid_before
    not_after = cert.not_valid_after
    
    # Generate timestamp
    timestamp = datetime.utcnow()
    
    # Generate proof of identity
    proof = generate_proof_of_identity(
        hospital_id,
        federation_endpoint,
        timestamp,
        private_key_path
    )
    
    # Create metadata
    return HospitalMetadata(
        hospital_id=hospital_id,
        hospital_name=hospital_name,
        organization=organization,
        federation_endpoint=federation_endpoint,
        api_endpoint=api_endpoint,
        certificate_pem=base64.b64encode(cert_bytes).decode('utf-8'),
        certificate_fingerprint=cert_fingerprint,
        ca_fingerprint=ca_fingerprint,
        certificate_not_before=not_before,
        certificate_not_after=not_after,
        registration_timestamp=timestamp,
        proof_of_identity=proof,
        contact_email=contact_email
    )


# Example usage
if __name__ == "__main__":
    
    # Initialize registry with CA certificate
    registry = FederationRegistry("certs/ca-cert.pem")
    
    # Hospital A generates metadata
    hospital_a_metadata = create_hospital_metadata(
        hospital_id="hospital-a",
        hospital_name="Hospital A",
        organization="Hospital A Medical Center",
        federation_endpoint="192.168.1.10:50051",
        api_endpoint="http://192.168.1.10",
        cert_path="certs/hospital-a-cert.pem",
        ca_cert_path="certs/ca-cert.pem",
        private_key_path="certs/hospital-a-key.pem",
        contact_email="tech@hospital-a.org"
    )
    
    # Register Hospital A
    result = registry.register_hospital(hospital_a_metadata)
    print(f"Hospital A registration: {result}")
    
    # Hospital B joins and discovers peers
    hospital_b_metadata = create_hospital_metadata(
        hospital_id="hospital-b",
        hospital_name="Hospital B",
        organization="Hospital B Medical Center",
        federation_endpoint="192.168.1.11:50051",
        api_endpoint="http://192.168.1.11",
        cert_path="certs/hospital-b-cert.pem",
        ca_cert_path="certs/ca-cert.pem",
        private_key_path="certs/hospital-b-key.pem",
        contact_email="tech@hospital-b.org"
    )
    
    result = registry.register_hospital(hospital_b_metadata)
    print(f"Hospital B registration: {result}")
    
    # Hospital B discovers peers
    peers = registry.discover_peers("hospital-b")
    print(f"\nHospital B discovered {len(peers)} peer(s):")
    for peer in peers:
        print(f"  - {peer.hospital_name} at {peer.federation_endpoint}")
    
    # Export registry for distribution
    registry.export_registry("federation-registry.json")
    print("\nRegistry exported to federation-registry.json")
