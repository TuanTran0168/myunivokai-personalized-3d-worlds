module github.com/myunivokai/myunivokai/services/nature-service

go 1.25.7

require (
	github.com/google/uuid v1.6.0
	github.com/jackc/pgx/v5 v5.7.6
	github.com/myunivokai/myunivokai/contracts/go v0.0.0
	github.com/myunivokai/myunivokai/shared/family-platform/go v0.0.0
	github.com/nats-io/nats.go v1.52.0
	github.com/rs/zerolog v1.34.0
)

replace github.com/myunivokai/myunivokai/contracts/go => ../../contracts/go

replace github.com/myunivokai/myunivokai/shared/family-platform/go => ../../shared/family-platform/go

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/joho/godotenv v1.5.1 // indirect
	github.com/klauspost/compress v1.18.5 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.21 // indirect
	github.com/mfridman/interpolate v0.0.2 // indirect
	github.com/nats-io/nkeys v0.4.15 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	github.com/pressly/goose/v3 v3.25.0 // indirect
	github.com/sethvargo/go-retry v0.3.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	golang.org/x/crypto v0.49.0 // indirect
	golang.org/x/sync v0.21.0 // indirect
	golang.org/x/sys v0.45.0 // indirect
	golang.org/x/text v0.37.0 // indirect
)
