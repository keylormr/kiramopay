package b2b

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"

	"github.com/kiramopay/backend/internal/audit"
)

// Service manages API keys and webhook endpoints, and is the EventSink that
// fans escrow (and future) events out into the delivery outbox.
type Service struct {
	repo        *Repository
	cipher      *Cipher
	auditLogger *audit.Logger
	logger      *slog.Logger
}

// NewService wires the platform service. cipher encrypts webhook secrets at
// rest; pass NewCipher(nil) for plaintext (legacy) behaviour.
func NewService(repo *Repository, cipher *Cipher, auditLogger *audit.Logger, logger *slog.Logger) *Service {
	if cipher == nil {
		cipher = NewCipher(nil)
	}
	return &Service{repo: repo, cipher: cipher, auditLogger: auditLogger, logger: logger}
}

// ── API keys ──────────────────────────────────────────────────────────────

// CreateKey mints a key for the user. The returned `full` value is the only
// time the plaintext key ever exists outside the merchant's hands. scopes is
// a comma-separated subset of AllScopes; empty grants everything.
func (s *Service) CreateKey(ctx context.Context, userID, name, scopes string) (key *APIKey, full string, err error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 100 {
		return nil, "", ErrInvalid
	}
	scopes, err = NormalizeScopes(scopes)
	if err != nil {
		return nil, "", err
	}
	fullKey, prefix, hash, err := GenerateKey()
	if err != nil {
		return nil, "", err
	}
	k, err := s.repo.CreateKey(ctx, userID, name, prefix, hash, scopes)
	if err != nil {
		return nil, "", err
	}
	s.auditEvent(userID, "api_key_created", k.ID, map[string]interface{}{
		"name": name, "prefix": prefix, "scopes": scopes,
	})
	return k, fullKey, nil
}

func (s *Service) ListKeys(ctx context.Context, userID string) ([]APIKey, error) {
	return s.repo.ListKeys(ctx, userID)
}

func (s *Service) RevokeKey(ctx context.Context, userID, keyID string) error {
	if err := s.repo.RevokeKey(ctx, userID, keyID); err != nil {
		return err
	}
	s.auditEvent(userID, "api_key_revoked", keyID, nil)
	return nil
}

// Authenticate resolves a presented key to its owning user and scope list.
func (s *Service) Authenticate(ctx context.Context, presented string) (userID, scopes string, err error) {
	if !LooksLikeKey(presented) {
		return "", "", ErrInvalidKey
	}
	return s.repo.ResolveKey(ctx, HashKey(presented))
}

// ── Webhook endpoints ─────────────────────────────────────────────────────

// CreateEndpoint registers a webhook URL. The signing secret is generated
// server-side and returned in the response (it stays readable to the owner).
func (s *Service) CreateEndpoint(ctx context.Context, userID, rawURL, events string) (*WebhookEndpoint, error) {
	// Reject non-public destinations (SSRF guard): no loopback/private/
	// link-local/cloud-metadata hosts. Re-validated at dial time in the
	// dispatcher to defeat DNS-rebinding.
	normalizedURL, err := validateWebhookURL(rawURL)
	if err != nil {
		return nil, ErrInvalid
	}
	if events = strings.TrimSpace(events); events == "" {
		events = "*"
	}
	secret, err := GenerateSecret()
	if err != nil {
		return nil, err
	}
	stored, err := s.cipher.Encrypt(secret)
	if err != nil {
		return nil, err
	}
	e, err := s.repo.CreateEndpoint(ctx, userID, normalizedURL, stored, events)
	if err != nil {
		return nil, err
	}
	// Hand the PLAINTEXT secret back to the caller (shown once); at rest only
	// the encrypted form exists.
	e.Secret = secret
	s.auditEvent(userID, "webhook_endpoint_created", e.ID, map[string]interface{}{"url": normalizedURL})
	return e, nil
}

func (s *Service) ListEndpoints(ctx context.Context, userID string) ([]WebhookEndpoint, error) {
	return s.repo.ListEndpoints(ctx, userID)
}

func (s *Service) DeleteEndpoint(ctx context.Context, userID, endpointID string) error {
	if err := s.repo.DeleteEndpoint(ctx, userID, endpointID); err != nil {
		return err
	}
	s.auditEvent(userID, "webhook_endpoint_deleted", endpointID, nil)
	return nil
}

func (s *Service) RecentDeliveries(ctx context.Context, userID, endpointID string, limit int) ([]Delivery, error) {
	return s.repo.RecentDeliveries(ctx, userID, endpointID, limit)
}

// ── EventSink ─────────────────────────────────────────────────────────────

// Emit implements the event-sink contract used by emitting domains (escrow).
// It enqueues one delivery per matching active endpoint of the user;
// best-effort — emitting never fails the business operation.
func (s *Service) Emit(ctx context.Context, userID, eventType string, payload any) {
	endpoints, err := s.repo.ActiveEndpointsFor(ctx, userID, eventType)
	if err != nil {
		s.log("webhook fanout failed", "error", err, "event", eventType)
		return
	}
	if len(endpoints) == 0 {
		return
	}
	body, err := json.Marshal(map[string]any{
		"event": eventType,
		"data":  payload,
	})
	if err != nil {
		s.log("webhook payload marshal failed", "error", err, "event", eventType)
		return
	}
	for _, e := range endpoints {
		if err := s.repo.EnqueueDelivery(ctx, e.ID, eventType, body); err != nil {
			s.log("webhook enqueue failed", "error", err, "endpoint", e.ID)
		}
	}
}

func (s *Service) log(msg string, args ...any) {
	if s.logger != nil {
		s.logger.Warn(msg, args...)
	}
}

func (s *Service) auditEvent(userID, action, resourceID string, details map[string]interface{}) {
	if s.auditLogger == nil {
		return
	}
	if details == nil {
		details = map[string]interface{}{}
	}
	s.auditLogger.Log(audit.Event{
		UserID:       userID,
		Action:       action,
		ResourceType: "b2b",
		ResourceID:   resourceID,
		Details:      details,
		RiskLevel:    "medium",
	})
}
