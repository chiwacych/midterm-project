#!/bin/bash
# Deploy Hospital B Federation Node

HOSPITAL_NAME="hospital-b"
HOSPITAL_IP="172.29.140.113"
HOSPITAL_PORT="8002"
FEDERATION_PORT="50053"
POSTGRES_PORT="5436"

echo "=== Deploying $HOSPITAL_NAME Federation Node ==="

# Transfer project files to VM
echo "Transferring project files..."
multipass transfer ../docker-compose.yml $HOSPITAL_NAME:/home/ubuntu/
multipass transfer ../app $HOSPITAL_NAME:/home/ubuntu/ -r
multipass transfer ../federation $HOSPITAL_NAME:/home/ubuntu/ -r
multipass transfer ../postgres-config $HOSPITAL_NAME:/home/ubuntu/ -r
multipass transfer ../grafana $HOSPITAL_NAME:/home/ubuntu/ -r

# Create environment file for Hospital B
echo "Creating environment configuration..."
multipass exec $HOSPITAL_NAME -- bash -c "cat > /home/ubuntu/.env << 'EOF'
# Hospital B Configuration
HOSPITAL_ID=hospital-b
HOSPITAL_NAME=Hospital B
HOSPITAL_PORT=$HOSPITAL_PORT
FEDERATION_GRPC_PORT=$FEDERATION_PORT

# Database
POSTGRES_HOST=postgres-primary
POSTGRES_PORT=$POSTGRES_PORT
POSTGRES_DB=medimage_db
POSTGRES_USER=medimage
POSTGRES_PASSWORD=medimage123

# MinIO
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin123
MINIO_BUCKET=hospital-b-files

# Federation Network
FEDERATION_PEER_HOSPITAL_A=172.29.136.54:50052

# JWT
JWT_SECRET_KEY=your-secret-key-change-in-production
JWT_ALGORITHM=RS256

# API
API_PORT=$HOSPITAL_PORT
CORS_ORIGINS=http://localhost:3000,http://$HOSPITAL_IP:3000
EOF"

# Install Docker and Docker Compose
echo "Installing Docker..."
multipass exec $HOSPITAL_NAME -- bash -c "
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg lsb-release
  
  # Add Docker's official GPG key
  sudo mkdir -p /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  
  # Set up repository
  echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \$(lsb_release -cs) stable\" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  
  # Install Docker Engine
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  
  # Add user to docker group
  sudo usermod -aG docker ubuntu
"

# Start services
echo "Starting Docker services..."
multipass exec $HOSPITAL_NAME -- bash -c "
  cd /home/ubuntu
  docker compose up -d
"

echo ""
echo "=== Hospital B Deployment Complete ==="
echo "API: http://$HOSPITAL_IP:$HOSPITAL_PORT"
echo "Federation gRPC: $HOSPITAL_IP:$FEDERATION_PORT"
echo "MinIO Console: http://$HOSPITAL_IP:9002"
echo "Grafana: http://$HOSPITAL_IP:3002"
echo ""
echo "Check status: multipass exec $HOSPITAL_NAME -- docker ps"
echo "View logs: multipass exec $HOSPITAL_NAME -- docker compose logs -f"
