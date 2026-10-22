# go.mod pins toolchain go1.26.10; the official image sets GOTOOLCHAIN=local
# (no auto-download), so the base image's Go must already satisfy it. 1.26.10
# fixes GO-2026-6809 (crypto/x509, compromised intermediate certificates);
# 1.26.9 already carried the net/http, crypto/tls and html/template fixes of
# October 2026 (GO-2026-6599 to GO-2026-6617). The 1.25 line no longer gets
# security releases.
FROM golang:1.26.10-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Download dependencies first (cached layer)
COPY go.mod go.sum ./
RUN go mod download

# Build
COPY . .
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o /tmp/apibin ./cmd/api

# Runtime
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /tmp/apibin ./api
COPY --from=builder /app/migrations ./migrations
# La especificacion que lee la documentacion de la API. Solo se sirve con
# ENVIRONMENT=development (docker-compose, k8s base): sin el archivo, la
# pagina de Swagger de esos entornos no tenia que mostrar.
COPY --from=builder /app/docs/openapi.yaml ./docs/openapi.yaml

EXPOSE 8080

CMD ["./api"]
