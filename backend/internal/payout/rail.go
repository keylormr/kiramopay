package payout

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
)

// RailStatus is the settlement state a rail reports for a submitted payout.
// It is deliberately coarse: the domain only needs to know whether the money
// has definitively left (completed), been definitively rejected (failed), or
// is still in flight (pending, resolve later via Rail.Status).
type RailStatus string

const (
	RailPending   RailStatus = "pending"   // accepted, still settling — poll Status later
	RailCompleted RailStatus = "completed" // settled at the destination
	RailFailed    RailStatus = "failed"    // definitively rejected — safe to refund
)

// PayoutRequest is what the domain hands a rail to execute. Amounts are minor
// units, consistent with the ledger. IdempotencyKey lets a rail dedupe a
// retried Send so a transport timeout never double-sends.
type PayoutRequest struct {
	PayoutID       string      // our internal payout id, for traceability
	AmountMinor    int64       // minor units (e.g. CRC/USD cents)
	Currency       string      // ISO-like code
	Destination    Destination // rail-typed beneficiary
	IdempotencyKey string      // stable dedupe key for the rail
}

// PayoutResult is a rail's answer to Send/Status.
type PayoutResult struct {
	ExternalID string     // the rail's own id for the payment
	Status     RailStatus // settlement state
	Message    string     // human-readable detail (e.g. rejection reason)
}

// Rail is a settlement network money can leave the platform through. Adding a
// real rail (SINPE participant, dLocal, Circle/USDC, …) is implementing this
// interface and registering it — nothing else in the domain changes.
//
// Send MUST be idempotent on PayoutRequest.IdempotencyKey: a retried Send for
// the same key must not move money twice and should return the same
// ExternalID. Send should return a non-nil error ONLY for ambiguous, transient
// failures (network/timeout) where it is unknown whether the money moved; a
// definitive rejection must be reported as a nil error with Status==RailFailed
// so the domain can safely refund. This distinction is what prevents
// double-spends on outbound payments.
type Rail interface {
	Name() string
	Send(ctx context.Context, req PayoutRequest) (PayoutResult, error)
	Status(ctx context.Context, externalID string) (PayoutResult, error)
}

// ErrRailExists is returned by Registry.Register for a duplicate name.
var ErrRailExists = errors.New("payout: rail already registered")

// Registry is the name→Rail lookup the service consults at submit time. It is
// safe for concurrent use; rails are registered at startup and read per
// request.
type Registry struct {
	mu    sync.RWMutex
	rails map[string]Rail
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry {
	return &Registry{rails: make(map[string]Rail)}
}

// Register adds a rail under its Name(). It panics on a nil rail or empty name
// (a programming error at wiring time) and returns ErrRailExists on a
// duplicate so misconfiguration is loud rather than silently shadowing.
func (r *Registry) Register(rail Rail) error {
	if rail == nil {
		panic("payout: Register(nil rail)")
	}
	name := rail.Name()
	if strings.TrimSpace(name) == "" {
		panic("payout: Register rail with empty Name()")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.rails[name]; ok {
		return ErrRailExists
	}
	r.rails[name] = rail
	return nil
}

// Get resolves a rail by name.
func (r *Registry) Get(name string) (Rail, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	rail, ok := r.rails[name]
	return rail, ok
}

// Names returns the registered rail names, sorted for stable output.
func (r *Registry) Names() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.rails))
	for name := range r.rails {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// ── MockRail ────────────────────────────────────────────────────────────────

// MockRail is a deterministic in-memory rail for development and tests. The
// outcome is decided by the destination account prefix, so tests are fully
// reproducible without any external service:
//
//	"fail…"  → RailFailed     (definitive rejection → domain refunds)
//	"pend…"  → RailPending    (in flight → resolves to completed when Settle is called)
//	"err…"   → transport error (ambiguous → domain leaves it processing, no refund)
//	otherwise → RailCompleted (settled immediately)
//
// It keeps a small state map keyed by external id so Status() reflects later
// settlement and Settle() can advance a pending payment, exercising the
// asynchronous path end to end.
type MockRail struct {
	name string

	mu    sync.Mutex
	state map[string]RailStatus // externalID → current status
}

// NewMockRail returns a MockRail named "mock".
func NewMockRail() *MockRail {
	return &MockRail{name: "mock", state: make(map[string]RailStatus)}
}

func (m *MockRail) Name() string { return m.name }

// externalIDFor derives a stable external id from our payout id so a retried
// Send (same payout) yields the same id — i.e. Send is idempotent.
func externalIDFor(payoutID string) string {
	return "mock_" + strings.ReplaceAll(payoutID, "-", "")
}

// ErrMockTransport simulates an ambiguous network failure (unknown whether the
// money moved). The domain must NOT refund on this — it leaves the payout
// processing for later reconciliation.
var ErrMockTransport = errors.New("payout: mock rail transport error")

// Send classifies the request by destination prefix and records state.
func (m *MockRail) Send(_ context.Context, req PayoutRequest) (PayoutResult, error) {
	acct := strings.ToLower(strings.TrimSpace(req.Destination.Account))
	ext := externalIDFor(req.PayoutID)

	switch {
	case strings.HasPrefix(acct, "err"):
		// Ambiguous transport failure: no external id, no state recorded.
		return PayoutResult{}, ErrMockTransport
	case strings.HasPrefix(acct, "fail"):
		m.set(ext, RailFailed)
		return PayoutResult{ExternalID: ext, Status: RailFailed, Message: "mock: destination rejected"}, nil
	case strings.HasPrefix(acct, "pend"):
		m.set(ext, RailPending)
		return PayoutResult{ExternalID: ext, Status: RailPending, Message: "mock: settling"}, nil
	default:
		m.set(ext, RailCompleted)
		return PayoutResult{ExternalID: ext, Status: RailCompleted, Message: "mock: settled"}, nil
	}
}

// Status returns the recorded settlement state for an external id.
func (m *MockRail) Status(_ context.Context, externalID string) (PayoutResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	st, ok := m.state[externalID]
	if !ok {
		return PayoutResult{}, ErrNotFound
	}
	return PayoutResult{ExternalID: externalID, Status: st}, nil
}

// Settle advances a pending external id to completed (test/dev hook to
// simulate the rail confirming settlement asynchronously).
func (m *MockRail) Settle(externalID string) { m.set(externalID, RailCompleted) }

// Fail advances a pending external id to failed (test/dev hook).
func (m *MockRail) Fail(externalID string) { m.set(externalID, RailFailed) }

func (m *MockRail) set(externalID string, st RailStatus) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state[externalID] = st
}
