package p2p

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
)

// discoveryNotifee handles mDNS discovery events.
type discoveryNotifee struct {
	node *Node
}

// HandlePeerFound is called when mDNS discovers a new peer on the local network.
func (d *discoveryNotifee) HandlePeerFound(pi peer.AddrInfo) {
	if pi.ID == d.node.Host.ID() {
		return // ignore self
	}

	log.Printf("mDNS: discovered peer %s at %v", pi.ID.String()[:16], pi.Addrs)

	// Connect to the peer
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := d.node.Host.Connect(ctx, pi); err != nil {
		log.Printf("mDNS: failed to connect to %s: %v", pi.ID.String()[:16], err)
		return
	}

	log.Printf("mDNS: connected to peer %s", pi.ID.String()[:16])

	// Exchange hospital identity
	d.node.exchangeIdentity(pi.ID)

	// Peer exchange — discover peers of this peer
	go func() {
		exCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		d.node.RequestPeerExchange(exCtx, pi.ID)
	}()
}

// identityPayload is exchanged over the /medimage/identify/1.0.0 protocol.
type identityPayload struct {
	HospitalID   string `json:"hospital_id"`
	HospitalName string `json:"hospital_name"`
	APIEndpoint  string `json:"api_endpoint,omitempty"`
}

// exchangeIdentity opens an identify stream to exchange hospital metadata.
func (n *Node) exchangeIdentity(peerID peer.ID) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	s, err := n.Host.NewStream(ctx, peerID, ProtocolIdentify)
	if err != nil {
		log.Printf("identify: failed to open stream to %s: %v", peerID.String()[:16], err)
		// Still store the peer with unknown identity
		n.addOrUpdatePeer(peerID, &PeerMeta{
			PeerID:       peerID,
			HospitalID:   "unknown",
			HospitalName: "Unknown Hospital",
		})
		return
	}
	defer s.Close()

	// Send our identity
	enc := json.NewEncoder(s)
	if err := enc.Encode(identityPayload{
		HospitalID:   n.HospitalID,
		HospitalName: n.HospitalName,
	}); err != nil {
		log.Printf("identify: write failed: %v", err)
		return
	}

	// Read their identity
	var remote identityPayload
	dec := json.NewDecoder(s)
	if err := dec.Decode(&remote); err != nil {
		log.Printf("identify: read failed: %v", err)
		return
	}

	// Store discovered peer info
	addrs := n.Host.Peerstore().Addrs(peerID)
	n.addOrUpdatePeer(peerID, &PeerMeta{
		PeerID:       peerID,
		HospitalID:   remote.HospitalID,
		HospitalName: remote.HospitalName,
		Addresses:    addrs,
	})

	log.Printf("✓ Identified peer %s as %s (%s)",
		peerID.String()[:16], remote.HospitalID, remote.HospitalName)
}
