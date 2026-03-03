FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Generate Python protobuf stubs from federation.proto if available
# grpcio-tools is already in requirements.txt
RUN if [ -f proto/federation.proto ]; then \
      python -m grpc_tools.protoc \
        -I proto \
        --python_out=proto \
        --grpc_python_out=proto \
        proto/federation.proto && \
      sed -i 's/^import federation_pb2 as/from . import federation_pb2 as/' proto/federation_pb2_grpc.py && \
      echo "✓ Python proto stubs generated"; \
    else \
      echo "⚠ No proto/federation.proto found, using existing stubs"; \
    fi

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
