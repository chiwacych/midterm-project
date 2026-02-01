#!/bin/sh
# Create Kafka topics for medimage (audit, etc.)
KAFKA_BOOTSTRAP=${KAFKA_BOOTSTRAP_SERVERS:-localhost:9092}
echo "Creating topics (bootstrap=$KAFKA_BOOTSTRAP)..."

# Use kafka-topics if available (e.g. inside Kafka container)
for topic in medimage.audit medimage.events; do
  kafka-topics.sh --bootstrap-server "$KAFKA_BOOTSTRAP" --create --if-not-exists --topic "$topic" --partitions 1 --replication-factor 1 2>/dev/null || true
done
echo "Done."
