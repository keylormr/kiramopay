FROM golang:1.22-alpine AS builder

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

EXPOSE 8080

CMD ["./api"]
