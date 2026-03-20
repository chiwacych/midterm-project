package p2p

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"time"

	ma "github.com/multiformats/go-multiaddr"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/peerstore"
)

// ── Wire types ──

// TransferHeader is sent at the beginning of a transfer stream.
type TransferHeader struct {
	TransferID         string `json:"transfer_id"`
	SourceHospitalID   string `json:"source_hospital_id"`
	SourceHospitalName string `json:"source_hospital_name"`
	OriginalFilename   string `json:"original_filename"`
	ContentType        string `json:"content_type"`
	Checksum           string `json:"checksum"` // SHA-256
	FileSize           int64  `json:"file_size"`
	PatientName        string `json:"patient_name"`
	PatientMRN         string `json:"patient_mrn,omitempty"`
	PatientDOB         string `json:"patient_dob,omitempty"`
	Reason             string `json:"reason"`
	Bucket             string `json:"bucket"`
	ObjectKey          string `json:"object_key,omitempty"`
}

// TransferResult is sent back after processing an incoming transfer.
type TransferResult struct {
	Success               bool   `json:"success"`
	Message               string `json:"message"`
	ReceivingHospitalID   string `json:"receiving_hospital_id"`
	ReceivingHospitalName string `json:"receiving_hospital_name"`
}

// HealthPayload is exchanged over the health protocol.
type HealthPayload struct {
	OK           bool   `json:"ok"`
	HospitalID   string `json:"hospital_id"`
	HospitalName string `json:"hospital_name"`
}

// PeerExchangeEntry describes a known peer for the exchange protocol.
type PeerExchangeEntry struct {
	PeerID       string   `json:"peer_id"`
	HospitalID   string   `json:"hospital_id"`
	HospitalName string   `json:"hospital_name"`
	Multiaddrs   []string `json:"multiaddrs"`
}

// ── Protocol registration ──

// registerProtocols registers libp2p stream handlers for all custom protocols.
func (n *Node) registerProtocols() {
	n.Host.SetStreamHandler(ProtocolIdentify, n.handleIdentify)
	n.Host.SetStreamHandler(ProtocolHealth, n.handleHealth)
	n.Host.SetStreamHandler(ProtocolTransfer, n.handleTransfer)
	n.Host.SetStreamHandler(ProtocolPeerExchange, n.handlePeerExchange)
	log.Printf("✓ Registered libp2p protocols: identify, health, transfer, peerexchange")
}

// ── Identify handler (respond to incoming identity requests) ──

func (n *Node) handleIdentify(s network.Stream) {
	defer s.Close()

	// Read remote identity
	var remote identityPayload
	if err := json.NewDecoder(s).Decode(&remote); err != nil {
		log.Printf("identify-handler: decode error: %v", err)
		return
	}

	// Send our identity
	_ = json.NewEncoder(s).Encode(identityPayload{
		HospitalID:   n.HospitalID,
		HospitalName: n.HospitalName,
	})

	// Store peer info
	addrs := n.Host.Peerstore().Addrs(s.Conn().RemotePeer())
	n.addOrUpdatePeer(s.Conn().RemotePeer(), &PeerMeta{
		PeerID:       s.Conn().RemotePeer(),
		HospitalID:   remote.HospitalID,
		HospitalName: remote.HospitalName,
		Addresses:    addrs,
	})

	log.Printf("✓ Identify handshake with %s (%s)",
		remote.HospitalID, s.Conn().RemotePeer().String()[:16])
}

// ── Health handler ──

func (n *Node) handleHealth(s network.Stream) {
	defer s.Close()
	_ = json.NewEncoder(s).Encode(HealthPayload{
		OK:           true,
		HospitalID:   n.HospitalID,
		HospitalName: n.HospitalName,
	})
}

// ── Transfer handler (receiving side) ──

