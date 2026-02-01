"""
FastAPI -> Federation gRPC client.
Calls the Go federation service for Health and CheckDuplicate.
Fails gracefully if the service is down or stubs are missing.
"""
import os
from typing import Optional

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
_channel = None
_stub = None


def _get_stub():
    global _channel, _stub
    if not _GRPC_AVAILABLE:
        return None
    if _stub is None:
        try:
            _channel = grpc.insecure_channel(FEDERATION_GRPC_HOST)
            _stub = FederationServiceStub(_channel)
        except Exception:
            return None
    return _stub


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
