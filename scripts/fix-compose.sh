#!/bin/bash
# Fix docker-compose.yml on a hospital VM
# Usage: fix-compose.sh <hospital-a-ip> <hospital-b-ip> <my-ip>

HOSPITAL_A_IP="$1"
HOSPITAL_B_IP="$2"
MY_IP="$3"
COMPOSE_FILE="/home/ubuntu/medimage/docker-compose.yml"

echo "Fixing docker-compose.yml..."
echo "  Hospital A: $HOSPITAL_A_IP"
echo "  Hospital B: $HOSPITAL_B_IP"
echo "  My IP: $MY_IP"

# 1. Fix HOST_IP (replace the line containing HOST_IP=)
sed -i "s|HOST_IP=.*|HOST_IP=${MY_IP}|" "$COMPOSE_FILE"

# 2. Add extra_hosts to fastapi service if not already present
if ! grep -q 'extra_hosts' "$COMPOSE_FILE"; then
  # Find the line number of "restart: unless-stopped" in the fastapi section
  # The fastapi section starts with "container_name: fastapi-app"
  FASTAPI_START=$(grep -n 'container_name: fastapi-app' "$COMPOSE_FILE" | cut -d: -f1)
  # Find the "restart: unless-stopped" after the fastapi section
  RESTART_LINE=$(awk "NR>$FASTAPI_START && /restart: unless-stopped/{print NR; exit}" "$COMPOSE_FILE")
  
  echo "  Inserting extra_hosts at line $RESTART_LINE"
  
  # Insert extra_hosts before the restart line
  sed -i "${RESTART_LINE}i\\    extra_hosts:\\n      - \"hospital-a.local:${HOSPITAL_A_IP}\"\\n      - \"hospital-b.local:${HOSPITAL_B_IP}\"" "$COMPOSE_FILE"
fi

echo "Verification:"
grep -n 'HOST_IP\|extra_hosts\|hospital.*\.local' "$COMPOSE_FILE"
echo "Done."
