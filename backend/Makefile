.PHONY: build run test lint clean docker-up docker-down migrate

# Build the API binary
build:
	go build -o bin/api ./cmd/api

# Run locally (requires local postgres/redis)
run:
	go run ./cmd/api

# Run unit tests (no database required)
test:
	go test ./pkg/... -v -count=1

# Run integration tests (requires PostgreSQL and Redis)
# -p 1: integration tests share one Postgres with fixed seed IDs, so packages
# must run serially (parallel packages race on the same rows) — matches CI.
test-integration:
	TEST_DB_DSN="postgres://kiramopay:kiramopay_dev@localhost:5432/kiramopay_test?sslmode=disable" \
	TEST_REDIS_ADDR="localhost:6379" \
	go test ./internal/... -v -count=1 -p 1 -timeout=60s

# Run all tests
test-all:
	go test ./... -v -count=1 -p 1 -timeout=60s

# Run tests with coverage
test-coverage:
	go test ./... -v -count=1 -p 1 -coverprofile=coverage.out -timeout=60s
	go tool cover -html=coverage.out -o coverage.html

# Create test database
test-db-create:
	docker compose exec postgres psql -U kiramopay -c "CREATE DATABASE kiramopay_test;" 2>/dev/null || true

# Lint
lint:
	golangci-lint run ./...

# Clean build artifacts
clean:
	rm -rf bin/ coverage.out coverage.html

# Docker
docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-rebuild:
	docker compose up -d --build

docker-logs:
	docker compose logs -f api

# Database migrations
migrate-up:
	docker compose exec postgres psql -U kiramopay -d kiramopay -f /docker-entrypoint-initdb.d/001_initial_schema.sql

migrate-reset:
	docker compose exec postgres psql -U kiramopay -d kiramopay -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	$(MAKE) migrate-up
