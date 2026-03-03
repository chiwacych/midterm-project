#!/bin/bash
# Test Federation Network Communication

HOSPITAL_A_IP="172.29.136.54"
HOSPITAL_B_IP="172.29.140.113"
HOSPITAL_A_API="http://$HOSPITAL_A_IP:8001"
HOSPITAL_B_API="http://$HOSPITAL_B_IP:8002"
HOSPITAL_A_GRPC="$HOSPITAL_A_IP:50052"
HOSPITAL_B_GRPC="$HOSPITAL_B_IP:50053"

echo "=== Testing Federation Network ==="
echo ""

# Test 1: Check if both hospitals are reachable
echo "Test 1: Checking hospital connectivity..."
echo -n "Hospital A API: "
curl -s -o /dev/null -w "%{http_code}" $HOSPITAL_A_API/health || echo "FAILED"
echo ""
echo -n "Hospital B API: "
curl -s -o /dev/null -w "%{http_code}" $HOSPITAL_B_API/health || echo "FAILED"
echo ""

# Test 2: Check gRPC ports
echo ""
echo "Test 2: Checking gRPC ports..."
echo -n "Hospital A gRPC (50052): "
nc -zv $HOSPITAL_A_IP 50052 2>&1 | grep -q "succeeded" && echo "OPEN" || echo "CLOSED"
echo -n "Hospital B gRPC (50053): "
nc -zv $HOSPITAL_B_IP 50053 2>&1 | grep -q "succeeded" && echo "OPEN" || echo "CLOSED"

# Test 3: Register test patient in Hospital A
echo ""
echo "Test 3: Creating test patient in Hospital A..."
TOKEN_A=$(curl -s -X POST "$HOSPITAL_A_API/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin"}' | jq -r '.access_token')

PATIENT_A=$(curl -s -X POST "$HOSPITAL_A_API/api/patients" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "John",
    "last_name": "Doe",
    "date_of_birth": "1980-01-01",
    "gender": "M",
    "contact_info": "john.doe@example.com"
  }')

PATIENT_ID=$(echo $PATIENT_A | jq -r '.id')
echo "Created patient ID: $PATIENT_ID"

# Test 4: Grant consent for Hospital B
echo ""
echo "Test 4: Granting consent for Hospital B..."
CONSENT=$(curl -s -X POST "$HOSPITAL_A_API/api/consent" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{
    \"patient_id\": $PATIENT_ID,
    \"consented_hospital\": \"hospital-b\",
    \"data_categories\": [\"medical_images\", \"patient_info\"],
    \"purpose\": \"Cross-hospital consultation\",
    \"expiry_date\": \"2026-12-31\"
  }")

echo $CONSENT | jq '.'

# Test 5: Query patient from Hospital B via federation
echo ""
echo "Test 5: Querying federated patient from Hospital B..."
TOKEN_B=$(curl -s -X POST "$HOSPITAL_B_API/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin"}' | jq -r '.access_token')

FEDERATED_PATIENT=$(curl -s -X GET "$HOSPITAL_B_API/api/federation/patients/$PATIENT_ID?source_hospital=hospital-a" \
  -H "Authorization: Bearer $TOKEN_B")

echo $FEDERATED_PATIENT | jq '.'

# Test 6: Upload medical image in Hospital A and query from Hospital B
echo ""
echo "Test 6: Testing federated file access..."
echo "Creating test DICOM file..."
dd if=/dev/urandom of=/tmp/test.dcm bs=1024 count=100 2>/dev/null

echo "Uploading to Hospital A..."
UPLOAD_A=$(curl -s -X POST "$HOSPITAL_A_API/api/upload" \
  -H "Authorization: Bearer $TOKEN_A" \
  -F "file=@/tmp/test.dcm" \
  -F "patient_id=$PATIENT_ID" \
  -F "description=Test DICOM image")

FILE_ID=$(echo $UPLOAD_A | jq -r '.file_id')
echo "Uploaded file ID: $FILE_ID"

echo "Attempting federated access from Hospital B..."
curl -s -X GET "$HOSPITAL_B_API/api/federation/files/$FILE_ID?source_hospital=hospital-a" \
  -H "Authorization: Bearer $TOKEN_B" \
  -o /tmp/federated_file.dcm

if [ -f /tmp/federated_file.dcm ]; then
  SIZE=$(stat -f%z /tmp/federated_file.dcm 2>/dev/null || stat -c%s /tmp/federated_file.dcm)
  echo "Federated file downloaded successfully! Size: $SIZE bytes"
  rm /tmp/federated_file.dcm
else
  echo "Federated file download FAILED"
fi

rm /tmp/test.dcm

echo ""
echo "=== Federation Network Tests Complete ==="
echo ""
echo "Summary:"
echo "- Hospital A: $HOSPITAL_A_API"
echo "- Hospital B: $HOSPITAL_B_API"
echo "- gRPC Federation: $HOSPITAL_A_GRPC <-> $HOSPITAL_B_GRPC"
echo ""
echo "Check logs:"
echo "  Hospital A: multipass exec hospital-a -- docker compose logs -f federation"
echo "  Hospital B: multipass exec hospital-b -- docker compose logs -f federation"
