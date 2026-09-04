package config

import (
	"strings"
	"testing"

	contracts "github.com/myunivokai/myunivokai/contracts/go"
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
	serviceConfig, err := Load(contracts.WorldFamilyUniverse)
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

// Universe's copy of this default was the one that lost its /universe prefix,
// and it went unnoticed for as long as the three services each held their own
// literal: there was nothing for a wrong one to disagree with. Deriving it
// gives all three families one answer, and this states what that answer is.
func TestThePublicWebURLDefaultCarriesEachFamilysOwnPrefix(t *testing.T) {
	families := []struct {
		family                  contracts.WorldFamily
		expectedDefaultLocalURL string
	}{
		{contracts.WorldFamilyUniverse, "http://localhost:41300/universe"},
		{contracts.WorldFamilyNature, "http://localhost:41300/nature"},
		{contracts.WorldFamilyOcean, "http://localhost:41300/ocean"},
	}

	for _, testCase := range families {
		t.Run(string(testCase.family), func(t *testing.T) {
			t.Setenv("DATABASE_URL", "postgresql://local")
			t.Setenv("NATS_URL", "nats://localhost:4222")
			t.Setenv("MYUNIVOKAI_ENV_FILE", "missing-test-file")
			t.Setenv("PUBLIC_WEB_URL", "")
			serviceConfig, err := Load(testCase.family)
			if err != nil {
				t.Fatalf("load config: %v", err)
			}
			if serviceConfig.PublicWebURL != testCase.expectedDefaultLocalURL {
				t.Fatalf("PublicWebURL = %q, want %q", serviceConfig.PublicWebURL, testCase.expectedDefaultLocalURL)
			}
		})
	}
}

// PUBLIC_WEB_URL is what production sets, and it must win over the derived
// default without the family being consulted at all - production's universe
// origin is not localhost with a prefix bolted on.
func TestAnExplicitPublicWebURLOverridesTheDerivedDefault(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://local")
	t.Setenv("NATS_URL", "nats://localhost:4222")
	t.Setenv("MYUNIVOKAI_ENV_FILE", "missing-test-file")
	t.Setenv("PUBLIC_WEB_URL", "https://myunivokai.vercel.app/ocean")
	serviceConfig, err := Load(contracts.WorldFamilyOcean)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if serviceConfig.PublicWebURL != "https://myunivokai.vercel.app/ocean" {
		t.Fatalf("PublicWebURL = %q, want the value from the environment", serviceConfig.PublicWebURL)
	}
}

// The family decides which subject a process consumes, so a service handed a
// name nobody defined should refuse to start rather than boot into a family
// that does not exist.
//
// The name below is deliberately nonsense rather than "city": City is a
// planned family, and a test that asserted City is invalid would start failing
// on the day City becomes valid, for a reason that has nothing to do with what
// this test is about.
func TestLoadRefusesAFamilyThatIsNotOneOfTheThree(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://local")
	t.Setenv("NATS_URL", "nats://localhost:4222")
	t.Setenv("MYUNIVOKAI_ENV_FILE", "missing-test-file")
	if _, err := Load(contracts.WorldFamily("not-a-family")); err == nil {
		t.Fatal("expected an unknown family to be refused")
	}
}
