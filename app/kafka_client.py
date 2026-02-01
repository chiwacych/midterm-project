"""Kafka producer/consumer for audit and events."""
import os
import json
import asyncio
from typing import Optional

AUDIT_TOPIC = os.getenv("KAFKA_AUDIT_TOPIC", "medimage.audit")
BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092").split(",")
_producer = None
_producer_lock = asyncio.Lock()


async def get_producer():
    global _producer
    if _producer is not None:
        return _producer
    async with _producer_lock:
        if _producer is not None:
            return _producer
        try:
            from aiokafka import AIOKafkaProducer
            _producer = AIOKafkaProducer(
                bootstrap_servers=BOOTSTRAP_SERVERS,
                value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            )
            await _producer.start()
        except Exception as e:
            print(f"Kafka producer init failed: {e} (audit events will be no-op)")
            _producer = None
        return _producer


async def send_audit_event(event_type: str, payload: dict, user_id: Optional[str] = None):
    """Send an audit event to Kafka. No-op if Kafka is unavailable."""
    producer = await get_producer()
    if producer is None:
        return
    try:
        msg = {
            "event_type": event_type,
            "user_id": user_id,
            "payload": payload,
            "ts": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        }
        await producer.send_and_wait(AUDIT_TOPIC, msg, key=msg.get("event_type", "").encode())
    except Exception as e:
        print(f"Kafka send_audit_event error: {e}")
