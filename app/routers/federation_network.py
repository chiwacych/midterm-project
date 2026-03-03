# Federation Status and Network Management API
# Uses libp2p peer discovery via Go gRPC sidecar as primary source.

from fastapi import APIRouter, HTTPException
from typing import List, Dict, Optional
from datetime import datetime
import os
import httpx
import asyncio
import time

router = APIRouter(prefix="/api/federation", tags=["federation"])


@router.get("/network/status")
async def get_federation_network_status():
    """
    Get comprehensive federation network status.
    Primary: libp2p peers from Go sidecar.
    Fallback: env vars + federation registry + HTTP pings.
    """
    try:
        from federation_client import federation_health, federation_list_peers, federation_get_node_info
        grpc_health = federation_health()

        mtls_enabled = bool(
            os.getenv("TLS_CERT_FILE") and
            os.getenv("TLS_KEY_FILE") and
            os.getenv("TLS_CA_FILE")
        )

        hospital_id = os.getenv("HOSPITAL_ID", "hospital-a")
        hospital_name = os.getenv("HOSPITAL_NAME", "Hospital A")

        # Get node info (libp2p peer ID)
        node_info = federation_get_node_info()

        # ── Primary: libp2p-discovered peers ──
        peers = []
        seen_ids = set()
        libp2p_peers = federation_list_peers()

        if libp2p_peers:
            for p in libp2p_peers:
                hid = p.get("hospital_id", "")
                if not hid or hid == hospital_id:
                    continue
                seen_ids.add(hid)
                peers.append({
                    "id": hid,
                    "name": p.get("hospital_name", hid.replace("-", " ").title()),
                    "peer_id": p.get("peer_id", ""),
                    "addresses": p.get("addresses", []),
                    "status": "reachable" if p.get("reachable") else "connected",
                    "latency_ms": p.get("latency_ms", -1),
                    "mtls_enabled": mtls_enabled,
                    "transport": "libp2p",
                })

        # ── Fallback: env vars + registry + HTTP pings ──
        api_port = os.getenv("API_PORT", "8000")
        if not peers:
            try:
                from routers.federation_registry import get_registry
                registry = get_registry()
                for hid, meta in registry.hospitals.items():
                    if hid == hospital_id or hid in seen_ids:
                        continue
                    seen_ids.add(hid)

                    env_key = f"FEDERATION_PEER_{hid.upper().replace('-', '_')}"
                    env_val = os.getenv(env_key, "")
                    best_api = f"http://{env_val.split(':')[0]}:{api_port}" if env_val else meta.api_endpoint

                    peer_status = "unreachable"
                    peer_latency = -1
                    try:
                        start = time.monotonic()
                        async with httpx.AsyncClient(timeout=5.0) as client:
                            r = await client.get(f"{best_api}/api/federation/registry/list")
                            elapsed = (time.monotonic() - start) * 1000
                            if r.status_code < 300:
                                peer_status = "reachable"
                                peer_latency = round(elapsed, 1)
                    except Exception:
                        pass

                    peers.append({
                        "id": hid,
                        "name": meta.hospital_name,
                        "endpoint": meta.federation_endpoint,
                        "api_endpoint": best_api,
                        "status": peer_status,
                        "latency_ms": peer_latency,
                        "mtls_enabled": mtls_enabled,
                        "transport": "http",
                    })
            except Exception:
                pass

            # Env-var peers
            for key, value in os.environ.items():
                if not key.startswith("FEDERATION_PEER_"):
                    continue
                pid = key.replace("FEDERATION_PEER_", "").lower().replace("_", "-")
                if pid in seen_ids:
                    continue
                host = value.split(":")[0]
                peer_api = f"http://{host}:{api_port}"
                peer_status = "unknown"
                try:
                    start = time.monotonic()
                    async with httpx.AsyncClient(timeout=5.0) as client:
                        r = await client.get(f"{peer_api}/api/federation/registry/list")
                        elapsed = (time.monotonic() - start) * 1000
                        if r.status_code < 300:
                            peer_status = "reachable"
                except Exception:
                    peer_status = "unreachable"
                peers.append({
                    "id": pid,
                    "name": pid.replace("-", " ").title(),
                    "endpoint": value,
                    "api_endpoint": peer_api,
                    "status": peer_status,
                    "latency_ms": -1,
                    "mtls_enabled": mtls_enabled,
                    "transport": "http",
                })

        # ── DB statistics ──
        total_transfers = 0
        completed_transfers = 0
        total_size_bytes = 0
        active_consents = 0
        try:
            from database import get_db
            from models import Consent, FederationTransfer
            db_gen = get_db()
            db = next(db_gen)
            total_transfers = db.query(FederationTransfer).count()
            completed_transfers = db.query(FederationTransfer).filter(
                FederationTransfer.status == "completed"
            ).count()
            from sqlalchemy import func
            size_result = db.query(func.coalesce(func.sum(FederationTransfer.file_size), 0)).filter(
                FederationTransfer.status == "completed"
            ).scalar()
            total_size_bytes = int(size_result or 0)
            active_consents = db.query(Consent).filter(
                Consent.status == "active"
            ).count()
        except Exception:
            pass

        reachable_peers = [p for p in peers if p["status"] in ("reachable", "connected")]
        grpc_ok = grpc_health and grpc_health.get("ok")
        overall_status = "healthy" if (grpc_ok or reachable_peers) else "degraded"

        return {
            "hospital": {
                "id": hospital_id,
                "name": hospital_name,
                "status": overall_status,
            },
            "libp2p": {
                "peer_id": node_info.get("peer_id", "") if node_info else "",
                "listen_addrs": node_info.get("listen_addrs", []) if node_info else [],
            },
            "security": {
                "mtls_enabled": mtls_enabled,
                "encryption": "Noise + TLS 1.3" if mtls_enabled else "Noise (libp2p)",
                "certificate_status": "valid" if mtls_enabled else "noise-encrypted",
            },
            "federation": {
                "grpc_service": "healthy" if grpc_ok else "offline",
                "grpc_message": grpc_health.get("message") if grpc_health else "Service unavailable",
                "peers_count": len(peers),
                "active_connections": len(reachable_peers),
                "transport": "libp2p" if libp2p_peers else "http-legacy",
            },
            "peers": peers,
            "statistics": {
                "active_exchanges": total_transfers,
                "completed_transfers": completed_transfers,
                "total_consents": active_consents,
                "data_shared_gb": round(total_size_bytes / (1024 ** 3), 3),
            },
            "timestamp": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get federation status: {str(e)}")


@router.get("/exchanges/recent")
async def get_recent_exchanges(limit: int = 10):
    """Get recent file exchange activities across the federation."""
    try:
        from database import get_db
        from models import Consent, PatientFile
        from sqlalchemy import desc

        db_gen = get_db()
        db = next(db_gen)

        recent_consents = db.query(Consent).filter(
            Consent.status == "active"
        ).order_by(desc(Consent.created_at)).limit(limit).all()

        exchanges = []
        for consent in recent_consents:
            files = db.query(PatientFile).filter(
                PatientFile.patient_id == consent.patient_id
            ).limit(5).all()

            exchanges.append({
                "id": consent.id,
                "patient_id": consent.patient_id,
                "requester_hospital": consent.requester_hospital or "external",
                "granted_at": consent.created_at.isoformat() if consent.created_at else None,
                "expires_at": consent.expires_at.isoformat() if consent.expires_at else None,
                "files_count": len(files),
                "status": "active",
                "data_types": ["medical_image", "dicom"],
            })

        return {"exchanges": exchanges, "total": len(exchanges)}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get exchanges: {str(e)}")


@router.post("/peers/{peer_id}/test")
async def test_peer_connection(peer_id: str):
    """Test connection to a specific peer hospital via libp2p health check."""
    try:
        from federation_client import federation_peer_health

        # Try libp2p health check (by hospital_id)
        result = federation_peer_health(target_hospital_id=peer_id)
        if result:
            return {
                "peer_id": peer_id,
                "reachable": result.get("reachable", False),
                "latency_ms": result.get("latency_ms", -1),
                "hospital_name": result.get("hospital_name", ""),
                "transport": "libp2p",
                "timestamp": datetime.utcnow().isoformat(),
            }

        # Fallback: HTTP ping
        api_port = os.getenv("API_PORT", "8000")
        env_key = f"FEDERATION_PEER_{peer_id.upper().replace('-', '_')}"
        peer_endpoint = os.getenv(env_key)
        if not peer_endpoint:
            raise HTTPException(status_code=404, detail=f"Peer {peer_id} not configured")

        host = peer_endpoint.split(":")[0]
        peer_api = f"http://{host}:{api_port}"
        reachable = False
        latency = -1
        try:
            start = time.monotonic()
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{peer_api}/api/federation/registry/list")
                elapsed = (time.monotonic() - start) * 1000
                if r.status_code < 300:
                    reachable = True
                    latency = round(elapsed, 1)
        except Exception:
            pass

        return {
            "peer_id": peer_id,
            "endpoint": peer_endpoint,
            "reachable": reachable,
            "latency_ms": latency,
            "transport": "http",
            "timestamp": datetime.utcnow().isoformat(),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Connection test failed: {str(e)}")


# ── Peer management endpoints ──

@router.post("/peers/add")
async def add_peer(
    multiaddrs: List[str],
    hospital_id: str = "",
    hospital_name: str = "",
):
    """Explicitly add a peer to the libp2p network."""
    from federation_client import federation_add_peer
    result = federation_add_peer(multiaddrs, hospital_id, hospital_name)
    if result is None:
        raise HTTPException(status_code=503, detail="gRPC sidecar unavailable")
    return result


@router.get("/node/info")
async def get_node_info():
    """Get this node's libp2p peer ID and listen addresses."""
    from federation_client import federation_get_node_info
    info = federation_get_node_info()
    if info is None:
        raise HTTPException(status_code=503, detail="gRPC sidecar unavailable")
    return info
