package config

import (
	"strings"
	"testing"
)

func TestValidateRequiresDatabaseAndNATS(t *testing.T) {
	serviceConfig := Config{DatabaseMaximumConnections: 10, ConsumerAckWait: defaultConsumerAckWait, ConsumerMaximumDeliveries: 5, QueryTimeout: defaultQueryTimeout, ShutdownTimeout: defaultShutdownTimeout, OutboxPollInterval: defaultOutboxPollInterval, OutboxBatchSize: 10, ShareSlugLength: 10}
	if err := serviceConfig.Validate(); err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("expected missing database error, got %v", err)
	}
	serviceConfig.DatabaseURL = "postgresql://local"
	if err := serviceConfig.Validate(); err == nil || !strings.Contains(err.Error(), "NATS_URL") {
		t.Fatalf("expected missing NATS error, got %v", err)
	}
}

func TestLoadUsesEventRuntimeDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://local")
	t.Setenv("NATS_URL", "nats://localhost:4222")
	t.Setenv("MYUNIVOKAI_ENV_FILE", "missing-test-file")
	serviceConfig, err := Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if serviceConfig.ShareSlugLength != defaultShareSlugLength {
		t.Fatalf("expected default share slug length %d, got %d", defaultShareSlugLength, serviceConfig.ShareSlugLength)
	}
	if serviceConfig.ConsumerMaximumDeliveries != defaultConsumerMaximumDeliveries {
		t.Fatalf("expected default max deliveries %d, got %d", defaultConsumerMaximumDeliveries, serviceConfig.ConsumerMaximumDeliveries)
	}
}
