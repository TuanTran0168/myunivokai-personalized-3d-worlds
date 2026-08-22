package config

import "testing"

func TestValidateRejectsMissingRequiredSettings(t *testing.T) {
	valid := validConfig()
	if err := valid.Validate(); err != nil {
		t.Fatalf("expected the reference config to be valid: %v", err)
	}

	cases := map[string]func(Config) Config{
		"no database url":         func(c Config) Config { c.DatabaseURL = "  "; return c },
		"no nats url":             func(c Config) Config { c.NATSURL = ""; return c },
		"no connection budget":    func(c Config) Config { c.DatabaseMaximumConnections = 0; return c },
		"no query timeout":        func(c Config) Config { c.QueryTimeout = 0; return c },
		"no consumer ack wait":    func(c Config) Config { c.ConsumerAckWait = 0; return c },
		"empty consumer batch":    func(c Config) Config { c.ConsumerFetchBatchSize = 0; return c },
		"no reconnect wait":       func(c Config) Config { c.NATSReconnectWait = 0; return c },
		"negative retry interval": func(c Config) Config { c.ConsumerRetryDelay = -1; return c },
	}
	for name, mutate := range cases {
		if err := mutate(valid).Validate(); err == nil {
			t.Fatalf("%s: expected validation to fail", name)
		}
	}
}

// analytics-service holds no token key and no Redis URL, unlike auth-service.
// Requiring either would be a sign the read model had started doing something
// it is not allowed to do.
func TestConfigCarriesNoCredentialSettings(t *testing.T) {
	config := validConfig()
	config.NATSUsername = ""
	config.NATSPassword = ""
	config.NATSCredentialsFile = ""
	if err := config.Validate(); err != nil {
		t.Fatalf("NATS credentials are optional (local dev runs without them): %v", err)
	}
}

func validConfig() Config {
	return Config{
		DatabaseURL:                "postgres://localhost/analytics",
		DatabaseMaximumConnections: defaultDatabaseMaximumConnections,
		NATSURL:                    "nats://localhost:4222",
		NATSConnectTimeout:         defaultNATSConnectTimeout,
		NATSReconnectWait:          defaultNATSReconnectWait,
		QueryTimeout:               defaultQueryTimeout,
		ShutdownTimeout:            defaultShutdownTimeout,
		ConsumerAckWait:            defaultConsumerAckWait,
		ConsumerFetchBatchSize:     defaultConsumerFetchBatchSize,
		ConsumerFetchMaximumWait:   defaultConsumerFetchMaximumWait,
		ConsumerRetryDelay:         defaultConsumerRetryDelay,
	}
}
