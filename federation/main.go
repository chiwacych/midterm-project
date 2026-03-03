package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log"
	"net"
	"os"
	"strconv"
	"strings"

	"medimage/federation/internal/p2p"
	"medimage/federation/internal/server"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
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

	// Check if mTLS is enabled
	tlsCertFile := os.Getenv("TLS_CERT_FILE")
	tlsKeyFile := os.Getenv("TLS_KEY_FILE")
	tlsCAFile := os.Getenv("TLS_CA_FILE")

	var grpcServer *grpc.Server

	if tlsCertFile != "" && tlsKeyFile != "" && tlsCAFile != "" {
		// mTLS enabled
		log.Println("🔐 Enabling mTLS (Mutual TLS) for secure federation...")

		tlsConfig, err := loadTLSCredentials(tlsCertFile, tlsKeyFile, tlsCAFile)
		if err != nil {
			log.Fatalf("failed to load TLS credentials: %v", err)
		}

		grpcServer = grpc.NewServer(
			grpc.Creds(credentials.NewTLS(tlsConfig)),
			grpc.UnaryInterceptor(jwtUnaryInterceptor),
			grpc.StreamInterceptor(jwtStreamInterceptor),
		)
		log.Printf("✓ mTLS enabled with certificate: %s", tlsCertFile)
	} else {
		// No mTLS - development mode
		log.Println("⚠️  mTLS disabled - running in insecure mode (development only)")
		grpcServer = grpc.NewServer(
			grpc.UnaryInterceptor(jwtUnaryInterceptor),
			grpc.StreamInterceptor(jwtStreamInterceptor),
		)
	}

	// Register gRPC service (returns *FederationServer so we can attach p2p later)
	fedServer := server.RegisterFederationService(grpcServer)

	// ── Start libp2p node ──
	hospitalID := os.Getenv("HOSPITAL_ID")
	if hospitalID == "" {
		hospitalID = "hospital-a"
	}
	hospitalName := os.Getenv("HOSPITAL_NAME")
	if hospitalName == "" {
		hospitalName = "Hospital A"
	}
	p2pPort := 4001
	if v := os.Getenv("LIBP2P_PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			p2pPort = p
		}
	}
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "/data"
	}
	externalIP := os.Getenv("LIBP2P_EXTERNAL_IP") // host IP reachable from other VMs

	p2pNode, err := p2p.NewNode(hospitalID, hospitalName, p2pPort, dataDir, externalIP)
	if err != nil {
		log.Printf("⚠ libp2p node creation failed: %v (transfers will use fallback)", err)
	} else {
		fedServer.SetP2PNode(p2pNode)
		defer p2pNode.Close()
		log.Printf("✓ libp2p node started: peer_id=%s, hospital=%s", p2pNode.PeerID(), hospitalID)
		if externalIP != "" {
			log.Printf("  External IP: %s (used in announce addrs)", externalIP)
		}
	}

	log.Printf("Federation gRPC server listening on :%s", port)
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("serve: %v", err)
	}
}

// loadTLSCredentials loads server TLS credentials with mutual TLS
func loadTLSCredentials(certFile, keyFile, caFile string) (*tls.Config, error) {
	// Load server certificate and private key
	serverCert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("failed to load server certificate: %w", err)
	}

	// Load CA certificate for client verification
	caCert, err := os.ReadFile(caFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read CA certificate: %w", err)
	}

	certPool := x509.NewCertPool()
	if !certPool.AppendCertsFromPEM(caCert) {
		return nil, fmt.Errorf("failed to add CA certificate to pool")
	}

	// Create TLS configuration
	config := &tls.Config{
		Certificates: []tls.Certificate{serverCert},
		ClientAuth:   tls.RequireAndVerifyClientCert, // Mutual TLS
		ClientCAs:    certPool,
		MinVersion:   tls.VersionTLS13, // TLS 1.3 for best security
	}

	return config, nil
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
