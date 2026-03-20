# Federation Registry REST API
# Provides HTTP endpoints for hospital registration and discovery

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime
import json
import os
import asyncio
import httpx
import logging
from federation_registry import (
    FederationRegistry,
    HospitalMetadata,
    create_hospital_metadata
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/federation/registry", tags=["federation-registry"])

# Global registry instance
_registry = None

def get_registry() -> FederationRegistry:
    """Get or initialize the federation registry"""
    global _registry
    if _registry is None:
        ca_cert_path = os.getenv("TLS_CA_FILE", "certs/ca-cert.pem")
        _registry = FederationRegistry(ca_cert_path)
        
        # Try to load existing registry on startup
        registry_file = "data/federation-registry.json"
        if os.path.exists(registry_file):
            try:
                _registry.import_registry(registry_file)
            except Exception as e:
                print(f"Warning: Could not load registry: {e}")
    
    return _registry


class RegistrationRequest(BaseModel):
    """Request to register a hospital in the federation"""
    metadata: HospitalMetadata


class RegistrationResponse(BaseModel):
    """Response from hospital registration"""
    success: bool
    hospital_id: Optional[str] = None
    message: str
    peer_count: int = 0
    peers_discovered: Optional[List[str]] = None


class DiscoveryResponse(BaseModel):
    """Response containing discovered peer hospitals"""
    success: bool
    peers: List[HospitalMetadata]
    total_peers: int


@router.post("/register", response_model=RegistrationResponse)
async def register_hospital(
    request: RegistrationRequest,
    background_tasks: BackgroundTasks,
    registry: FederationRegistry = Depends(get_registry)
):
    """
    Register a new hospital in the federation.
    
    The hospital must provide:
    1. Complete metadata including certificate
    2. Proof of identity (signature with private key)
    3. Valid certificate issued by federation CA
    
    Returns:
        Registration result with discovered peers
    """
    
    # Register the hospital
    result = registry.register_hospital(request.metadata)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    
    # Get list of peer hospital IDs
    peers = registry.discover_peers(request.metadata.hospital_id)
    peer_ids = [peer.hospital_id for peer in peers]
    
    # Save registry in background
    background_tasks.add_task(
        registry.export_registry,
        "data/federation-registry.json"
    )
    
    return RegistrationResponse(
        success=True,
        hospital_id=result["hospital_id"],
        message=result["message"],
        peer_count=len(peers),
        peers_discovered=peer_ids
    )


@router.get("/discover", response_model=DiscoveryResponse)
async def discover_peers(
    hospital_id: str,
    registry: FederationRegistry = Depends(get_registry)
):
    """
    Discover all peer hospitals in the federation.
    
    Args:
        hospital_id: ID of hospital making the request
        
    Returns:
        List of all peer hospitals with complete metadata
    """
    
    peers = registry.discover_peers(hospital_id)
    
    return DiscoveryResponse(
        success=True,
        peers=peers,
        total_peers=len(peers)
    )


@router.get("/hospital/{hospital_id}", response_model=HospitalMetadata)
async def get_hospital_info(
    hospital_id: str,
    registry: FederationRegistry = Depends(get_registry)
):
    """
    Get detailed information about a specific hospital.
    
    Args:
        hospital_id: Hospital identifier
        
    Returns:
        Complete hospital metadata
    """
    
    hospital = registry.get_hospital(hospital_id)
    
    if not hospital:
        raise HTTPException(
            status_code=404,
            detail=f"Hospital '{hospital_id}' not found in registry"
        )
    
    return hospital


@router.get("/list")
async def list_hospitals(
    registry: FederationRegistry = Depends(get_registry)
):
    """
    List all hospitals in the federation (summary view).
    
    Returns:
        List of hospital summaries
    """
    
    hospitals = []
    for hospital_id, metadata in registry.hospitals.items():
        hospitals.append({
            "hospital_id": hospital_id,
            "hospital_name": metadata.hospital_name,
            "federation_endpoint": metadata.federation_endpoint,
            "status": metadata.status,
            "registered_at": metadata.registration_timestamp.isoformat()
        })
    
    return {
        "success": True,
        "total_hospitals": len(hospitals),
        "hospitals": hospitals
    }


@router.post("/self-register")
async def self_register(
    background_tasks: BackgroundTasks,
    registry: FederationRegistry = Depends(get_registry)
):
    """
    Self-register this hospital in the federation.
    Uses local configuration and certificates.
    
    Returns:
        Registration result
    """
    
    # Get configuration from environment
    hospital_id = os.getenv("HOSPITAL_ID", "hospital-a")
    hospital_name = os.getenv("HOSPITAL_NAME", "Hospital A")
    
    # Get HOST_IP (injected by start.sh from the VM's actual IP)
    # Falls back to socket resolution only if HOST_IP not set
    ip_address = os.getenv("HOST_IP", "").strip().strip("\\")
    if not ip_address:
        try:
            import socket
            hostname = socket.gethostname()
            ip_address = socket.gethostbyname(hostname)
        except Exception:
            ip_address = "localhost"
    
    federation_endpoint = f"{ip_address}:50051"
    api_endpoint = f"http://{ip_address}:8000"
    
    cert_path = os.getenv("TLS_CERT_FILE", f"certs/{hospital_id}-cert.pem")
    ca_cert_path = os.getenv("TLS_CA_FILE", "certs/ca-cert.pem")
    key_path = os.getenv("TLS_KEY_FILE", f"certs/{hospital_id}-key.pem")
    
    # Check if files exist
    if not all(os.path.exists(p) for p in [cert_path, ca_cert_path, key_path]):
        raise HTTPException(
            status_code=500,
            detail="Certificate files not found. Ensure mTLS is configured."
        )
    
    try:
        # Create metadata
        metadata = create_hospital_metadata(
            hospital_id=hospital_id,
            hospital_name=hospital_name,
            organization=f"{hospital_name} Medical Center",
            federation_endpoint=federation_endpoint,
            api_endpoint=api_endpoint,
            cert_path=cert_path,
            ca_cert_path=ca_cert_path,
            private_key_path=key_path,
            contact_email=f"admin@{hospital_id}.local"
        )
        
        # Register
        result = registry.register_hospital(metadata)
        
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result["error"])
        
        # Discover peers
        peers = registry.discover_peers(hospital_id)
        
        # Save registry
        background_tasks.add_task(
            registry.export_registry,
            "data/federation-registry.json"
        )
        
        # Announce ourselves to all known peers (best-effort)
        background_tasks.add_task(_announce_to_peers, metadata)
        
        # Pull remote registries to learn about peers (best-effort)
        background_tasks.add_task(_pull_remote_registries)
        
        return {
            "success": True,
            "hospital_id": hospital_id,
            "message": "Self-registration successful",
            "federation_endpoint": federation_endpoint,
            "peer_count": len(peers),
            "peers": [
                {
                    "id": peer.hospital_id,
                    "name": peer.hospital_name,
                    "endpoint": peer.federation_endpoint
                }
                for peer in peers
            ]
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Self-registration failed: {str(e)}"
        )


