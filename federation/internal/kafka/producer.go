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

// Event types for the system
const (
	EventFileUploaded   = "file.uploaded"
	EventFileDownloaded = "file.downloaded"
	EventFileDeleted    = "file.deleted"
	EventFileShared     = "file.shared"
	EventAuditLog       = "audit.log"
	EventHealthCheck    = "health.check"
)

// Topics
const (
	TopicFileEvents   = "medimage.file.events"
	TopicAuditLog     = "medimage.audit"
	TopicHealthEvents = "medimage.health"
)

// AuditEvent represents an audit log entry
type AuditEvent struct {
	EventType   string                 `json:"event_type"`
	UserID      string                 `json:"user_id,omitempty"`
	UserRole    string                 `json:"user_role,omitempty"`
	Action      string                 `json:"action"`
	Resource    string                 `json:"resource,omitempty"`
	ResourceID  string                 `json:"resource_id,omitempty"`
	IPAddress   string                 `json:"ip_address,omitempty"`
	Status      string                 `json:"status"` // success, failure, warning
	Severity    string                 `json:"severity"` // low, medium, high, critical
	Details     map[string]interface{} `json:"details,omitempty"`
	Timestamp   time.Time              `json:"timestamp"`
}

// FileEvent represents a file operation event
type FileEvent struct {
	EventType  string    `json:"event_type"`
	FileID     string    `json:"file_id"`
	Filename   string    `json:"filename"`
	UserID     string    `json:"user_id"`
	Checksum   string    `json:"checksum,omitempty"`
	Size       int64     `json:"size,omitempty"`
	NodeID     string    `json:"node_id,omitempty"`
	Timestamp  time.Time `json:"timestamp"`
}

// HealthEvent represents a health check event
type HealthEvent struct {
	NodeID     string    `json:"node_id"`
	Service    string    `json:"service"`
	Status     string    `json:"status"` // healthy, degraded, unhealthy
	Message    string    `json:"message,omitempty"`
	Timestamp  time.Time `json:"timestamp"`
}

// Producer wraps Sarama async producer
type Producer struct {
	producer sarama.AsyncProducer
	brokers  []string
	mu       sync.RWMutex
	closed   bool
}

var (
	defaultProducer *Producer
	producerOnce    sync.Once
)

// GetBrokers returns Kafka broker addresses from environment
func GetBrokers() []string {
	brokers := os.Getenv("KAFKA_BOOTSTRAP_SERVERS")
	if brokers == "" {
		brokers = "localhost:9092"
	}
	return strings.Split(brokers, ",")
}

// NewProducer creates a new Kafka producer
func NewProducer(brokers []string) (*Producer, error) {
	config := sarama.NewConfig()
	config.Producer.RequiredAcks = sarama.WaitForLocal
	config.Producer.Compression = sarama.CompressionSnappy
	config.Producer.Flush.Frequency = 500 * time.Millisecond
	config.Producer.Return.Successes = false
	config.Producer.Return.Errors = true

	producer, err := sarama.NewAsyncProducer(brokers, config)
	if err != nil {
		return nil, fmt.Errorf("failed to create Kafka producer: %w", err)
	}

	p := &Producer{
		producer: producer,
		brokers:  brokers,
	}

	// Start error handler goroutine
	go p.handleErrors()

	return p, nil
}

// GetDefaultProducer returns the singleton producer instance
func GetDefaultProducer() (*Producer, error) {
	var initErr error
	producerOnce.Do(func() {
		brokers := GetBrokers()
		defaultProducer, initErr = NewProducer(brokers)
		if initErr != nil {
			log.Printf("Warning: Kafka producer initialization failed: %v", initErr)
		}
	})
	return defaultProducer, initErr
}

func (p *Producer) handleErrors() {
	for err := range p.producer.Errors() {
		log.Printf("Kafka producer error: topic=%s, err=%v", err.Msg.Topic, err.Err)
	}
}

// SendAuditEvent publishes an audit event to Kafka
func (p *Producer) SendAuditEvent(ctx context.Context, event AuditEvent) error {
	p.mu.RLock()
	if p.closed {
		p.mu.RUnlock()
		return fmt.Errorf("producer is closed")
	}
	p.mu.RUnlock()

	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now().UTC()
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal audit event: %w", err)
	}

	msg := &sarama.ProducerMessage{
		Topic: TopicAuditLog,
		Key:   sarama.StringEncoder(event.EventType),
		Value: sarama.ByteEncoder(data),
	}

	select {
	case p.producer.Input() <- msg:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// SendFileEvent publishes a file event to Kafka
func (p *Producer) SendFileEvent(ctx context.Context, event FileEvent) error {
	p.mu.RLock()
	if p.closed {
		p.mu.RUnlock()
		return fmt.Errorf("producer is closed")
	}
	p.mu.RUnlock()

	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now().UTC()
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal file event: %w", err)
	}

	msg := &sarama.ProducerMessage{
		Topic: TopicFileEvents,
		Key:   sarama.StringEncoder(event.FileID),
		Value: sarama.ByteEncoder(data),
	}

	select {
	case p.producer.Input() <- msg:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// SendHealthEvent publishes a health check event
func (p *Producer) SendHealthEvent(ctx context.Context, event HealthEvent) error {
	p.mu.RLock()
	if p.closed {
		p.mu.RUnlock()
		return fmt.Errorf("producer is closed")
	}
	p.mu.RUnlock()

	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now().UTC()
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal health event: %w", err)
	}

	msg := &sarama.ProducerMessage{
		Topic: TopicHealthEvents,
		Key:   sarama.StringEncoder(event.NodeID),
		Value: sarama.ByteEncoder(data),
	}

	select {
	case p.producer.Input() <- msg:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Close shuts down the producer
func (p *Producer) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return nil
	}
	p.closed = true
	return p.producer.Close()
}
