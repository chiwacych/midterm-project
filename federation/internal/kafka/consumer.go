package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/IBM/sarama"
)

// EventHandler is called for each consumed message
type EventHandler func(topic string, key, value []byte) error

// Consumer wraps Sarama consumer group
type Consumer struct {
	group   sarama.ConsumerGroup
	brokers []string
	groupID string
	topics  []string
	handler EventHandler
	mu      sync.RWMutex
	closed  bool
	ctx     context.Context
	cancel  context.CancelFunc
}

// ConsumerGroupHandler implements sarama.ConsumerGroupHandler
type ConsumerGroupHandler struct {
	handler EventHandler
}

func (h *ConsumerGroupHandler) Setup(_ sarama.ConsumerGroupSession) error   { return nil }
func (h *ConsumerGroupHandler) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }

func (h *ConsumerGroupHandler) ConsumeClaim(session sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	for msg := range claim.Messages() {
		if err := h.handler(msg.Topic, msg.Key, msg.Value); err != nil {
			log.Printf("Error processing message: topic=%s, offset=%d, err=%v", msg.Topic, msg.Offset, err)
		}
		session.MarkMessage(msg, "")
	}
	return nil
}

// GetConsumerGroupID returns consumer group ID from environment
func GetConsumerGroupID() string {
	groupID := os.Getenv("KAFKA_CONSUMER_GROUP")
	if groupID == "" {
		groupID = "medimage-federation"
	}
	return groupID
}

// NewConsumer creates a new Kafka consumer
func NewConsumer(brokers []string, groupID string, topics []string, handler EventHandler) (*Consumer, error) {
	config := sarama.NewConfig()
	config.Consumer.Group.Rebalance.GroupStrategies = []sarama.BalanceStrategy{sarama.NewBalanceStrategyRoundRobin()}
	config.Consumer.Offsets.Initial = sarama.OffsetNewest
	config.Consumer.Return.Errors = true

	group, err := sarama.NewConsumerGroup(brokers, groupID, config)
	if err != nil {
		return nil, fmt.Errorf("failed to create consumer group: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())

	c := &Consumer{
		group:   group,
		brokers: brokers,
		groupID: groupID,
		topics:  topics,
		handler: handler,
		ctx:     ctx,
		cancel:  cancel,
	}

	return c, nil
}

// Start begins consuming messages
func (c *Consumer) Start() error {
	c.mu.RLock()
	if c.closed {
		c.mu.RUnlock()
		return fmt.Errorf("consumer is closed")
	}
	c.mu.RUnlock()

	handler := &ConsumerGroupHandler{handler: c.handler}

	// Start error handler goroutine
	go func() {
		for err := range c.group.Errors() {
			log.Printf("Kafka consumer error: %v", err)
		}
	}()

	// Consume loop
	go func() {
		for {
			select {
			case <-c.ctx.Done():
				return
			default:
				if err := c.group.Consume(c.ctx, c.topics, handler); err != nil {
					log.Printf("Consumer group error: %v", err)
					time.Sleep(time.Second) // Backoff on error
				}
			}
		}
	}()

	log.Printf("Kafka consumer started: group=%s, topics=%v", c.groupID, c.topics)
	return nil
}

// Close shuts down the consumer
func (c *Consumer) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return nil
	}
	c.closed = true
	c.cancel()
	return c.group.Close()
}

// AuditEventHandler creates a handler that processes audit events
func AuditEventHandler(store AuditStore) EventHandler {
	return func(topic string, key, value []byte) error {
		if topic != TopicAuditLog {
			return nil
		}

		var event AuditEvent
		if err := json.Unmarshal(value, &event); err != nil {
			return fmt.Errorf("failed to unmarshal audit event: %w", err)
		}

		return store.StoreAuditEvent(event)
	}
}

// AuditStore interface for persisting audit events
type AuditStore interface {
	StoreAuditEvent(event AuditEvent) error
}

// DefaultAuditConsumer creates a consumer for audit log processing
func DefaultAuditConsumer(store AuditStore) (*Consumer, error) {
	brokers := GetBrokers()
	groupID := GetConsumerGroupID()
	topics := []string{TopicAuditLog}

	return NewConsumer(brokers, groupID, topics, AuditEventHandler(store))
}

// AllEventsConsumer creates a consumer for all event types
func AllEventsConsumer(handler EventHandler) (*Consumer, error) {
	brokers := GetBrokers()
	groupID := GetConsumerGroupID() + "-all"
	topics := []string{TopicAuditLog, TopicFileEvents, TopicHealthEvents}

	return NewConsumer(brokers, groupID, topics, handler)
}

// LoggingAuditStore is a simple audit store that logs events
type LoggingAuditStore struct{}

func (s *LoggingAuditStore) StoreAuditEvent(event AuditEvent) error {
	log.Printf("AUDIT: %s | user=%s | action=%s | resource=%s | status=%s",
		event.EventType, event.UserID, event.Action, event.Resource, event.Status)
	return nil
}

// Helper to split comma-separated topics
func ParseTopics(topicsEnv string) []string {
	if topicsEnv == "" {
		return []string{TopicAuditLog, TopicFileEvents, TopicHealthEvents}
	}
	return strings.Split(topicsEnv, ",")
}
