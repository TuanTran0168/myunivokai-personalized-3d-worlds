module github.com/myunivokai/myunivokai/services/api-gateway

go 1.25.1

require (
	github.com/go-chi/chi/v5 v5.2.2
	github.com/go-chi/cors v1.2.2
	github.com/google/uuid v1.6.0
	github.com/joho/godotenv v1.5.1
	github.com/myunivokai/myunivokai/contracts/go v0.0.0
	github.com/nats-io/nats.go v1.52.0
	github.com/oklog/ulid/v2 v2.1.1
	github.com/redis/go-redis/v9 v9.18.0
	github.com/rs/zerolog v1.34.0
	golang.org/x/time v0.12.0
)

replace github.com/myunivokai/myunivokai/contracts/go => ../../contracts/go

require (
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/dgryski/go-rendezvous v0.0.0-20200823014737-9f7001d12a5f // indirect
	github.com/golang-jwt/jwt/v5 v5.2.1 // indirect
	github.com/klauspost/compress v1.18.5 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.19 // indirect
	github.com/nats-io/nkeys v0.4.15 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	go.uber.org/atomic v1.11.0 // indirect
	golang.org/x/crypto v0.49.0 // indirect
	golang.org/x/sys v0.42.0 // indirect
)
