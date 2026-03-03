package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"medimage/federation/internal/p2p"
	federationv1 "medimage/federation/pkg/federationv1"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type FederationServer struct {
	federationv1.UnimplementedFederationServiceServer
	pool *MinIOPool
	p2p  *p2p.Node // libp2p node for cross-hospital communication
}

func NewFederationServer() (*FederationServer, error) {
	pool, err := NewMinIOPool()
	if err != nil {
		return nil, err
	}
	return &FederationServer{pool: pool}, nil
}

// SetP2PNode attaches the libp2p node to the server (called from main.go after
// both the gRPC server and the libp2p node are created).
func (s *FederationServer) SetP2PNode(node *p2p.Node) {
	s.p2p = node
	// Register the incoming transfer handler so the p2p package
	// can delegate MinIO storage + FastAPI notification to us.
	node.OnTransferReceived = s.handleIncomingTransfer
	log.Printf("✓ libp2p node attached to gRPC server (peer %s)", node.PeerID().String()[:16])
}

// RegisterFederationService registers the federation server with the gRPC server
// and returns the server instance so main.go can attach the p2p node later.
func RegisterFederationService(grpcSrv *grpc.Server) *FederationServer {
	impl, err := NewFederationServer()
	if err != nil {
		log.Printf("WARN: FederationServer init failed: %v (health/ops may fail)", err)
		impl = &FederationServer{} // allow server to start; RPCs will return error
	}
	federationv1.RegisterFederationServiceServer(grpcSrv, impl)
	return impl
}

func (s *FederationServer) Health(ctx context.Context, req *federationv1.HealthRequest) (*federationv1.HealthResponse, error) {
	if s.pool == nil {
		return &federationv1.HealthResponse{Ok: false, Message: "MinIO pool not initialized"}, nil
	}
	ok, message, nodeStatus := s.pool.Health(ctx)
	return &federationv1.HealthResponse{
		Ok:         ok,
		Message:    message,
		MinioNodes: nodeStatus,
	}, nil
}

func (s *FederationServer) CheckDuplicate(ctx context.Context, req *federationv1.CheckDuplicateRequest) (*federationv1.CheckDuplicateResponse, error) {
	if s.pool == nil {
		return nil, status.Error(codes.Unavailable, "MinIO pool not initialized")
	}
	bucket := req.Bucket
	if bucket == "" {
		bucket = s.pool.Bucket()
	}
	objectKey, found := s.pool.FindObjectBySHA256(ctx, bucket, req.Prefix, req.Sha256Hex)
	if found {
		return &federationv1.CheckDuplicateResponse{Exists: true, ObjectKey: objectKey}, nil
	}
	return &federationv1.CheckDuplicateResponse{Exists: false}, nil
}

func (s *FederationServer) UploadFile(stream federationv1.FederationService_UploadFileServer) error {
	if s.pool == nil {
		return status.Error(codes.Unavailable, "MinIO pool not initialized")
	}
	var bucket, objectKey, contentType, sha256Hex string
	var rejectDuplicate bool
	var buf bytes.Buffer
	for {
		chunk, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if bucket == "" {
			bucket = chunk.Bucket
			objectKey = chunk.ObjectKey
			contentType = chunk.ContentType
			rejectDuplicate = chunk.RejectDuplicate
			sha256Hex = chunk.Sha256Hex
		}
		if len(chunk.Data) > 0 {
			buf.Write(chunk.Data)
		}
		if chunk.Sha256Hex != "" {
			sha256Hex = chunk.Sha256Hex
		}
	}
	if bucket == "" {
		bucket = s.pool.Bucket()
	}
	data := buf.Bytes()
	// Optionally verify SHA256
	if sha256Hex != "" {
		sum := sha256.Sum256(data)
		if hex.EncodeToString(sum[:]) != sha256Hex {
			return stream.SendAndClose(&federationv1.UploadResponse{
				Success: false,
				Message: "SHA256 mismatch",
			})
		}
	}
	if rejectDuplicate && sha256Hex != "" {
		objectKeyFound, found := s.pool.FindObjectBySHA256(stream.Context(), bucket, "", sha256Hex)
		if found {
			return stream.SendAndClose(&federationv1.UploadResponse{
				Success:           false,
				RejectedDuplicate: true,
				Message:           "duplicate file exists: " + objectKeyFound,
			})
		}
	}
	metadata := map[string]string{}
	if sha256Hex != "" {
		metadata["X-Amz-Meta-Sha256"] = sha256Hex
	}
	if err := s.pool.PutObjectAll(stream.Context(), bucket, objectKey, data, contentType, metadata); err != nil {
		return stream.SendAndClose(&federationv1.UploadResponse{
			Success: false,
			Message: err.Error(),
		})
	}
	return stream.SendAndClose(&federationv1.UploadResponse{
		Success:   true,
		ObjectKey: objectKey,
		Message:   "uploaded",
	})
}

