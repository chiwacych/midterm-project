"""
FastAPI -> Federation gRPC client.
Calls the Go federation service for Health, CheckDuplicate, and libp2p operations.
Fails gracefully if the service is down or stubs are missing.
"""
import os
from typing import Optional, List

try:
    import grpc
    from proto import federation_pb2 as fp  # noqa: F401
    from proto.federation_pb2_grpc import FederationServiceStub
    _GRPC_AVAILABLE = True
except (ImportError, AttributeError):
    _GRPC_AVAILABLE = False
    grpc = None
    fp = None
    FederationServiceStub = None

FEDERATION_GRPC_HOST = os.getenv("FEDERATION_GRPC_HOST", "localhost:50051")
TLS_CERT_FILE = os.getenv("TLS_CERT_FILE", "")
TLS_KEY_FILE = os.getenv("TLS_KEY_FILE", "")
TLS_CA_FILE = os.getenv("TLS_CA_FILE", "")
HOSPITAL_ID = os.getenv("HOSPITAL_ID", "hospital-a")
_channel = None
_stub = None


def _get_stub():
    global _channel, _stub
    if not _GRPC_AVAILABLE:
        return None
    if _stub is None:
        try:
            if TLS_CERT_FILE and TLS_KEY_FILE and TLS_CA_FILE:
                # Use mTLS when certificates are available
                with open(TLS_CA_FILE, "rb") as f:
                    ca_cert = f.read()
                with open(TLS_CERT_FILE, "rb") as f:
                    client_cert = f.read()
                with open(TLS_KEY_FILE, "rb") as f:
                    client_key = f.read()
                creds = grpc.ssl_channel_credentials(
                    root_certificates=ca_cert,
                    private_key=client_key,
                    certificate_chain=client_cert,
                )
                # Override target name to match cert CN (e.g. hospital-a.local)
                # because Docker service hostname 'federation' won't match the cert
                ssl_target = f"{HOSPITAL_ID}.local"
                opts = [("grpc.ssl_target_name_override", ssl_target)]
                _channel = grpc.secure_channel(FEDERATION_GRPC_HOST, creds, options=opts)
            else:
                _channel = grpc.insecure_channel(FEDERATION_GRPC_HOST)
            _stub = FederationServiceStub(_channel)
        except Exception:
            return None
    return _stub


# ── Existing RPCs ──

def federation_health() -> Optional[dict]:
    """Call FederationService.Health. Returns None if gRPC unavailable or error."""
    stub = _get_stub()
    if stub is None or fp is None:
        return None
    try:
        req = fp.HealthRequest()
        resp = stub.Health(req, timeout=5)
        return {
            "ok": resp.ok,
            "message": resp.message,
            "minio_nodes": getattr(resp, "minio_nodes", {}),
        }
    except Exception:
        return None


def federation_check_duplicate(sha256_hex: str, bucket: str = "dfs-files", prefix: str = "") -> Optional[dict]:
    """
    Call FederationService.CheckDuplicate.
    Returns None if gRPC unavailable; otherwise {"exists": bool, "object_key": str}.
    """
    stub = _get_stub()
    if stub is None or fp is None:
        return None
    try:
        req = fp.CheckDuplicateRequest(sha256_hex=sha256_hex, bucket=bucket, prefix=prefix)
        resp = stub.CheckDuplicate(req, timeout=5)
        return {"exists": resp.exists, "object_key": getattr(resp, "object_key", "") or ""}
    except Exception:
        return None


# ── libp2p RPCs ──

def federation_get_node_info() -> Optional[dict]:
    """Get this Go sidecar's libp2p peer ID and listen addresses."""
    stub = _get_stub()
    if stub is None or fp is None:
        return None
    try:
        resp = stub.GetNodeInfo(fp.GetNodeInfoRequest(), timeout=5)
        return {
            "peer_id": resp.peer_id,
            "hospital_id": resp.hospital_id,
            "hospital_name": resp.hospital_name,
            "listen_addrs": list(resp.listen_addrs),
        }
    except Exception:
        return None


def federation_list_peers() -> Optional[List[dict]]:
    """List all peers discovered via mDNS or explicit bootstrap."""
    stub = _get_stub()
    if stub is None or fp is None:
        return None
    try:
        resp = stub.ListPeers(fp.ListPeersRequest(), timeout=10)
        return [
            {
                "peer_id": p.peer_id,
                "hospital_id": p.hospital_id,
                "hospital_name": p.hospital_name,
                "addresses": list(p.addresses),
                "reachable": p.reachable,
                "latency_ms": p.latency_ms,
            }
            for p in resp.peers
        ]
    except Exception:
        return None


def federation_add_peer(multiaddrs: List[str], hospital_id: str = "", hospital_name: str = "") -> Optional[dict]:
    """Tell the Go sidecar to connect to a remote peer via libp2p."""
    stub = _get_stub()
    if stub is None or fp is None:
        return None
    try:
        req = fp.AddPeerRequest(
            multiaddrs=multiaddrs,
            hospital_id=hospital_id,
            hospital_name=hospital_name,
        )
        resp = stub.AddPeer(req, timeout=20)
        return {
            "success": resp.success,
            "peer_id": resp.peer_id,
            "message": resp.message,
        }
    except Exception as e:
        return {"success": False, "peer_id": "", "message": str(e)}


def federation_transfer_file(
    target_peer_id: str = "",
    target_hospital_id: str = "",
    bucket: str = "dfs-files",
    object_key: str = "",
    original_filename: str = "",
    content_type: str = "",
    checksum: str = "",
    patient_name: str = "",
    patient_mrn: str = "",
    patient_dob: str = "",
    reason: str = "",
    source_hospital_id: str = "",
    source_hospital_name: str = "",
    transfer_id: str = "",
) -> Optional[dict]:
    """Transfer a file to a remote hospital via the Go sidecar's libp2p stream."""
    stub = _get_stub()
    if stub is None or fp is None:
        return None
    try:
        req = fp.TransferFileRequest(
            target_peer_id=target_peer_id,
            target_hospital_id=target_hospital_id,
            bucket=bucket,
            object_key=object_key,
            original_filename=original_filename,
            content_type=content_type,
            checksum=checksum,
            patient_name=patient_name,
            patient_mrn=patient_mrn,
            patient_dob=patient_dob,
            reason=reason,
            source_hospital_id=source_hospital_id,
            source_hospital_name=source_hospital_name,
            transfer_id=transfer_id,
        )
        resp = stub.TransferFile(req, timeout=120)
        return {
            "success": resp.success,
            "message": resp.message,
            "transfer_id": resp.transfer_id,
            "receiving_hospital_name": resp.receiving_hospital_name,
        }
    except Exception as e:
        return {"success": False, "message": str(e), "transfer_id": transfer_id, "receiving_hospital_name": ""}


def federation_peer_health(target_peer_id: str = "", target_hospital_id: str = "") -> Optional[dict]:
    """Check health of a specific peer via libp2p."""
    stub = _get_stub()
    if stub is None or fp is None:
        return None
    try:
        req = fp.PeerHealthRequest(
            target_peer_id=target_peer_id,
            target_hospital_id=target_hospital_id,
        )
        resp = stub.PeerHealth(req, timeout=10)
        return {
            "reachable": resp.reachable,
            "latency_ms": resp.latency_ms,
            "hospital_id": resp.hospital_id,
            "hospital_name": resp.hospital_name,
        }
    except Exception:
        return None
