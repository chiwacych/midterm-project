FROM golang:1.21-alpine AS builder
WORKDIR /app

# Install protoc and Go protobuf plugins
RUN apk add --no-cache protobuf-dev git \
    && go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.32.0 \
    && go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.3.0

COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .

# Tidy dependencies (pulls any new transitive deps like libp2p)
RUN go mod tidy

# Generate Go protobuf stubs from federation.proto
# The proto file is copied into the build context at proto/federation.proto
RUN if [ -f proto/federation.proto ]; then \
      export PATH=$PATH:$(go env GOPATH)/bin && \
      protoc --go_out=pkg/federationv1 --go-grpc_out=pkg/federationv1 \
        --go_opt=paths=source_relative \
        --go-grpc_opt=paths=source_relative \
        -I proto proto/federation.proto && \
      echo "✓ Go proto stubs generated"; \
    else \
      echo "⚠ No proto/federation.proto found, using existing stubs"; \
    fi

RUN CGO_ENABLED=0 go build -o /federation .

FROM alpine:3.18
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /federation .
EXPOSE 50051
ENV FEDERATION_GRPC_PORT=50051
CMD ["./federation"]
