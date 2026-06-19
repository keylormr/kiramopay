#!/bin/bash
# Deploy Prometheus + Grafana monitoring stack to minikube
# Run this after deploy-minikube.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Deploying Monitoring Stack ==="

# Apply Prometheus (config + alerting rules)
echo "[1/4] Deploying Prometheus..."
kubectl apply -f "$SCRIPT_DIR/prometheus-config.yaml"
kubectl apply -f "$SCRIPT_DIR/alert-rules.yaml"
kubectl apply -f "$SCRIPT_DIR/prometheus.yaml"
# NOTE: the prometheus Deployment must mount the `prometheus-rules` ConfigMap at
# /etc/prometheus/rules (loaded via rule_files in prometheus-config.yaml). See
# prometheus.yaml — add a volume/volumeMount if not already present.

# Apply Grafana (datasource, provider, dashboards)
echo "[2/4] Deploying Grafana..."
kubectl apply -f "$SCRIPT_DIR/grafana-config.yaml"
kubectl apply -f "$SCRIPT_DIR/dashboard-red-slo.yaml"
kubectl apply -f "$SCRIPT_DIR/grafana.yaml"
# NOTE: each grafana-dashboard-* ConfigMap must be mounted under
# /var/lib/grafana/dashboards for the file provider to pick it up.

# Wait for pods
echo "[3/4] Waiting for pods..."
kubectl wait --for=condition=ready pod -l app=prometheus -n kiramopay --timeout=60s
kubectl wait --for=condition=ready pod -l app=grafana -n kiramopay --timeout=60s

# Show access info
echo "[4/4] Setup complete!"
echo ""
echo "=== Monitoring Access ==="
echo ""
echo "Prometheus:"
PROM_PORT=$(kubectl get svc prometheus -n kiramopay -o jsonpath='{.spec.ports[0].nodePort}')
echo "  URL: http://$(minikube ip):$PROM_PORT"
echo "  Or:  kubectl port-forward svc/prometheus 9090:9090 -n kiramopay"
echo "  Then: http://localhost:9090"
echo ""
echo "Grafana:"
GRAF_PORT=$(kubectl get svc grafana -n kiramopay -o jsonpath='{.spec.ports[0].nodePort}')
echo "  URL: http://$(minikube ip):$GRAF_PORT"
echo "  Or:  kubectl port-forward svc/grafana 3000:3000 -n kiramopay"
echo "  Then: http://localhost:3000"
echo "  Login: admin / kiramopay"
echo ""
echo "=== Pod Status ==="
kubectl get pods -n kiramopay -l 'app in (prometheus,grafana)'
