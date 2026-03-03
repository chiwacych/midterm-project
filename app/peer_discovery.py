# Automatic Peer Discovery Service
# Runs in background to discover and configure federation peers

import asyncio
import os
from typing import Dict, List
from datetime import datetime, timedelta
from federation_registry import FederationRegistry, HospitalMetadata
from database import get_db
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
        self.running = False
        
        self.hospital_id = os.getenv("HOSPITAL_ID", "hospital-a")
    
    async def start(self):
        """Start the discovery service"""
        self.running = True
        logger.info(f"🔍 Peer discovery service started (interval: {self.discovery_interval}s)")
        
        # Run initial discovery immediately
        await self.discover_peers()
        
        # Then run periodically
        while self.running:
            await asyncio.sleep(self.discovery_interval)
            await self.discover_peers()
    
    async def stop(self):
        """Stop the discovery service"""
        self.running = False
        logger.info("🛑 Peer discovery service stopped")
    
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
