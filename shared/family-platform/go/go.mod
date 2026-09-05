module github.com/myunivokai/myunivokai/shared/family-platform/go

go 1.25.1

require (
	github.com/jackc/pgx/v5 v5.7.6
	github.com/joho/godotenv v1.5.1
	github.com/myunivokai/myunivokai/contracts/go v0.0.0
	github.com/pressly/goose/v3 v3.25.0
)

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/mfridman/interpolate v0.0.2 // indirect
	github.com/sethvargo/go-retry v0.3.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	golang.org/x/crypto v0.40.0 // indirect
	golang.org/x/sync v0.16.0 // indirect
	golang.org/x/text v0.27.0 // indirect
)

replace github.com/myunivokai/myunivokai/contracts/go => ../../../contracts/go
