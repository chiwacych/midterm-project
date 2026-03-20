// Package p2p provides a libp2p-based peer-to-peer networking layer
// for cross-hospital federation. It handles peer discovery (mDNS + explicit
// bootstrap), identity exchange, file transfers, and health checks.
package p2p

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/discovery/mdns"
	ma "github.com/multiformats/go-multiaddr"
)

// Protocol IDs for custom libp2p stream protocols.
const (
	MdnsServiceTag       = "medimage-federation"
	ProtocolTransfer     = "/medimage/transfer/1.0.0"
	ProtocolHealth       = "/medimage/health/1.0.0"
	ProtocolIdentify     = "/medimage/identify/1.0.0"
	ProtocolPeerExchange = "/medimage/peerexchange/1.0.0"
)

// PeerMeta holds metadata about a discovered peer.
type PeerMeta struct {
	PeerID       peer.ID
	HospitalID   string
	HospitalName string
	Addresses    []ma.Multiaddr
	LastSeen     time.Time
	Latency      time.Duration
}

// TransferHandler is called when a remote peer sends us a file via libp2p.
// It is set by the server package to store the file in MinIO and create
// DB records via the local FastAPI.
type TransferHandler func(header TransferHeader, fileData []byte) (*TransferResult, error)

// Node wraps a libp2p host with mDNS discovery and peer tracking.
type Node struct {
	Host         host.Host
	HospitalID   string
	HospitalName string
	ExternalIP   string // host-level IP reachable from other VMs
	ctx          context.Context

	// OnTransferReceived is the callback for incoming file transfers.
	OnTransferReceived TransferHandler

	mu     sync.RWMutex
	peers  map[peer.ID]*PeerMeta
	cancel context.CancelFunc
}

// NewNode creates and starts a libp2p node with mDNS discovery.
// The identity key is persisted to dataDir/p2p-identity.key so the
// peer ID is stable across restarts.
func NewNode(hospitalID, hospitalName string, listenPort int, dataDir string, externalIP string) (*Node, error) {
	ctx, cancel := context.WithCancel(context.Background())

	// Load or generate persistent identity
	prv, err := loadOrCreateKey(filepath.Join(dataDir, "p2p-identity.key"))
	if err != nil {
		cancel()
		return nil, fmt.Errorf("identity key: %w", err)
	}

	listenAddr := fmt.Sprintf("/ip4/0.0.0.0/tcp/%d", listenPort)

	opts := []libp2p.Option{
		libp2p.Identity(prv),
		libp2p.ListenAddrStrings(listenAddr),
		libp2p.NATPortMap(),
	}

	// If an external IP is provided (host IP visible to other VMs),
	// add it as an announce address so peers get the routable multiaddr.
	if externalIP != "" {
		extAddr := fmt.Sprintf("/ip4/%s/tcp/%d", externalIP, listenPort)
		extMA, err := ma.NewMultiaddr(extAddr)
		if err == nil {
			opts = append(opts, libp2p.AddrsFactory(func(addrs []ma.Multiaddr) []ma.Multiaddr {
				// Prepend the external address so it is preferred
				return append([]ma.Multiaddr{extMA}, addrs...)
			}))
			log.Printf("✓ External announce address: %s", extAddr)
		} else {
			log.Printf("⚠ Invalid external IP %q: %v", externalIP, err)
		}
	}

	h, err := libp2p.New(opts...)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("create libp2p host: %w", err)
	}

	node := &Node{
		Host:         h,
		HospitalID:   hospitalID,
		HospitalName: hospitalName,
		ExternalIP:   externalIP,
		ctx:          ctx,
		peers:        make(map[peer.ID]*PeerMeta),
		cancel:       cancel,
	}

	// Register protocol stream handlers
	node.registerProtocols()

	// Start mDNS discovery (best-effort; only works within same network)
	disc := &discoveryNotifee{node: node}
	svc := mdns.NewMdnsService(h, MdnsServiceTag, disc)
	if err := svc.Start(); err != nil {
		log.Printf("⚠ mDNS start failed: %v (using explicit bootstrap only)", err)
	} else {
		log.Printf("✓ mDNS discovery started (tag: %s)", MdnsServiceTag)
	}

	// Log listen addresses
	for _, addr := range h.Addrs() {
		log.Printf("  libp2p listening: %s/p2p/%s", addr, h.ID())
	}

	// Periodically reconcile peer topology so stale/disconnected peers recover
	// after VM IP changes or one-sided restarts.
	node.startPeerMaintenanceLoop(60 * time.Second)

	return node, nil
}