func (s *FederationServer) DownloadFile(req *federationv1.DownloadRequest, stream federationv1.FederationService_DownloadFileServer) error {
	if s.pool == nil {
		return status.Error(codes.Unavailable, "MinIO pool not initialized")
	}
	bucket := req.Bucket
	if bucket == "" {
		bucket = s.pool.Bucket()
	}
	obj, err := s.pool.GetObject(stream.Context(), bucket, req.ObjectKey)
	if err != nil {
		return status.Error(codes.NotFound, err.Error())
	}
	defer obj.Close()
	const chunkSize = 256 * 1024
	buf := make([]byte, chunkSize)
	for {
		n, err := obj.Read(buf)
		if n > 0 {
			if err := stream.Send(&federationv1.DownloadChunk{Data: buf[:n]}); err != nil {
				return err
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *FederationServer) ListObjects(ctx context.Context, req *federationv1.ListObjectsRequest) (*federationv1.ListObjectsResponse, error) {
	if s.pool == nil {
		return nil, status.Error(codes.Unavailable, "MinIO pool not initialized")
	}
	bucket := req.Bucket
	if bucket == "" {
		bucket = s.pool.Bucket()
	}
	maxKeys := int(req.MaxKeys)
	if maxKeys <= 0 {
		maxKeys = 1000
	}
	infos, err := s.pool.ListObjects(ctx, bucket, req.Prefix, maxKeys)
	if err != nil {
		return nil, err
	}
	out := make([]*federationv1.ObjectInfo, 0, len(infos))
	for _, info := range infos {
		out = append(out, &federationv1.ObjectInfo{
			Key:  info.Key,
			Size: info.Size,
			Etag: info.ETag,
		})
	}
	return &federationv1.ListObjectsResponse{Objects: out}, nil
}

// ── libp2p-based RPCs ──

func (s *FederationServer) ListPeers(ctx context.Context, req *federationv1.ListPeersRequest) (*federationv1.ListPeersResponse, error) {
	if s.p2p == nil {
		return &federationv1.ListPeersResponse{}, nil
	}
	peers := s.p2p.Peers()
	out := make([]*federationv1.DiscoveredPeer, 0, len(peers))
	for _, pm := range peers {
		addrs := make([]string, 0, len(pm.Addresses))
		for _, a := range pm.Addresses {
			addrs = append(addrs, fmt.Sprintf("%s/p2p/%s", a, pm.PeerID))
		}
		// Check connectivity
		reachable := s.p2p.Host.Network().Connectedness(pm.PeerID) == network.Connected
		out = append(out, &federationv1.DiscoveredPeer{
			PeerId:       pm.PeerID.String(),
			HospitalId:   pm.HospitalID,
			HospitalName: pm.HospitalName,
			Addresses:    addrs,
			Reachable:    reachable,
			LatencyMs:    pm.Latency.Milliseconds(),
		})
	}
	return &federationv1.ListPeersResponse{Peers: out}, nil
}

func (s *FederationServer) TransferFile(ctx context.Context, req *federationv1.TransferFileRequest) (*federationv1.TransferFileResponse, error) {
	if s.p2p == nil {
		return nil, status.Error(codes.Unavailable, "libp2p node not initialized")
	}
	if s.pool == nil {
		return nil, status.Error(codes.Unavailable, "MinIO pool not initialized")
	}

	// Resolve target peer
	var targetPeerID peer.ID
	if req.TargetPeerId != "" {
		pid, err := peer.Decode(req.TargetPeerId)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid peer_id: %v", err)
		}
		targetPeerID = pid
	} else if req.TargetHospitalId != "" {
		pm := s.p2p.PeerByHospitalID(req.TargetHospitalId)
		if pm == nil {
			return nil, status.Errorf(codes.NotFound, "no peer found for hospital %s", req.TargetHospitalId)
		}
		targetPeerID = pm.PeerID
	} else {
		return nil, status.Error(codes.InvalidArgument, "target_peer_id or target_hospital_id required")
	}

	// Download file from local MinIO
	bucket := req.Bucket
	if bucket == "" {
		bucket = s.pool.Bucket()
	}
	obj, err := s.pool.GetObject(ctx, bucket, req.ObjectKey)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "file not found in MinIO: %v", err)
	}
	defer obj.Close()

	fileData, err := io.ReadAll(obj)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "read file: %v", err)
	}

	log.Printf("TransferFile: sending '%s' (%d bytes) to peer %s",
		req.OriginalFilename, len(fileData), targetPeerID.String()[:16])

	// Send via libp2p stream
	header := p2p.TransferHeader{
		TransferID:         req.TransferId,
		SourceHospitalID:   req.SourceHospitalId,
		SourceHospitalName: req.SourceHospitalName,
		OriginalFilename:   req.OriginalFilename,
		ContentType:        req.ContentType,
		Checksum:           req.Checksum,
		PatientName:        req.PatientName,
		PatientMRN:         req.PatientMrn,
		PatientDOB:         req.PatientDob,
		Reason:             req.Reason,
		Bucket:             bucket,
		ObjectKey:          req.ObjectKey,
	}

	result, err := s.p2p.SendFileData(ctx, targetPeerID, header, fileData)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "libp2p transfer failed: %v", err)
	}

	return &federationv1.TransferFileResponse{
		Success:               result.Success,
		Message:               result.Message,
		TransferId:            req.TransferId,
		ReceivingHospitalName: result.ReceivingHospitalName,
	}, nil
}

