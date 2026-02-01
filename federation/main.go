package main

import (
	"context"
	"log"
	"net"
	"os"
	"strings"

	"medimage/federation/internal/server"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func main() {
	port := os.Getenv("FEDERATION_GRPC_PORT")
	if port == "" {
		port = "50051"
	}
	lis, err := net.Listen("tcp", ":"+port)
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	grpcServer := grpc.NewServer(
		grpc.UnaryInterceptor(jwtUnaryInterceptor),
		grpc.StreamInterceptor(jwtStreamInterceptor),
	)
	server.RegisterFederationService(grpcServer)

	log.Printf("Federation gRPC server listening on :%s", port)
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}

// jwtUnaryInterceptor validates JWT from metadata for unary RPCs.
func jwtUnaryInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
	ctx, err := validateJWT(ctx)
	if err != nil {
		return nil, err
	}
	return handler(ctx, req)
}

func jwtStreamInterceptor(srv interface{}, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
	ctx, err := validateJWT(ss.Context())
	if err != nil {
		return err
	}
	return handler(srv, &streamWithContext{ServerStream: ss, ctx: ctx})
}

type streamWithContext struct {
	grpc.ServerStream
	ctx context.Context
}

func (s *streamWithContext) Context() context.Context { return s.ctx }

func validateJWT(ctx context.Context) (context.Context, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ctx, nil // no metadata; allow (or require in production)
	}
	vals := md.Get("authorization")
	if len(vals) == 0 {
		return ctx, nil
	}
	token := strings.TrimPrefix(vals[0], "Bearer ")
	if token == vals[0] {
		return ctx, nil
	}
	// Validate JWT (RS256) using public key from env
	if err := server.ValidateJWT(token); err != nil {
		return nil, status.Errorf(codes.Unauthenticated, "invalid token: %v", err)
	}
	return ctx, nil
}