@router.get("/export")
async def export_registry(
    registry: FederationRegistry = Depends(get_registry)
):
    """
    Export the complete registry (for backup or distribution).
    
    Returns:
        Complete registry data
    """
    
    return {
        "ca_fingerprint": registry.ca_fingerprint,
        "last_updated": datetime.utcnow().isoformat(),
        "total_hospitals": len(registry.hospitals),
        "hospitals": {
            hospital_id: hospital.dict()
            for hospital_id, hospital in registry.hospitals.items()
        }
    }


@router.post("/announce")
async def receive_announcement(
    request: RegistrationRequest,
    background_tasks: BackgroundTasks,
    registry: FederationRegistry = Depends(get_registry)
):
    """
    Receive a registration announcement from a remote hospital.
    This is the server-to-server push endpoint.
    A remote hospital calls this after self-registering to share its metadata.
    """
    metadata = request.metadata
    hospital_id = os.getenv("HOSPITAL_ID", "")
    
    # Don't re-register ourselves
    if metadata.hospital_id == hospital_id:
        return {"success": True, "message": "Skipped — same hospital"}
    
    # Register the remote hospital in our local registry
    result = registry.register_hospital(metadata)
    
    if not result["success"]:
        logger.warning(f"Announcement from {metadata.hospital_id} rejected: {result.get('error')}")
        raise HTTPException(status_code=400, detail=result.get("error", "Registration failed"))
    
    # Persist
    background_tasks.add_task(registry.export_registry, "data/federation-registry.json")
    
    logger.info(
        f"Accepted announcement from {metadata.hospital_name} "
        f"({metadata.hospital_id}) at {metadata.federation_endpoint}"
    )
    
    return {
        "success": True,
        "message": f"Registered {metadata.hospital_id}",
        "total_known": len(registry.hospitals),
    }


