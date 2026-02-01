// Code generated for medimage federation. DO NOT EDIT.
package federationv1

type HealthRequest struct{}

type HealthResponse struct {
	Ok         bool            `protobuf:"varint,1,opt,name=ok" json:"ok,omitempty"`
	Message    string          `protobuf:"bytes,2,opt,name=message" json:"message,omitempty"`
	MinioNodes map[string]bool `protobuf:"bytes,3,rep,name=minio_nodes" json:"minio_nodes,omitempty"`
}

type CheckDuplicateRequest struct {
	Sha256Hex string `protobuf:"bytes,1,opt,name=sha256_hex" json:"sha256_hex,omitempty"`
	Bucket    string `protobuf:"bytes,2,opt,name=bucket" json:"bucket,omitempty"`
	Prefix    string `protobuf:"bytes,3,opt,name=prefix" json:"prefix,omitempty"`
}

type CheckDuplicateResponse struct {
	Exists    bool   `protobuf:"varint,1,opt,name=exists" json:"exists,omitempty"`
	ObjectKey string `protobuf:"bytes,2,opt,name=object_key" json:"object_key,omitempty"`
}

type UploadChunk struct {
	Bucket          string `protobuf:"bytes,1,opt,name=bucket" json:"bucket,omitempty"`
	ObjectKey       string `protobuf:"bytes,2,opt,name=object_key" json:"object_key,omitempty"`
	ContentType     string `protobuf:"bytes,3,opt,name=content_type" json:"content_type,omitempty"`
	RejectDuplicate bool   `protobuf:"varint,4,opt,name=reject_duplicate" json:"reject_duplicate,omitempty"`
	Data            []byte `protobuf:"bytes,5,opt,name=data" json:"data,omitempty"`
	Sha256Hex       string `protobuf:"bytes,6,opt,name=sha256_hex" json:"sha256_hex,omitempty"`
}

type UploadResponse struct {
	Success           bool   `protobuf:"varint,1,opt,name=success" json:"success,omitempty"`
	Message           string `protobuf:"bytes,2,opt,name=message" json:"message,omitempty"`
	ObjectKey         string `protobuf:"bytes,3,opt,name=object_key" json:"object_key,omitempty"`
	RejectedDuplicate bool   `protobuf:"varint,4,opt,name=rejected_duplicate" json:"rejected_duplicate,omitempty"`
}

type DownloadRequest struct {
	Bucket    string `protobuf:"bytes,1,opt,name=bucket" json:"bucket,omitempty"`
	ObjectKey string `protobuf:"bytes,2,opt,name=object_key" json:"object_key,omitempty"`
}

type DownloadChunk struct {
	Data []byte `protobuf:"bytes,1,opt,name=data" json:"data,omitempty"`
}

type ListObjectsRequest struct {
	Bucket  string `protobuf:"bytes,1,opt,name=bucket" json:"bucket,omitempty"`
	Prefix  string `protobuf:"bytes,2,opt,name=prefix" json:"prefix,omitempty"`
	MaxKeys int32  `protobuf:"varint,3,opt,name=max_keys" json:"max_keys,omitempty"`
}

type ObjectInfo struct {
	Key  string `protobuf:"bytes,1,opt,name=key" json:"key,omitempty"`
	Size int64  `protobuf:"varint,2,opt,name=size" json:"size,omitempty"`
	Etag string `protobuf:"bytes,3,opt,name=etag" json:"etag,omitempty"`
}

type ListObjectsResponse struct {
	Objects []*ObjectInfo `protobuf:"bytes,1,rep,name=objects" json:"objects,omitempty"`
}