func (n *Node) handleTransfer(s network.Stream) {
	defer s.Close()
	enc := json.NewEncoder(s)

	// 1. Read header length (4 bytes, big-endian)
	var headerLen uint32
	if err := binary.Read(s, binary.BigEndian, &headerLen); err != nil {
		log.Printf("transfer-recv: read header len: %v", err)
		_ = enc.Encode(TransferResult{Success: false, Message: "bad header length"})
		return
	}
	if headerLen > 1<<20 { // 1 MB max header
		_ = enc.Encode(TransferResult{Success: false, Message: "header too large"})
		return
	}

	// 2. Read header JSON
	headerBuf := make([]byte, headerLen)
	if _, err := io.ReadFull(s, headerBuf); err != nil {
		_ = enc.Encode(TransferResult{Success: false, Message: "incomplete header"})
		return
	}
	var header TransferHeader
	if err := json.Unmarshal(headerBuf, &header); err != nil {
		_ = enc.Encode(TransferResult{Success: false, Message: "invalid header JSON"})
		return
	}

	log.Printf("transfer-recv: receiving '%s' from %s (%d bytes)",
		header.OriginalFilename, header.SourceHospitalID, header.FileSize)

	// 3. Read file data (limited to declared size + 1 byte for safety)
	maxRead := header.FileSize
	if maxRead <= 0 {
		maxRead = 500 << 20 // 500 MB fallback limit
	}
	fileData, err := io.ReadAll(io.LimitReader(s, maxRead+1))
	if err != nil {
		_ = enc.Encode(TransferResult{Success: false, Message: "read file data: " + err.Error()})
		return
	}

	// 4. Delegate to the callback (stores to MinIO, notifies FastAPI)
	if n.OnTransferReceived == nil {
		log.Printf("transfer-recv: no handler registered!")
		_ = enc.Encode(TransferResult{Success: false, Message: "receiver not configured"})
		return
	}

	result, err := n.OnTransferReceived(header, fileData)
	if err != nil {
		log.Printf("transfer-recv: handler error: %v", err)
		_ = enc.Encode(TransferResult{Success: false, Message: "processing error: " + err.Error()})
		return
	}

	_ = enc.Encode(result)
	log.Printf("✓ transfer-recv: completed '%s' from %s", header.OriginalFilename, header.SourceHospitalID)
}

// ── Outbound operations ──

// SendFileData sends file bytes to a remote peer over a libp2p stream.
// The file should already be downloaded from MinIO by the caller (server package).
func (n *Node) SendFileData(ctx context.Context, targetPeerID peer.ID, header TransferHeader, fileData []byte) (*TransferResult, error) {
	header.FileSize = int64(len(fileData))

	// Open libp2p stream to target peer
	s, err := n.Host.NewStream(ctx, targetPeerID, ProtocolTransfer)
	if err != nil {
		return nil, fmt.Errorf("open stream to %s: %w", targetPeerID.String()[:16], err)
	}
	defer s.Close()

	// Write header length + header JSON
	headerJSON, err := json.Marshal(header)
	if err != nil {
		return nil, fmt.Errorf("marshal header: %w", err)
	}
	if err := binary.Write(s, binary.BigEndian, uint32(len(headerJSON))); err != nil {
		return nil, fmt.Errorf("write header len: %w", err)
	}
	if _, err := s.Write(headerJSON); err != nil {
		return nil, fmt.Errorf("write header: %w", err)
	}

	// Write file data
	if _, err := s.Write(fileData); err != nil {
		return nil, fmt.Errorf("write file data: %w", err)
	}

	// Signal write completion
	if err := s.CloseWrite(); err != nil {
		log.Printf("send: CloseWrite warning: %v", err)
	}

	// Read result from receiver
	var result TransferResult
	if err := json.NewDecoder(s).Decode(&result); err != nil {
		return nil, fmt.Errorf("read transfer result: %w", err)
	}

	return &result, nil
}

// CheckPeerHealth opens a health stream to a specific peer and returns the response.
func (n *Node) CheckPeerHealth(ctx context.Context, targetPeerID peer.ID) (*HealthPayload, time.Duration, error) {
	start := time.Now()

	s, err := n.Host.NewStream(ctx, targetPeerID, ProtocolHealth)
	if err != nil {
		return nil, 0, fmt.Errorf("open health stream: %w", err)
	}
	defer s.Close()

	var payload HealthPayload
	if err := json.NewDecoder(s).Decode(&payload); err != nil {
		return nil, 0, fmt.Errorf("decode health response: %w", err)
	}

	latency := time.Since(start)
	return &payload, latency, nil
}

// ── Peer Exchange protocol ──