# ── Helper: collect all known peer API endpoints ──

def _get_peer_api_endpoints() -> List[str]:
    """
    Gather API base URLs for every known peer.
    Sources (in priority order):
      1. FEDERATION_PEER_* env vars
      2. local registry entries
      3. persisted peer-seeds.json (fallback when registry hasn't synced yet)
    Returns de-duplicated list like ["http://172.29.x.x:8000", ...].
    """
    endpoints: Dict[str, str] = {}  # hospital_id -> api_url
    my_id = os.getenv("HOSPITAL_ID", "")
    api_port = os.getenv("API_PORT", "8000")

    # 1) From env vars  (FEDERATION_PEER_HOSPITAL_B=hospital-b.local:50051)
    for key, value in os.environ.items():
        if key.startswith("FEDERATION_PEER_"):
            host = value.split(":")[0]
            peer_id = key.replace("FEDERATION_PEER_", "").lower().replace("_", "-")
            if peer_id != my_id:
                endpoints[peer_id] = f"http://{host}:{api_port}"

    # 2) From local registry (may already have metadata with api_endpoint)
    try:
        registry = get_registry()
        for hid, meta in registry.hospitals.items():
            if hid != my_id and hid not in endpoints:
                endpoints[hid] = meta.api_endpoint
    except Exception:
        pass

    # 3) From persisted seed file — ensures announce/pull work even when the
    #    registry is empty on a first-run or after a clean restart where the
    #    registry JSON hasn't been written yet.
    try:
        seed_file = os.getenv("PEER_SEED_FILE", "data/peer-seeds.json")
        with open(seed_file, "r", encoding="utf-8") as f:
            seeds = json.load(f)
        if isinstance(seeds, dict):
            for hid, item in seeds.items():
                if hid == my_id or hid in endpoints:
                    continue
                api_ep = (item.get("api_endpoint") or "").strip()
                if api_ep:
                    endpoints[hid] = api_ep
    except Exception:
        pass

    return list(endpoints.values())


async def _announce_to_peers(metadata: HospitalMetadata):
    """
    Push our registration to every known peer's /announce endpoint.
    Best-effort: failures are logged but not fatal.
    """
    endpoints = _get_peer_api_endpoints()
    if not endpoints:
        logger.info("No peer endpoints known — skipping announcement")
        return
    
    payload = {"metadata": metadata.dict()}
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        for url in endpoints:
            target = f"{url.rstrip('/')}/api/federation/registry/announce"
            try:
                resp = await client.post(target, json=_serialize_payload(payload))
                if resp.status_code < 300:
                    logger.info(f"Announced to {url} — accepted")
                else:
                    logger.warning(f"Announce to {url} returned {resp.status_code}: {resp.text[:200]}")
            except Exception as e:
                logger.warning(f"Announce to {url} failed: {e}")


