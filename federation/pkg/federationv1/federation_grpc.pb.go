// Code generated for medimage federation gRPC. DO NOT EDIT.
package federationv1

import (
	context "context"
	grpc "google.golang.org/grpc"
	codes "google.golang.org/grpc/codes"
	status "google.golang.org/grpc/status"
)

type FederationServiceClient interface {
	Health(ctx context.Context, in *HealthRequest, opts ...grpc.CallOption) (*HealthResponse, error)
	CheckDuplicate(ctx context.Context, in *CheckDuplicateRequest, opts ...grpc.CallOption) (*CheckDuplicateResponse, error)
	UploadFile(ctx context.Context, opts ...grpc.CallOption) (FederationService_UploadFileClient, error)
	DownloadFile(ctx context.Context, in *DownloadRequest, opts ...grpc.CallOption) (FederationService_DownloadFileClient, error)
	ListObjects(ctx context.Context, in *ListObjectsRequest, opts ...grpc.CallOption) (*ListObjectsResponse, error)
}

type federationServiceClient struct {
	cc grpc.ClientConnInterface
}

func NewFederationServiceClient(cc grpc.ClientConnInterface) FederationServiceClient {
	return &federationServiceClient{cc}
}

func (c *federationServiceClient) Health(ctx context.Context, in *HealthRequest, opts ...grpc.CallOption) (*HealthResponse, error) {
	out := new(HealthResponse)
	err := c.cc.Invoke(ctx, "/federation.v1.FederationService/Health", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *federationServiceClient) CheckDuplicate(ctx context.Context, in *CheckDuplicateRequest, opts ...grpc.CallOption) (*CheckDuplicateResponse, error) {
	out := new(CheckDuplicateResponse)
	err := c.cc.Invoke(ctx, "/federation.v1.FederationService/CheckDuplicate", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

type FederationService_UploadFileClient interface {
	Send(*UploadChunk) error
	CloseAndRecv() (*UploadResponse, error)
	grpc.ClientStream
}

type federationServiceUploadFileClient struct {
	grpc.ClientStream
}

func (c *federationServiceUploadFileClient) Send(m *UploadChunk) error {
	return c.ClientStream.SendMsg(m)
}

func (c *federationServiceUploadFileClient) CloseAndRecv() (*UploadResponse, error) {
	if err := c.ClientStream.CloseSend(); err != nil {
		return nil, err
	}
	m := new(UploadResponse)
	if err := c.ClientStream.RecvMsg(m); err != nil {
		return nil, err
	}
	return m, nil
}

func (c *federationServiceClient) UploadFile(ctx context.Context, opts ...grpc.CallOption) (FederationService_UploadFileClient, error) {
	stream, err := c.cc.NewStream(ctx, &FederationService_ServiceDesc.Streams[0], "/federation.v1.FederationService/UploadFile", opts...)
	if err != nil {
		return nil, err
	}
	x := &federationServiceUploadFileClient{stream}
	return x, nil
}

type FederationService_DownloadFileClient interface {
	Recv() (*DownloadChunk, error)
	grpc.ClientStream
}

type federationServiceDownloadFileClient struct {
	grpc.ClientStream
}

func (c *federationServiceDownloadFileClient) Recv() (*DownloadChunk, error) {
	m := new(DownloadChunk)
	if err := c.ClientStream.RecvMsg(m); err != nil {
		return nil, err
	}
	return m, nil
}

func (c *federationServiceClient) DownloadFile(ctx context.Context, in *DownloadRequest, opts ...grpc.CallOption) (FederationService_DownloadFileClient, error) {
	stream, err := c.cc.NewStream(ctx, &FederationService_ServiceDesc.Streams[1], "/federation.v1.FederationService/DownloadFile", opts...)
	if err != nil {
		return nil, err
	}
	x := &federationServiceDownloadFileClient{stream}
	if err := x.ClientStream.SendMsg(in); err != nil {
		return nil, err
	}
	if err := x.ClientStream.CloseSend(); err != nil {
		return nil, err
	}
	return x, nil
}

func (c *federationServiceClient) ListObjects(ctx context.Context, in *ListObjectsRequest, opts ...grpc.CallOption) (*ListObjectsResponse, error) {
	out := new(ListObjectsResponse)
	err := c.cc.Invoke(ctx, "/federation.v1.FederationService/ListObjects", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

type FederationServiceServer interface {
	Health(context.Context, *HealthRequest) (*HealthResponse, error)
	CheckDuplicate(context.Context, *CheckDuplicateRequest) (*CheckDuplicateResponse, error)
	UploadFile(FederationService_UploadFileServer) error
	DownloadFile(*DownloadRequest, FederationService_DownloadFileServer) error
	ListObjects(context.Context, *ListObjectsRequest) (*ListObjectsResponse, error)
	mustEmbedUnimplementedFederationServiceServer()
}

type UnimplementedFederationServiceServer struct{}

func (UnimplementedFederationServiceServer) Health(context.Context, *HealthRequest) (*HealthResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method Health not implemented")
}
func (UnimplementedFederationServiceServer) CheckDuplicate(context.Context, *CheckDuplicateRequest) (*CheckDuplicateResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method CheckDuplicate not implemented")
}
func (UnimplementedFederationServiceServer) UploadFile(FederationService_UploadFileServer) error {
	return status.Errorf(codes.Unimplemented, "method UploadFile not implemented")
}
func (UnimplementedFederationServiceServer) DownloadFile(*DownloadRequest, FederationService_DownloadFileServer) error {
	return status.Errorf(codes.Unimplemented, "method DownloadFile not implemented")
}
func (UnimplementedFederationServiceServer) ListObjects(context.Context, *ListObjectsRequest) (*ListObjectsResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method ListObjects not implemented")
}
func (UnimplementedFederationServiceServer) mustEmbedUnimplementedFederationServiceServer() {}

type FederationService_UploadFileServer interface {
	SendAndClose(*UploadResponse) error
	Recv() (*UploadChunk, error)
	grpc.ServerStream
}

type federationServiceUploadFileServer struct {
	grpc.ServerStream
}

func (x *federationServiceUploadFileServer) SendAndClose(m *UploadResponse) error {
	return x.ServerStream.SendMsg(m)
}

func (x *federationServiceUploadFileServer) Recv() (*UploadChunk, error) {
	m := new(UploadChunk)
	if err := x.ServerStream.RecvMsg(m); err != nil {
		return nil, err
	}
	return m, nil
}

type FederationService_DownloadFileServer interface {
	Send(*DownloadChunk) error
	grpc.ServerStream
}

type federationServiceDownloadFileServer struct {
	grpc.ServerStream
}

func (x *federationServiceDownloadFileServer) Send(m *DownloadChunk) error {
	return x.ServerStream.SendMsg(m)
}

func RegisterFederationServiceServer(s grpc.ServiceRegistrar, srv FederationServiceServer) {
	s.RegisterService(&FederationService_ServiceDesc, srv)
}

var FederationService_ServiceDesc = grpc.ServiceDesc{
	ServiceName: "federation.v1.FederationService",
	HandlerType: (*FederationServiceServer)(nil),
	Methods: []grpc.MethodDesc{
		{MethodName: "Health", Handler: _FederationService_Health_Handler},
		{MethodName: "CheckDuplicate", Handler: _FederationService_CheckDuplicate_Handler},
		{MethodName: "ListObjects", Handler: _FederationService_ListObjects_Handler},
	},
	Streams: []grpc.StreamDesc{
		{StreamName: "UploadFile", Handler: _FederationService_UploadFile_Handler, ClientStreams: true},
		{StreamName: "DownloadFile", Handler: _FederationService_DownloadFile_Handler, ServerStreams: true},
	},
	Metadata: "federation.proto",
}

func _FederationService_Health_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(HealthRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(FederationServiceServer).Health(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/federation.v1.FederationService/Health"}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(FederationServiceServer).Health(ctx, req.(*HealthRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _FederationService_CheckDuplicate_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(CheckDuplicateRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(FederationServiceServer).CheckDuplicate(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/federation.v1.FederationService/CheckDuplicate"}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(FederationServiceServer).CheckDuplicate(ctx, req.(*CheckDuplicateRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _FederationService_ListObjects_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ListObjectsRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(FederationServiceServer).ListObjects(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/federation.v1.FederationService/ListObjects"}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(FederationServiceServer).ListObjects(ctx, req.(*ListObjectsRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _FederationService_UploadFile_Handler(srv interface{}, stream grpc.ServerStream) error {
	return srv.(FederationServiceServer).UploadFile(&federationServiceUploadFileServer{stream})
}

func _FederationService_DownloadFile_Handler(srv interface{}, stream grpc.ServerStream) error {
	m := new(DownloadRequest)
	if err := stream.RecvMsg(m); err != nil {
		return err
	}
	return srv.(FederationServiceServer).DownloadFile(m, &federationServiceDownloadFileServer{stream})
}
