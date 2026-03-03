#!/bin/bash
# Generate mTLS Certificates for Hospital Federation
# This creates certificates for secure mutual TLS authentication between hospitals

set -e

CERTS_DIR="certs"
mkdir -p $CERTS_DIR

echo "🔐 Generating mTLS Certificates for Hospital Federation..."
echo ""

# 1. Generate CA (Certificate Authority)
echo "Step 1: Generating Certificate Authority (CA)..."
openssl genrsa -out $CERTS_DIR/ca-key.pem 4096
openssl req -new -x509 -days 3650 -key $CERTS_DIR/ca-key.pem -out $CERTS_DIR/ca-cert.pem \
    -subj "/C=US/ST=State/L=City/O=Hospital Federation/CN=Federation CA"

echo "  ✓ CA certificate generated"
echo ""

# 2. Generate Hospital A certificates
echo "Step 2: Generating Hospital A certificates..."
openssl genrsa -out $CERTS_DIR/hospital-a-key.pem 4096
openssl req -new -key $CERTS_DIR/hospital-a-key.pem -out $CERTS_DIR/hospital-a-csr.pem \
    -subj "/C=US/ST=State/L=City/O=Hospital A/CN=hospital-a.local"
openssl x509 -req -days 3650 -in $CERTS_DIR/hospital-a-csr.pem \
    -CA $CERTS_DIR/ca-cert.pem -CAkey $CERTS_DIR/ca-key.pem -CAcreateserial \
    -out $CERTS_DIR/hospital-a-cert.pem

echo "  ✓ Hospital A certificates generated"
echo ""

# 3. Generate Hospital B certificates
echo "Step 3: Generating Hospital B certificates..."
openssl genrsa -out $CERTS_DIR/hospital-b-key.pem 4096
openssl req -new -key $CERTS_DIR/hospital-b-key.pem -out $CERTS_DIR/hospital-b-csr.pem \
    -subj "/C=US/ST=State/L=City/O=Hospital B/CN=hospital-b.local"
openssl x509 -req -days 3650 -in $CERTS_DIR/hospital-b-csr.pem \
    -CA $CERTS_DIR/ca-cert.pem -CAkey $CERTS_DIR/ca-key.pem -CAcreateserial \
    -out $CERTS_DIR/hospital-b-cert.pem

echo "  ✓ Hospital B certificates generated"
echo ""

# 4. Clean up CSRs
rm -f $CERTS_DIR/*.csr.pem $CERTS_DIR/ca-cert.srl

# 5. Set permissions
chmod 644 $CERTS_DIR/*.pem
chmod 600 $CERTS_DIR/*-key.pem

echo "✅ mTLS Certificates Generated Successfully!"
echo ""
echo "Generated files:"
echo "  - ca-cert.pem         (CA certificate - trust anchor)"
echo "  - ca-key.pem          (CA private key)"
echo "  - hospital-a-cert.pem (Hospital A certificate)"
echo "  - hospital-a-key.pem  (Hospital A private key)"
echo "  - hospital-b-cert.pem (Hospital B certificate)"
echo "  - hospital-b-key.pem  (Hospital B private key)"
echo ""
echo "📋 Next Steps:"
echo "  1. Copy certificates to each hospital's federation service"
echo "  2. Update docker-compose.yml to mount certificates"
echo "  3. Update federation Go code to use mTLS"
echo "  4. Restart federation services"
