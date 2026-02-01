package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log"

	federationv1 "medimage/federation/pkg/federationv1"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type FederationServer struct {
	federationv1.UnimplementedFederationServiceServer
	pool *MinIOPool
}

func NewFederationServer() (*FederationServer, error) {
	pool, err := NewMinIOPool()
	if err != nil {
		return nil, err
	}
	return &FederationServer{pool: pool}, nil
}

// RegisterFederationService registers the federation server with the gRPC server.
func RegisterFederationService(s *grpc.Server) {
	impl, err := NewFederationServer()
	if err != nil {
		log.Printf("WARN: FederationServer init failed: %v (health/ops may fail)", err)
		impl = &FederationServer{} // allow server to start; RPCs will return error
	}
	federationv1.RegisterFederationServiceServer(s, impl)
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
				Success:          false,
				RejectedDuplicate: true,
				Message:          "duplicate file exists: " + objectKeyFound,
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