// Close shuts down the libp2p node.
func (n *Node) Close() error {
	n.cancel()
	return n.Host.Close()
}

// PeerID returns this node's libp2p peer ID.
func (n *Node) PeerID() peer.ID {
	return n.Host.ID()
}

// ListenAddrs returns the full multiaddrs (including /p2p/<peerID>) this node listens on.
// External addresses are listed first so remote consumers get the routable address.
func (n *Node) ListenAddrs() []string {
	addrs := n.Host.Addrs()
	out := make([]string, 0, len(addrs))
	seen := make(map[string]bool)
	for _, a := range addrs {
		full := fmt.Sprintf("%s/p2p/%s", a, n.Host.ID())
		if !seen[full] {
			out = append(out, full)
			seen[full] = true
		}
	}
	return out
}

// Peers returns a snapshot of all discovered peers.
func (n *Node) Peers() []*PeerMeta {
	n.mu.RLock()
	defer n.mu.RUnlock()
	out := make([]*PeerMeta, 0, len(n.peers))
	for _, pm := range n.peers {
		cp := *pm // copy
		out = append(out, &cp)
	}
	return out
}

// PeerByPeerID returns the peer meta for the given libp2p peer ID.
func (n *Node) PeerByPeerID(id peer.ID) *PeerMeta {
	n.mu.RLock()
	defer n.mu.RUnlock()
	if pm, ok := n.peers[id]; ok {
		cp := *pm
		return &cp
	}
	return nil
}

// PeerByHospitalID returns the peer meta for the given hospital ID.
func (n *Node) PeerByHospitalID(hospitalID string) *PeerMeta {
	n.mu.RLock()
	defer n.mu.RUnlock()

	var bestConnected *PeerMeta
	var bestAny *PeerMeta

	for _, pm := range n.peers {
		if pm.HospitalID != hospitalID {
			continue
		}

		if bestAny == nil || pm.LastSeen.After(bestAny.LastSeen) {
			cp := *pm
			bestAny = &cp
		}

		if n.Host.Network().Connectedness(pm.PeerID) == network.Connected {
			if bestConnected == nil || pm.LastSeen.After(bestConnected.LastSeen) {
				cp := *pm
				bestConnected = &cp
			}
		}
	}

	if bestConnected != nil {
		return bestConnected
	}

	return bestAny
}

// addOrUpdatePeer stores or updates a discovered peer.
func (n *Node) addOrUpdatePeer(id peer.ID, meta *PeerMeta) {
	n.mu.Lock()
	defer n.mu.Unlock()
	meta.PeerID = id
	meta.LastSeen = time.Now()
	if existing, ok := n.peers[id]; ok {
		// Preserve latency and addresses if not updated
		if meta.Latency == 0 {
			meta.Latency = existing.Latency
		}
		if len(meta.Addresses) == 0 {
			meta.Addresses = existing.Addresses
		}
	}

	// A hospital should resolve to a single active peer identity.
	// If the hospital was redeployed and got a new peer ID, drop stale IDs
	// so hospital-id based routing does not randomly pick an old identity.
	if meta.HospitalID != "" && !strings.EqualFold(meta.HospitalID, "unknown") {
		for otherID, otherMeta := range n.peers {
			if otherID == id || otherMeta == nil {
				continue
			}
			if !strings.EqualFold(otherMeta.HospitalID, meta.HospitalID) {
				continue
			}

			delete(n.peers, otherID)
			n.Host.Peerstore().ClearAddrs(otherID)
			log.Printf("peer-cache: replaced stale peer ID %s for hospital %s (new %s)",
				otherID.String()[:16], meta.HospitalID, id.String()[:16])
		}
	}

	n.peers[id] = meta
}

