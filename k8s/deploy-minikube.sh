#!/bin/bash
# Deploy KiramoPay to local minikube cluster
# Prerequisites: minikube, kubectl, helm, docker

set -e

echo "=== KiramoPay Local Kubernetes Deployment ==="

# 1. Start minikube if not running
if ! minikube status &>/dev/null; then
    echo "[1/7] Starting minikube..."
    minikube start --cpus=4 --memory=4096 --driver=docker
else
    echo "[1/7] Minikube already running"
fi

# 2. Enable required addons
echo "[2/7] Enabling addons..."
minikube addons enable ingress
minikube addons enable metrics-server

# 3. Point Docker to minikube's Docker daemon
echo "[3/7] Configuring Docker to use minikube..."
eval $(minikube docker-env)

# 4. Build Docker images inside minikube
echo "[4/7] Building Docker images..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "  Building backend API image..."
docker build -t kiramopay-api:latest "$PROJECT_ROOT/backend"

echo "  Building frontend web image..."
docker build -t kiramopay-web:latest "$PROJECT_ROOT"

# 5. Deploy with Helm
echo "[5/7] Deploying with Helm..."
helm upgrade --install kiramopay "$SCRIPT_DIR/helm/kiramopay" \
    --namespace kiramopay \
    --create-namespace \
    --wait \
    --timeout 120s

# 6. Wait for pods to be ready
echo "[6/7] Waiting for pods..."
kubectl wait --for=condition=ready pod -l app=kiramopay-api -n kiramopay --timeout=60s
kubectl wait --for=condition=ready pod -l app=kiramopay-web -n kiramopay --timeout=60s

# 7. Add /etc/hosts entry
MINIKUBE_IP=$(minikube ip)
echo "[7/7] Setup complete!"
echo ""
echo "=== Deployment Summary ==="
kubectl get pods -n kiramopay
echo ""
echo "=== Access ==="
echo "Add this to your /etc/hosts (or C:\\Windows\\System32\\drivers\\etc\\hosts):"
echo "  $MINIKUBE_IP  kiramopay.local"
echo ""
echo "Then visit:"
echo "  Frontend: http://kiramopay.local"
echo "  API:      http://kiramopay.local/api/v1"
echo "  Health:   http://kiramopay.local/health"
echo "  Metrics:  http://kiramopay.local/metrics"
echo "  Swagger:  http://kiramopay.local/api/docs"
echo ""
echo "Or use minikube tunnel:"
echo "  minikube tunnel"