func (s *FederationServer) PeerHealth(ctx context.Context, req *federationv1.PeerHealthRequest) (*federationv1.PeerHealthResponse, error) {
	if s.p2p == nil {
		return nil, status.Error(codes.Unavailable, "libp2p node not initialized")
	}

	// Resolve target peer
	var targetPeerID peer.ID
	if req.TargetPeerId != "" {
		pid, err := peer.Decode(req.TargetPeerId)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "invalid peer_id: %v", err)
		}
		targetPeerID = pid
	} else if req.TargetHospitalId != "" {
		pm := s.p2p.PeerByHospitalID(req.TargetHospitalId)
		if pm == nil {
			return nil, status.Errorf(codes.NotFound, "no peer for hospital %s", req.TargetHospitalId)
		}
		targetPeerID = pm.PeerID
	} else {
		return nil, status.Error(codes.InvalidArgument, "target_peer_id or target_hospital_id required")
	}

	health, latency, err := s.p2p.CheckPeerHealth(ctx, targetPeerID)
	if err != nil {
		return &federationv1.PeerHealthResponse{Reachable: false}, nil
	}

	return &federationv1.PeerHealthResponse{
		Reachable:    health.OK,
		LatencyMs:    latency.Milliseconds(),
		HospitalId:   health.HospitalID,
		HospitalName: health.HospitalName,
	}, nil
}

func (s *FederationServer) AddPeer(ctx context.Context, req *federationv1.AddPeerRequest) (*federationv1.AddPeerResponse, error) {
	if s.p2p == nil {
		return nil, status.Error(codes.Unavailable, "libp2p node not initialized")
	}

	if len(req.Multiaddrs) == 0 {
		return nil, status.Error(codes.InvalidArgument, "at least one multiaddr required")
	}

	connectCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	peerID, err := s.p2p.ConnectToPeer(connectCtx, req.Multiaddrs)
	if err != nil {
		return &federationv1.AddPeerResponse{
			Success: false,
			Message: err.Error(),
		}, nil
	}

	return &federationv1.AddPeerResponse{
		Success: true,
		PeerId:  peerID.String(),
		Message: fmt.Sprintf("connected to peer %s", peerID.String()[:16]),
	}, nil
}