// ConnectToPeer connects to a remote peer using full multiaddrs
// (must include /p2p/<peerID> suffix). After connecting, it performs
// an identity exchange.
func (n *Node) ConnectToPeer(ctx context.Context, multiaddrs []string) (peer.ID, error) {
	var peerID peer.ID
	var transportAddrs []ma.Multiaddr

	for _, s := range multiaddrs {
		a, err := ma.NewMultiaddr(s)
		if err != nil {
			log.Printf("ConnectToPeer: invalid multiaddr %q: %v", s, err)
			continue
		}
		info, err := peer.AddrInfoFromP2pAddr(a)
		if err != nil {
			log.Printf("ConnectToPeer: no /p2p/ component in %q: %v", s, err)
			continue
		}
		peerID = info.ID
		transportAddrs = append(transportAddrs, info.Addrs...)
	}

	if peerID == "" {
		return "", fmt.Errorf("no valid multiaddrs with /p2p/<peerID> found")
	}

	pi := peer.AddrInfo{ID: peerID, Addrs: transportAddrs}
	if err := n.Host.Connect(ctx, pi); err != nil {
		return "", fmt.Errorf("connect to peer %s: %w", peerID.String()[:16], err)
	}

	// Exchange identity metadata
	n.exchangeIdentity(peerID)

	// Peer exchange — discover peers of this peer (gossip mesh)
	go func() {
		exCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		n.RequestPeerExchange(exCtx, peerID)
	}()

	return peerID, nil
}

// startPeerMaintenanceLoop periodically reconciles known peers.
// It refreshes peer exchange with connected peers and attempts reconnect
// for disconnected peers using all known addresses.
func (n *Node) startPeerMaintenanceLoop(interval time.Duration) {
	if interval <= 0 {
		interval = 60 * time.Second
	}

	ticker := time.NewTicker(interval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-n.ctx.Done():
				return
			case <-ticker.C:
				n.peerMaintenanceTick()
			}
		}
	}()
}

func (n *Node) peerMaintenanceTick() {
	for _, pm := range n.Peers() {
		if pm.PeerID == "" || pm.PeerID == n.Host.ID() {
			continue
		}

		if n.Host.Network().Connectedness(pm.PeerID) == network.Connected {
			exCtx, cancel := context.WithTimeout(n.ctx, 10*time.Second)
			n.RequestPeerExchange(exCtx, pm.PeerID)
			cancel()
			continue
		}

		multiaddrs := n.candidateMultiaddrs(pm.PeerID, pm.Addresses)
		if len(multiaddrs) == 0 {
			continue
		}

		connCtx, cancel := context.WithTimeout(n.ctx, 12*time.Second)
		_, err := n.ConnectToPeer(connCtx, multiaddrs)
		cancel()
		if err != nil {
			label := pm.HospitalID
			if label == "" {
				label = "unknown"
			}
			log.Printf("peer-maint: reconnect to %s (%s) failed: %v", label, pm.PeerID.String()[:16], err)
			continue
		}

		label := pm.HospitalID
		if label == "" {
			label = "unknown"
		}
		log.Printf("✓ peer-maint: reconnected to %s (%s)", label, pm.PeerID.String()[:16])
	}
}

func (n *Node) candidateMultiaddrs(peerID peer.ID, preferred []ma.Multiaddr) []string {
	seen := make(map[string]struct{})
	out := make([]string, 0)

	add := func(a ma.Multiaddr) {
		full := fmt.Sprintf("%s/p2p/%s", a.String(), peerID.String())
		if _, ok := seen[full]; ok {
			return
		}
		seen[full] = struct{}{}
		out = append(out, full)
	}

	for _, a := range preferred {
		add(a)
	}
	for _, a := range n.Host.Peerstore().Addrs(peerID) {
		add(a)
	}

	return out
}

// ── Persistent identity key ──

func loadOrCreateKey(path string) (crypto.PrivKey, error) {
	// Try to load existing key
	data, err := os.ReadFile(path)
	if err == nil {
		key, err := crypto.UnmarshalPrivateKey(data)
		if err == nil {
			log.Printf("✓ Loaded persistent libp2p identity from %s", path)
			return key, nil
		}
		log.Printf("⚠ Corrupt identity key at %s, regenerating", path)
	}

	// Generate new Ed25519 key
	prv, _, err := crypto.GenerateKeyPair(crypto.Ed25519, -1)
	if err != nil {
		return nil, fmt.Errorf("generate key: %w", err)
	}

	// Persist
	raw, err := crypto.MarshalPrivateKey(prv)
	if err != nil {
		return nil, fmt.Errorf("marshal key: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		log.Printf("⚠ Cannot create dir for identity key: %v (key not persisted)", err)
		return prv, nil
	}
	if err := os.WriteFile(path, raw, 0600); err != nil {
		log.Printf("⚠ Cannot write identity key: %v (key not persisted)", err)
	} else {
		log.Printf("✓ Generated new libp2p identity, saved to %s", path)
	}

	return prv, nil
}
