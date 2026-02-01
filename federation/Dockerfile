FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 go build -o /federation .

FROM alpine:3.18
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /federation .
EXPOSE 50051
ENV FEDERATION_GRPC_PORT=50051
CMD ["./federation"]