func (s *FederationServer) GetNodeInfo(ctx context.Context, req *federationv1.GetNodeInfoRequest) (*federationv1.GetNodeInfoResponse, error) {
	if s.p2p == nil {
		return &federationv1.GetNodeInfoResponse{
			HospitalId:   os.Getenv("HOSPITAL_ID"),
			HospitalName: os.Getenv("HOSPITAL_NAME"),
		}, nil
	}

	return &federationv1.GetNodeInfoResponse{
		PeerId:       s.p2p.PeerID().String(),
		HospitalId:   s.p2p.HospitalID,
		HospitalName: s.p2p.HospitalName,
		ListenAddrs:  s.p2p.ListenAddrs(),
	}, nil
}

// ── Incoming transfer handler (called by p2p package) ──

// handleIncomingTransfer stores the received file in MinIO and notifies
// the local FastAPI to create DB records.
func (s *FederationServer) handleIncomingTransfer(header p2p.TransferHeader, fileData []byte) (*p2p.TransferResult, error) {
	ctx := context.Background()

	// Determine object key and bucket
	bucket := header.Bucket
	if bucket == "" {
		if s.pool != nil {
			bucket = s.pool.Bucket()
		} else {
			bucket = "dfs-files"
		}
	}
	objectKey := fmt.Sprintf("federation/%s/%s/%s",
		header.SourceHospitalID, header.TransferID, header.OriginalFilename)

	// Store to MinIO
	if s.pool == nil {
		return &p2p.TransferResult{
			Success: false,
			Message: "MinIO not available on receiving node",
		}, nil
	}

	metadata := map[string]string{}
	if header.Checksum != "" {
		metadata["X-Amz-Meta-Sha256"] = header.Checksum
	}
	if err := s.pool.PutObjectAll(ctx, bucket, objectKey, fileData, header.ContentType, metadata); err != nil {
		return &p2p.TransferResult{
			Success: false,
			Message: "MinIO storage failed: " + err.Error(),
		}, nil
	}

	log.Printf("transfer-recv: stored %s (%d bytes) in MinIO", objectKey, len(fileData))

	// Notify local FastAPI to create DB records
	if err := notifyFastAPI(header, objectKey, int64(len(fileData)), bucket); err != nil {
		log.Printf("transfer-recv: FastAPI notify failed: %v (file stored OK)", err)
		// Don't fail — file is stored, metadata may be missing
	}

	hospitalID := os.Getenv("HOSPITAL_ID")
	hospitalName := os.Getenv("HOSPITAL_NAME")
	if hospitalID == "" {
		hospitalID = "unknown"
	}
	if hospitalName == "" {
		hospitalName = "Unknown Hospital"
	}

	return &p2p.TransferResult{
		Success:               true,
		Message:               "file received and stored",
		ReceivingHospitalID:   hospitalID,
		ReceivingHospitalName: hospitalName,
	}, nil
}

// notifyFastAPI calls the local FastAPI internal endpoint to create DB records
// for an incoming transfer. The file is already stored in MinIO.
func notifyFastAPI(header p2p.TransferHeader, objectKey string, fileSize int64, bucket string) error {
	apiPort := os.Getenv("API_PORT")
	if apiPort == "" {
		apiPort = "8000"
	}
	apiHost := os.Getenv("FASTAPI_HOST")
	if apiHost == "" {
		apiHost = "fastapi" // Docker service name
	}

	url := fmt.Sprintf("http://%s:%s/api/federation/transfer/receive-internal", apiHost, apiPort)

	body := map[string]interface{}{
		"transfer_id":          header.TransferID,
		"source_hospital_id":   header.SourceHospitalID,
		"source_hospital_name": header.SourceHospitalName,
		"original_filename":    header.OriginalFilename,
		"content_type":         header.ContentType,
		"checksum":             header.Checksum,
		"file_size":            fileSize,
		"object_key":           objectKey,
		"bucket_name":          bucket,
		"patient_name":         header.PatientName,
		"patient_mrn":          header.PatientMRN,
		"patient_dob":          header.PatientDOB,
		"reason":               header.Reason,
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("fastapi notify: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("fastapi returned %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}
