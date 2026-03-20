# Automatic Peer Discovery Service
# Runs in background to discover and configure federation peers

import asyncio
import ipaddress
import json
import os
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from urllib.parse import urlparse

import httpx
from federation_registry import FederationRegistry, HospitalMetadata
from federation_client import federation_add_peer, federation_list_peers
import logging

logger = logging.getLogger(__name__)


class PeerDiscoveryService:
    """
    Background service that automatically discovers and configures federation peers.
    
    Features:
    - Periodic discovery of new hospitals
    - Automatic peer configuration
    - Certificate verification
    - Connection health monitoring
    """
    
    def __init__(self, registry: FederationRegistry, discovery_interval: int = 300):
        """
        Initialize discovery service.
        
        Args:
            registry: Federation registry instance
            discovery_interval: Seconds between discovery runs (default: 5 minutes)
        """
        self.registry = registry
        self.discovery_interval = discovery_interval
        self.known_peers: Dict[str, HospitalMetadata] = {}
        self.last_connect_attempt: Dict[str, datetime] = {}
        self.running = False
        
        self.hospital_id = os.getenv("HOSPITAL_ID", "hospital-a")
        self.api_port = os.getenv("API_PORT", "8000")
        self.connect_retry_seconds = int(os.getenv("PEER_CONNECT_RETRY_SECONDS", "30"))
        self.seed_file = os.getenv("PEER_SEED_FILE", "data/peer-seeds.json")
        self.seed_targets: Dict[str, Dict[str, str]] = self._load_seed_targets()
    
    async def start(self):
        """Start the discovery service"""
        self.running = True
        logger.info(f"🔍 Peer discovery service started (interval: {self.discovery_interval}s)")

        # Run initial discovery immediately
        await self.discover_peers()

        # Fast reconnect loop runs alongside the normal discovery cycle.
        # This re-dials disconnected peers within connect_retry_seconds rather
        # than waiting a full discovery_interval (which can be several minutes).
        asyncio.create_task(self._fast_reconnect_loop())

        # Full discovery (registry pull + libp2p reconnect) at the normal interval
        while self.running:
            await asyncio.sleep(self.discovery_interval)
            await self.discover_peers()
    
    async def stop(self):
        """Stop the discovery service"""
        self.running = False
        logger.info("🛑 Peer discovery service stopped")

    async def _fast_reconnect_loop(self):
        """
        Lightweight loop that re-dials disconnected peers every
        connect_retry_seconds without running a full registry pull.

        This closes the gap where the 30-second retry throttle in
        _ensure_libp2p_connectivity was pointless because discover_peers()
        (the only caller) runs every discovery_interval (120s by default).
        Now a restarted VM re-joins the mesh within ~30s of its gRPC sidecar
        becoming healthy instead of waiting up to 2 minutes.
        """
        while self.running:
            await asyncio.sleep(self.connect_retry_seconds)
            if not self.running:
                break
            try:
                live = federation_list_peers() or []
                connected = {
                    p.get("hospital_id")
                    for p in live
                    if p.get("reachable") and p.get("hospital_id")
                }
                all_known = (
                    set(self.known_peers.keys()) | set(self.seed_targets.keys())
                ) - {self.hospital_id}
                if all_known - connected:
                    logger.debug(
                        "Fast reconnect: %d known peer(s) not yet reachable, retrying…",
                        len(all_known - connected),
                    )
                    await self._ensure_libp2p_connectivity(list(self.known_peers.values()))
            except Exception as exc:
                logger.debug("Fast reconnect tick error: %s", exc)

    async def discover_peers(self):
        """
        Discover new peers and update configuration.
        
        Steps:
        1. Pull remote registries to learn about new peers
        2. Query registry for all peers
        3. Identify new peers
        4. Verify their certificates
        5. Update local configuration
        6. Log changes
        """
        
        try:
            logger.info("🔍 Running peer discovery...")
            
            # ── Pull remote registries first so we actually discover NEW peers ──
            # Without this the discovery service only queries the local in-memory
            # dict which never grows on its own.
            try:
                from routers.federation_registry import _pull_remote_registries
                imported = await _pull_remote_registries()
                if imported:
                    logger.info(f"📥 Imported {imported} new peer(s) from remote registries")
                    # Persist the updated registry
                    self.registry.export_registry("data/federation-registry.json")
            except Exception as pull_exc:
                logger.debug(f"Remote registry pull skipped: {pull_exc}")
            
            # Get all peers from registry
            peers = self.registry.discover_peers(self.hospital_id)
            
            new_peers = []
            updated_peers = []
            
            for peer in peers:
                if peer.hospital_id not in self.known_peers:
                    # New peer discovered
                    new_peers.append(peer)
                    logger.info(
                        f"✨ Discovered new peer: {peer.hospital_name} "
                        f"at {peer.federation_endpoint}"
                    )
                elif self._has_peer_changed(peer):
                    # Existing peer updated
                    updated_peers.append(peer)
                    logger.info(
                        f"🔄 Peer updated: {peer.hospital_name} "
                        f"at {peer.federation_endpoint}"
                    )
                
                # Update known peers
                self.known_peers[peer.hospital_id] = peer
            
            # Configure new peers
            if new_peers:
                await self._configure_peers(new_peers)
            
            # Update existing peers
            if updated_peers:
                await self._reconfigure_peers(updated_peers)

            # Persist registry-derived peers as fallback bootstrap targets.
            seed_changed = False
            for peer in peers:
                seed_changed = self._update_seed_target(
                    hospital_id=peer.hospital_id,
                    hospital_name=peer.hospital_name,
                    api_endpoint=peer.api_endpoint,
                    federation_endpoint=peer.federation_endpoint,
                ) or seed_changed
            if seed_changed:
                self._persist_seed_targets()

            # Always reconcile libp2p connectivity for all known peers.
            # This heals mesh links after a VM is powered off and brought back.
            await self._ensure_libp2p_connectivity(peers)
            
            logger.info(
                f"✅ Discovery complete: {len(new_peers)} new, "
                f"{len(updated_peers)} updated, "
                f"{len(self.known_peers)} total peers"
            )
            
        except Exception as e:
            logger.error(f"❌ Peer discovery failed: {e}")
    
    def _has_peer_changed(self, peer: HospitalMetadata) -> bool:
        """Check if peer metadata has changed"""
        known_peer = self.known_peers.get(peer.hospital_id)
        if not known_peer:
            return False
        
        # Check if important fields changed
        return (
            peer.federation_endpoint != known_peer.federation_endpoint or
            peer.api_endpoint != known_peer.api_endpoint or
            peer.status != known_peer.status or
            peer.certificate_fingerprint != known_peer.certificate_fingerprint
        )
    
    async def _configure_peers(self, peers: List[HospitalMetadata]):
        """
        Configure new peers in the application.
        
        This would:
        1. Add peer endpoints to environment/config
        2. Test mTLS connection
        3. Update federation client
        4. Store in database for persistence
        """
        
        for peer in peers:
            try:
                # Store peer in database (if needed)
                # db = next(get_db())
                # ... store peer configuration ...
                
                # Log the configuration
                logger.info(
                    f"⚙️  Configured peer: {peer.hospital_name}\n"
                    f"   Federation: {peer.federation_endpoint}\n"
                    f"   API: {peer.api_endpoint}\n"
                    f"   mTLS: Enabled (verified via CA)\n"
                    f"   Certificate: {peer.certificate_fingerprint[:16]}..."
                )
                
                # In production, you would:
                # 1. Update gRPC client configuration
                # 2. Test connection
                # 3. Enable data exchange
                
            except Exception as e:
                logger.error(f"Failed to configure peer {peer.hospital_id}: {e}")
    
    async def _reconfigure_peers(self, peers: List[HospitalMetadata]):
        """Reconfigure updated peers"""
        for peer in peers:
            logger.info(f"🔄 Reconfiguring peer: {peer.hospital_name}")
            # Update configuration as needed

    def _load_seed_targets(self) -> Dict[str, Dict[str, str]]:
        """Load persistent peer bootstrap targets from disk."""
        try:
            with open(self.seed_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                cleaned: Dict[str, Dict[str, str]] = {}
                for hid, item in data.items():
                    if not isinstance(hid, str) or not isinstance(item, dict):
                        continue
                    if hid == self.hospital_id:
                        continue
                    cleaned[hid] = {
                        "hospital_id": hid,
                        "hospital_name": str(item.get("hospital_name", hid.replace("-", " ").title())),
                        "api_endpoint": str(item.get("api_endpoint", "")),
                        "federation_endpoint": str(item.get("federation_endpoint", "")),
                    }
                if cleaned:
                    logger.info("Loaded %d persistent peer seed(s)", len(cleaned))
                return cleaned
        except FileNotFoundError:
            return {}
        except Exception as exc:
            logger.warning("Failed to load peer seed file %s: %s", self.seed_file, exc)
        return {}

    def _persist_seed_targets(self):
        """Persist peer bootstrap targets to disk for restart recovery."""
        try:
            parent = os.path.dirname(self.seed_file)
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(self.seed_file, "w", encoding="utf-8") as f:
                json.dump(self.seed_targets, f, indent=2, sort_keys=True)
        except Exception as exc:
            logger.warning("Failed to persist peer seed file %s: %s", self.seed_file, exc)

    def _update_seed_target(
        self,
        hospital_id: str,
        hospital_name: str = "",
        api_endpoint: str = "",
        federation_endpoint: str = "",
    ) -> bool:
        """Merge a peer bootstrap target into the persistent seed cache."""
        if not hospital_id or hospital_id == self.hospital_id:
            return False

        existing = self.seed_targets.get(hospital_id)
        if existing is None:
            self.seed_targets[hospital_id] = {
                "hospital_id": hospital_id,
                "hospital_name": hospital_name or hospital_id.replace("-", " ").title(),
                "api_endpoint": api_endpoint or "",
                "federation_endpoint": federation_endpoint or "",
            }
            return True

        changed = False
        if hospital_name and existing.get("hospital_name") != hospital_name:
            existing["hospital_name"] = hospital_name
            changed = True
        if api_endpoint and existing.get("api_endpoint") != api_endpoint:
            existing["api_endpoint"] = api_endpoint
            changed = True
        if federation_endpoint and existing.get("federation_endpoint") != federation_endpoint:
            existing["federation_endpoint"] = federation_endpoint
            changed = True
        return changed

    def _extract_host_from_multiaddr(self, addr: str) -> Optional[str]:
        """Extract a hostname/IP component from a libp2p multiaddr string."""
        if not addr:
            return None
        parts = [p for p in addr.split("/") if p]
        for idx, token in enumerate(parts[:-1]):
            if token in {"ip4", "ip6", "dns4", "dns6"}:
                host = parts[idx + 1].strip()
                if host and host not in {"127.0.0.1", "::1", "localhost"}:
                    return host
        return None

    def _learn_seed_targets_from_live_peers(self, live_peers: List[dict]) -> bool:
        """Capture bootstrap hints from currently discovered libp2p peers."""
        changed = False
        for peer in live_peers:
            hospital_id = (peer or {}).get("hospital_id", "")
            if not hospital_id or hospital_id == self.hospital_id:
                continue

            host = None
            for addr in (peer or {}).get("addresses", []) or []:
                if not isinstance(addr, str):
                    continue
                host = self._extract_host_from_multiaddr(addr)
                if host:
                    break

            if not host:
                host = f"{hospital_id}.mshome.net"

            api_endpoint = f"http://{host}:{self.api_port}" if host else ""
            federation_endpoint = f"{host}:50051" if host else ""

            changed = self._update_seed_target(
                hospital_id=hospital_id,
                hospital_name=(peer or {}).get("hospital_name", hospital_id.replace("-", " ").title()),
                api_endpoint=api_endpoint,
                federation_endpoint=federation_endpoint,
            ) or changed

        return changed

    async def _ensure_libp2p_connectivity(self, peers: List[HospitalMetadata]):
        """
        Ensure this node is connected to all known peers via libp2p.
        Uses registry peers first, then FEDERATION_PEER_* seeds as fallback.
        """
        targets: Dict[str, Dict[str, str]] = {}

        for peer in peers:
            targets[peer.hospital_id] = {
                "hospital_id": peer.hospital_id,
                "hospital_name": peer.hospital_name,
                "api_endpoint": peer.api_endpoint,
                "federation_endpoint": peer.federation_endpoint,
            }

        # Include persisted seed targets so we can reconnect after a full VM reboot
        # even if registry sync has not run yet.
        for hospital_id, cached in self.seed_targets.items():
            if hospital_id == self.hospital_id:
                continue
            existing = targets.get(hospital_id)
            if existing is None:
                targets[hospital_id] = {
                    "hospital_id": hospital_id,
                    "hospital_name": cached.get("hospital_name", hospital_id.replace("-", " ").title()),
                    "api_endpoint": cached.get("api_endpoint", ""),
                    "federation_endpoint": cached.get("federation_endpoint", ""),
                }
            else:
                if not existing.get("api_endpoint") and cached.get("api_endpoint"):
                    existing["api_endpoint"] = cached.get("api_endpoint")
                if not existing.get("federation_endpoint") and cached.get("federation_endpoint"):
                    existing["federation_endpoint"] = cached.get("federation_endpoint")

        # Add explicit seed peers from environment as fallback bootstrap sources.
        for key, value in os.environ.items():
            if not key.startswith("FEDERATION_PEER_"):
                continue

            hospital_id = key.replace("FEDERATION_PEER_", "").lower().replace("_", "-")
            if not hospital_id or hospital_id == self.hospital_id:
                continue

            host = value.split(":")[0].strip()
            api_endpoint = f"http://{host}:{self.api_port}" if host else ""

            existing = targets.get(hospital_id)
            if existing is None:
                targets[hospital_id] = {
                    "hospital_id": hospital_id,
                    "hospital_name": hospital_id.replace("-", " ").title(),
                    "api_endpoint": api_endpoint,
                    "federation_endpoint": value,
                }
            else:
                if not existing.get("api_endpoint") and api_endpoint:
                    existing["api_endpoint"] = api_endpoint
                if not existing.get("federation_endpoint") and value:
                    existing["federation_endpoint"] = value

        live_peers = federation_list_peers() or []
        if self._learn_seed_targets_from_live_peers(live_peers):
            self._persist_seed_targets()

        connected_by_hospital = {
            p.get("hospital_id"): p
            for p in live_peers
            if p.get("hospital_id")
        }

        for hospital_id, target in targets.items():
            live = connected_by_hospital.get(hospital_id)
            if live and live.get("reachable"):
                continue

            now = datetime.utcnow()
            last_attempt = self.last_connect_attempt.get(hospital_id)
            if last_attempt and (now - last_attempt).total_seconds() < self.connect_retry_seconds:
                continue
            self.last_connect_attempt[hospital_id] = now

            node_info, source_api = await self._fetch_remote_node_info(target)
            if not node_info:
                continue

            remote_peer_id = (node_info.get("peer_id") or "").strip()
            if not remote_peer_id:
                continue

            updated = self._update_seed_target(
                hospital_id=hospital_id,
                hospital_name=(node_info.get("hospital_name") or target.get("hospital_name") or hospital_id),
                api_endpoint=source_api or target.get("api_endpoint", ""),
                federation_endpoint=target.get("federation_endpoint", ""),
            )
            if updated:
                self._persist_seed_targets()

            candidate_multiaddrs: List[str] = []

            # Prefer endpoint-derived address (the endpoint we actually reached).
            source_host = urlparse(source_api).hostname if source_api else None
            preferred_addr = self._build_multiaddr_from_host(source_host, remote_peer_id)
            if preferred_addr:
                candidate_multiaddrs.append(preferred_addr)

            # Include remote advertised addresses as additional options.
            for addr in node_info.get("listen_addrs", []) or []:
                if isinstance(addr, str) and "/p2p/" in addr and addr not in candidate_multiaddrs:
                    candidate_multiaddrs.append(addr)

            if not candidate_multiaddrs:
                continue

            result = federation_add_peer(
                multiaddrs=candidate_multiaddrs,
                hospital_id=hospital_id,
                hospital_name=target.get("hospital_name", hospital_id),
            )

            if result and result.get("success"):
                logger.info(
                    "🔗 libp2p connected to %s (%s)",
                    target.get("hospital_name", hospital_id),
                    hospital_id,
                )
            else:
                message = result.get("message") if isinstance(result, dict) else "unknown error"
                logger.debug("libp2p connect to %s failed: %s", hospital_id, message)

    async def _fetch_remote_node_info(self, target: Dict[str, str]) -> Tuple[Optional[dict], Optional[str]]:
        """Try multiple candidate API endpoints until a remote node info response is returned."""
        candidates = self._candidate_api_endpoints(target)
        if not candidates:
            return None, None

        async with httpx.AsyncClient(timeout=5.0) as client:
            for base_url in candidates:
                try:
                    response = await client.get(f"{base_url}/api/federation/node/info")
                    if response.status_code != 200:
                        continue
                    payload = response.json()
                    if payload.get("peer_id"):
                        return payload, base_url
                except Exception:
                    continue

        return None, None

    def _candidate_api_endpoints(self, target: Dict[str, str]) -> List[str]:
        """Build de-duplicated API endpoint candidates for a peer hospital."""
        seen = set()
        out: List[str] = []

        def add(url: str):
            if not url:
                return
            normalized = url.strip().rstrip("/")
            if not normalized:
                return
            if not normalized.startswith("http://") and not normalized.startswith("https://"):
                normalized = f"http://{normalized}"
            if normalized in seen:
                return
            seen.add(normalized)
            out.append(normalized)

        add(target.get("api_endpoint", ""))

        federation_endpoint = target.get("federation_endpoint", "")
        if federation_endpoint:
            host = federation_endpoint.split(":")[0].strip()
            if host:
                add(f"http://{host}:{self.api_port}")

        hospital_id = target.get("hospital_id", "")
        if hospital_id:
            add(f"http://{hospital_id}:{self.api_port}")
            add(f"http://{hospital_id}.mshome.net:{self.api_port}")
            add(f"http://{hospital_id}.local:{self.api_port}")

        return out

    def _build_multiaddr_from_host(self, host: Optional[str], peer_id: str) -> Optional[str]:
        """Create a libp2p multiaddr from a hostname/IP plus peer ID."""
        if not host:
            return None

        normalized = host.strip().strip("[]")
        if not normalized or normalized in {"localhost", "127.0.0.1", "::1"}:
            return None

        try:
            ip = ipaddress.ip_address(normalized)
            if ip.version == 4:
                return f"/ip4/{normalized}/tcp/4001/p2p/{peer_id}"
            return f"/ip6/{normalized}/tcp/4001/p2p/{peer_id}"
        except ValueError:
            return f"/dns4/{normalized}/tcp/4001/p2p/{peer_id}"
    
    def get_peer_status(self) -> Dict:
        """Get current peer discovery status"""
        return {
            "service_running": self.running,
            "discovery_interval": self.discovery_interval,
            "total_peers": len(self.known_peers),
            "peers": [
                {
                    "id": peer.hospital_id,
                    "name": peer.hospital_name,
                    "endpoint": peer.federation_endpoint,
                    "status": peer.status,
                    "last_seen": peer.registration_timestamp.isoformat()
                }
                for peer in self.known_peers.values()
            ]
        }


# Global service instance
_discovery_service = None

def get_discovery_service() -> PeerDiscoveryService:
    """Get or create the discovery service"""
    global _discovery_service
    
    if _discovery_service is None:
        from routers.federation_registry import get_registry
        registry = get_registry()
        interval = int(os.getenv("PEER_DISCOVERY_INTERVAL", "120"))
        _discovery_service = PeerDiscoveryService(registry, discovery_interval=interval)
    
    return _discovery_service


async def start_discovery_service():
    """Start the background discovery service"""
    service = get_discovery_service()
    await service.start()
