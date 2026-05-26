#!/bin/bash
set -e

echo "========================================="
echo "  KiramoPay - Starting all services..."
echo "========================================="
echo ""

# Build and start everything
docker compose up --build -d

echo ""
echo "Waiting for services to be healthy..."

# Wait for API to be ready (depends on postgres + redis)
MAX_RETRIES=30
RETRY=0
until curl -sf http://localhost:9999/health > /dev/null 2>&1; do
  RETRY=$((RETRY + 1))
  if [ $RETRY -ge $MAX_RETRIES ]; then
    echo ""
    echo "[!] Timeout waiting for services. Check logs with:"
    echo "    docker compose logs"
    exit 1
  fi
  printf "."
  sleep 2
done

echo ""
echo ""
echo "========================================="
echo "  KiramoPay is running!"
echo "========================================="
echo ""
echo "  App:       http://localhost:9999"
echo "  API:       http://localhost:9999/api/v1/"
echo "  Health:    http://localhost:9999/health"
echo "  WebSocket: ws://localhost:9999/ws/prices"
echo ""
echo "  Test users:"
echo "    Keilor  -> 702650930 / Kiramopay2024!"
echo "    Admin   -> 700000000 / Admin2024!"
echo ""
echo "  Commands:"
echo "    docker compose logs -f     # View logs"
echo "    docker compose down        # Stop all"
echo "    docker compose down -v     # Stop + delete data"
echo "========================================="
