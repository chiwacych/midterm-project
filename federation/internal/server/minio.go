package server

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"sync"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// MinIOPool holds MinIO clients for multiple nodes (connection pool / health).
type MinIOPool struct {
	clients []*minio.Client
	endpoints []string
	accessKey string
	secretKey string
	bucket string
	mu sync.RWMutex
}

func NewMinIOPool() (*MinIOPool, error) {
	accessKey := os.Getenv("MINIO_ACCESS_KEY")
	if accessKey == "" {
		accessKey = "minioadmin"
	}
	secretKey := os.Getenv("MINIO_SECRET_KEY")
	if secretKey == "" {
		secretKey = "minioadmin123"
	}
	bucket := os.Getenv("MINIO_BUCKET")
	if bucket == "" {
		bucket = "dfs-files"
	}
	endpoints := []string{
		os.Getenv("MINIO1_ENDPOINT"),
		os.Getenv("MINIO2_ENDPOINT"),
		os.Getenv("MINIO3_ENDPOINT"),
	}
	if endpoints[0] == "" {
		endpoints[0] = "minio1:9000"
	}
	if endpoints[1] == "" {
		endpoints[1] = "minio2:9000"
	}
	if endpoints[2] == "" {
		endpoints[2] = "minio3:9000"
	}

	var clients []*minio.Client
	for _, ep := range endpoints {
		client, err := minio.New(ep, &minio.Options{
			Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
			Secure: false,
		})
		if err != nil {
			continue
		}
		clients = append(clients, client)
	}
	if len(clients) == 0 {
		return nil, fmt.Errorf("no MinIO clients could be created")
	}
	return &MinIOPool{
		clients:   clients,
		endpoints: endpoints[:len(clients)],
		accessKey: accessKey,
		secretKey: secretKey,
		bucket:    bucket,
	}, nil
}

func (p *MinIOPool) Bucket() string { return p.bucket }

func (p *MinIOPool) Health(ctx context.Context) (ok bool, message string, nodeStatus map[string]bool) {
	nodeStatus = make(map[string]bool)
	for i, client := range p.clients {
		ep := "minio"
		if i < len(p.endpoints) {
			ep = p.endpoints[i]
		}
		_, err := client.BucketExists(ctx, p.bucket)
		nodeStatus[ep] = (err == nil)
	}
	ok = true
	for _, v := range nodeStatus {
		if !v {
			ok = false
			message = "one or more nodes unhealthy"
			return
		}
	}
	message = "ok"
	return
}

func (p *MinIOPool) EnsureBucket(ctx context.Context) error {
	for _, client := range p.clients {
		exists, err := client.BucketExists(ctx, p.bucket)
		if err != nil {
			return err
		}
		if !exists {
			if err := client.MakeBucket(ctx, p.bucket, minio.MakeBucketOptions{}); err != nil {
				return err
			}
		}
	}
	return nil
}

// FindObjectBySHA256 lists objects under prefix and checks metadata or listing for matching SHA256.
// MinIO does not store custom checksum in listing; we list by prefix and would need metadata.
// For duplicate detection we use a convention: store object with x-amz-meta-sha256 or
// maintain an index. Here we list objects with the given prefix and compare (expensive).
// Alternatively the caller (FastAPI) can pass known object_key from DB. For federation we
// "check duplicate" by listing prefix and reading metadata if any. Simplified: list objects
// under prefix, return first match if we had metadata; else we require DB to tell us.
// So: CheckDuplicate(sha256, bucket, prefix) -> we list prefix and for each object get
// metadata "X-Amz-Meta-Sha256" if set; if match return object_key.
func (p *MinIOPool) FindObjectBySHA256(ctx context.Context, bucket, prefix, sha256Hex string) (objectKey string, found bool) {
	if len(p.clients) == 0 {
		return "", false
	}
	client := p.clients[0]
	opts := minio.ListObjectsOptions{Prefix: prefix, Recursive: true}
	for obj := range client.ListObjects(ctx, bucket, opts) {
		if obj.Err != nil {
			continue
		}
		// Stat to get user metadata
		info, err := client.StatObject(ctx, bucket, obj.Key, minio.StatObjectOptions{})
		if err != nil {
			continue
		}
		if v, ok := info.UserMetadata["X-Amz-Meta-Sha256"]; ok && v == sha256Hex {
			return obj.Key, true
		}
	}
	return "", false
}

// PutObjectAll uploads the same data to all nodes.
func (p *MinIOPool) PutObjectAll(ctx context.Context, bucket, objectKey string, data []byte, contentType string, metadata map[string]string) error {
	for _, client := range p.clients {
		_, err := client.PutObject(ctx, bucket, objectKey, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{
			ContentType:  contentType,
			UserMetadata: metadata,
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// GetObject returns a reader for the object from the first healthy node.
func (p *MinIOPool) GetObject(ctx context.Context, bucket, objectKey string) (*minio.Object, error) {
	for _, client := range p.clients {
		obj, err := client.GetObject(ctx, bucket, objectKey, minio.GetObjectOptions{})
		if err != nil {
			continue
		}
		return obj, nil
	}
	return nil, fmt.Errorf("object not found on any node")
}

// ListObjects lists objects in bucket with optional prefix.
func (p *MinIOPool) ListObjects(ctx context.Context, bucket, prefix string, maxKeys int) ([]minio.ObjectInfo, error) {
	if len(p.clients) == 0 {
		return nil, nil
	}
	client := p.clients[0]
	opts := minio.ListObjectsOptions{Prefix: prefix, Recursive: true}
	var out []minio.ObjectInfo
	n := 0
	for obj := range client.ListObjects(ctx, bucket, opts) {
		if obj.Err != nil {
			return nil, obj.Err
		}
		info, err := client.StatObject(ctx, bucket, obj.Key, minio.StatObjectOptions{})
		if err != nil {
			continue
		}
		out = append(out, info)
		n++
		if maxKeys > 0 && n >= maxKeys {
			break
		}
	}
	return out, nil
}