async def _pull_remote_registries():
    """
    Pull registry data from every known peer and merge into our local registry.
    """
    endpoints = _get_peer_api_endpoints()
    if not endpoints:
        return 0
    
    registry = get_registry()
    my_id = os.getenv("HOSPITAL_ID", "")
    imported = 0
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        for url in endpoints:
            target = f"{url.rstrip('/')}/api/federation/registry/export"
            try:
                resp = await client.get(target)
                if resp.status_code != 200:
                    continue
                data = resp.json()
                for hid, h_data in data.get("hospitals", {}).items():
                    if hid == my_id:
                        continue
                    try:
                        meta = HospitalMetadata(**_deserialize_hospital(h_data))
                        existing = registry.hospitals.get(hid)
                        # Import NEW peers, or UPDATE existing ones whose
                        # endpoint changed (VM IP may have changed on restart)
                        if (existing is None
                                or existing.api_endpoint != meta.api_endpoint
                                or existing.federation_endpoint != meta.federation_endpoint):
                            result = registry.register_hospital(meta)
                            if result.get("success"):
                                imported += 1
                                action = "Updated" if existing else "Imported"
                                logger.info(f"{action} {hid} from {url}")
                    except Exception as exc:
                        logger.debug(f"Could not import {hid}: {exc}")
            except Exception as e:
                logger.warning(f"Pull from {url} failed: {e}")
    
    if imported:
        registry.export_registry("data/federation-registry.json")
    
    return imported


def _serialize_payload(payload: dict) -> dict:
    """Recursively convert datetime objects to ISO strings for JSON."""
    import json
    return json.loads(json.dumps(payload, default=str))


def _deserialize_hospital(data: dict) -> dict:
    """Ensure datetime fields are parsed correctly from remote JSON."""
    dt_fields = [
        "certificate_not_before", "certificate_not_after",
        "registration_timestamp",
    ]
    for f in dt_fields:
        if f in data and isinstance(data[f], str):
            # Handle ISO format with or without trailing Z
            s = data[f].rstrip("Z")
            # Remove fractional seconds beyond 6 digits if present
            if "." in s:
                parts = s.split(".")
                s = parts[0] + "." + parts[1][:6]
            data[f] = datetime.fromisoformat(s)
    return data


@router.post("/discover-now")
async def trigger_peer_discovery(
    background_tasks: BackgroundTasks,
    registry: FederationRegistry = Depends(get_registry)
):
    """
    Manually trigger peer discovery immediately.
    Pulls remote registries and updates the local peer discovery service.
    """
    
    try:
        my_id = os.getenv("HOSPITAL_ID", "")
        known_before = len(registry.hospitals)
        
        # Pull registries from all known peers
        imported = await _pull_remote_registries()
        
        # Also update the in-memory peer discovery service
        try:
            from peer_discovery import get_discovery_service
            service = get_discovery_service()
            await service.discover_peers()
        except Exception:
            pass
        
        known_after = len(registry.hospitals)
        
        # Persist
        if imported > 0:
            background_tasks.add_task(
                registry.export_registry, "data/federation-registry.json"
            )
        
        # Build peer list (exclude self)
        peers_list = [
            {
                "id": hid,
                "name": meta.hospital_name,
                "endpoint": meta.federation_endpoint,
                "api": meta.api_endpoint,
                "status": meta.status,
            }
            for hid, meta in registry.hospitals.items()
            if hid != my_id
        ]
        
        return {
            "success": True,
            "message": f"Discovery complete — imported {imported} new peer(s)",
            "peers_before": known_before,
            "peers_after": known_after,
            "new_peers_discovered": imported,
            "total_peers": len(peers_list),
            "peers": peers_list,
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Peer discovery failed: {str(e)}"
        )