// handlePeerExchange responds to a peer exchange request by sending
// our list of known peers. This enables gossip-based peer discovery.
func (n *Node) handlePeerExchange(s network.Stream) {
	defer s.Close()

	peers := n.Peers()
	entries := make([]PeerExchangeEntry, 0, len(peers))
	for _, pm := range peers {
		// Don't send back the requesting peer's own info
		if pm.PeerID == s.Conn().RemotePeer() {
			continue
		}
		// Merge addresses from PeerMeta and the peerstore (the built-in
		// libp2p Identify protocol may have added addresses after our
		// custom identify handshake stored the PeerMeta).
		seen := make(map[string]struct{})
		var allAddrs []ma.Multiaddr
		for _, a := range pm.Addresses {
			key := a.String()
			if _, ok := seen[key]; !ok {
				seen[key] = struct{}{}
				allAddrs = append(allAddrs, a)
			}
		}
		for _, a := range n.Host.Peerstore().Addrs(pm.PeerID) {
			key := a.String()
			if _, ok := seen[key]; !ok {
				seen[key] = struct{}{}
				allAddrs = append(allAddrs, a)
			}
		}

		addrs := make([]string, 0, len(allAddrs))
		for _, a := range allAddrs {
			addrs = append(addrs, fmt.Sprintf("%s/p2p/%s", a.String(), pm.PeerID.String()))
		}
		entries = append(entries, PeerExchangeEntry{
			PeerID:       pm.PeerID.String(),
			HospitalID:   pm.HospitalID,
			HospitalName: pm.HospitalName,
			Multiaddrs:   addrs,
		})
	}

	if err := json.NewEncoder(s).Encode(entries); err != nil {
		log.Printf("peerexchange-handler: encode error: %v", err)
	}
}

// RequestPeerExchange asks a connected peer for its known peers.
// Unknown peers are auto-connected, enabling mesh discovery through
// a single seed peer.
func (n *Node) RequestPeerExchange(ctx context.Context, targetPeerID peer.ID) {
	s, err := n.Host.NewStream(ctx, targetPeerID, ProtocolPeerExchange)
	if err != nil {
		log.Printf("peerexchange: failed to open stream to %s: %v", targetPeerID.String()[:16], err)
		return
	}
	defer s.Close()

	var entries []PeerExchangeEntry
	if err := json.NewDecoder(s).Decode(&entries); err != nil {
		log.Printf("peerexchange: decode error: %v", err)
		return
	}

	log.Printf("peerexchange: received %d peer(s) from %s", len(entries), targetPeerID.String()[:16])

	for _, entry := range entries {
		pid, err := peer.Decode(entry.PeerID)
		if err != nil {
			continue
		}
		// Skip ourselves
		if pid == n.Host.ID() {
			continue
		}

		// Parse and store advertised addresses so known peers can be refreshed
		// after IP/endpoint changes.
		advertised := make([]ma.Multiaddr, 0, len(entry.Multiaddrs))
		connectAddrs := make([]string, 0, len(entry.Multiaddrs))
		seenConnect := make(map[string]struct{})
		for _, raw := range entry.Multiaddrs {
			m, err := ma.NewMultiaddr(raw)
			if err != nil {
				continue
			}
			info, err := peer.AddrInfoFromP2pAddr(m)
			if err != nil || info.ID != pid {
				continue
			}
			advertised = append(advertised, info.Addrs...)
			if _, ok := seenConnect[raw]; !ok {
				seenConnect[raw] = struct{}{}
				connectAddrs = append(connectAddrs, raw)
			}
		}
		if len(advertised) > 0 {
			n.Host.Peerstore().AddAddrs(pid, advertised, peerstore.PermanentAddrTTL)
		}

		// Always refresh metadata for this peer, even when it already exists.
		n.addOrUpdatePeer(pid, &PeerMeta{
			PeerID:       pid,
			HospitalID:   entry.HospitalID,
			HospitalName: entry.HospitalName,
			Addresses:    n.Host.Peerstore().Addrs(pid),
		})

		// If already connected, metadata refresh is enough.
		if n.Host.Network().Connectedness(pid) == network.Connected {
			continue
		}

		// If the exchange payload had no usable p2p addrs, try peerstore addrs.
		if len(connectAddrs) == 0 {
			for _, a := range n.Host.Peerstore().Addrs(pid) {
				raw := fmt.Sprintf("%s/p2p/%s", a.String(), pid.String())
				if _, ok := seenConnect[raw]; ok {
					continue
				}
				seenConnect[raw] = struct{}{}
				connectAddrs = append(connectAddrs, raw)
			}
		}
		if len(connectAddrs) == 0 {
			continue
		}

		label := entry.HospitalID
		if label == "" {
			label = "unknown"
		}
		log.Printf("peerexchange: (re)connecting to peer %s (%s)...", label, pid.String()[:16])
		connCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		_, err = n.ConnectToPeer(connCtx, connectAddrs)
		cancel()
		if err != nil {
			log.Printf("peerexchange: failed to connect to %s: %v", label, err)
		} else {
			log.Printf("✓ peerexchange: connected to %s (%s)", label, pid.String()[:16])
		}
	}
}
