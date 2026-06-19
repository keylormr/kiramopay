package payout

import (
	"context"
	"errors"
	"testing"
)

func TestRegistryRegisterGet(t *testing.T) {
	r := NewRegistry()
	if err := r.Register(NewMockRail()); err != nil {
		t.Fatalf("register: %v", err)
	}
	// Duplicate name is rejected.
	if err := r.Register(NewMockRail()); !errors.Is(err, ErrRailExists) {
		t.Errorf("duplicate register: got %v, want ErrRailExists", err)
	}
	rail, ok := r.Get("mock")
	if !ok || rail.Name() != "mock" {
		t.Errorf("get mock: ok=%v name=%q", ok, rail.Name())
	}
	if _, ok := r.Get("nope"); ok {
		t.Errorf("get unknown rail should be false")
	}
	names := r.Names()
	if len(names) != 1 || names[0] != "mock" {
		t.Errorf("names = %v, want [mock]", names)
	}
}

func TestRegistryRegisterNilPanics(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Errorf("Register(nil) should panic")
		}
	}()
	_ = NewRegistry().Register(nil)
}

func TestMockRailClassification(t *testing.T) {
	m := NewMockRail()
	ctx := context.Background()
	cases := []struct {
		account string
		want    RailStatus
		wantErr bool
	}{
		{"123456789", RailCompleted, false},
		{"fail-001", RailFailed, false},
		{"FAIL-UPPER", RailFailed, false},
		{"pending-77", RailPending, false},
		{"err-net", "", true},
	}
	for _, tc := range cases {
		res, err := m.Send(ctx, PayoutRequest{
			PayoutID:    "11111111-2222-3333-4444-555555555555",
			AmountMinor: 1000, Currency: "CRC",
			Destination: Destination{Account: tc.account, Name: "Bob"},
		})
		if tc.wantErr {
			if !errors.Is(err, ErrMockTransport) {
				t.Errorf("account %q: want transport error, got %v", tc.account, err)
			}
			continue
		}
		if err != nil {
			t.Errorf("account %q: unexpected err %v", tc.account, err)
			continue
		}
		if res.Status != tc.want {
			t.Errorf("account %q: status %q, want %q", tc.account, res.Status, tc.want)
		}
		if res.ExternalID == "" {
			t.Errorf("account %q: empty external id", tc.account)
		}
	}
}

func TestMockRailDeterministicExternalID(t *testing.T) {
	m := NewMockRail()
	id := "abcd1234-0000-0000-0000-000000000000"
	r1, _ := m.Send(context.Background(), PayoutRequest{PayoutID: id, Destination: Destination{Account: "ok", Name: "x"}})
	r2, _ := m.Send(context.Background(), PayoutRequest{PayoutID: id, Destination: Destination{Account: "ok", Name: "x"}})
	if r1.ExternalID != r2.ExternalID {
		t.Errorf("external id not stable: %q vs %q", r1.ExternalID, r2.ExternalID)
	}
}

func TestMockRailStatusAndSettle(t *testing.T) {
	m := NewMockRail()
	ctx := context.Background()
	res, _ := m.Send(ctx, PayoutRequest{PayoutID: "p1", Destination: Destination{Account: "pending-9", Name: "x"}})
	if got, _ := m.Status(ctx, res.ExternalID); got.Status != RailPending {
		t.Errorf("status before settle = %q, want pending", got.Status)
	}
	m.Settle(res.ExternalID)
	if got, _ := m.Status(ctx, res.ExternalID); got.Status != RailCompleted {
		t.Errorf("status after settle = %q, want completed", got.Status)
	}
	if _, err := m.Status(ctx, "unknown"); !errors.Is(err, ErrNotFound) {
		t.Errorf("status unknown = %v, want ErrNotFound", err)
	}
}

func TestDestinationMaskedAccount(t *testing.T) {
	cases := map[string]string{
		"":             "****",
		"12":           "****",
		"1234":         "****",
		"123456":       "****3456",
		"CR05010200009": "****0009",
	}
	for in, want := range cases {
		if got := (Destination{Account: in}).MaskedAccount(); got != want {
			t.Errorf("mask(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCanTransition(t *testing.T) {
	ok := [][2]Status{
		{StatusPending, StatusProcessing},
		{StatusProcessing, StatusCompleted},
		{StatusProcessing, StatusFailed},
		{StatusProcessing, StatusPending},
	}
	for _, p := range ok {
		if !CanTransition(p[0], p[1]) {
			t.Errorf("expected %s→%s allowed", p[0], p[1])
		}
	}
	bad := [][2]Status{
		{StatusPending, StatusCompleted},
		{StatusPending, StatusFailed},
		{StatusCompleted, StatusProcessing},
		{StatusFailed, StatusProcessing},
		{StatusCompleted, StatusFailed},
	}
	for _, p := range bad {
		if CanTransition(p[0], p[1]) {
			t.Errorf("expected %s→%s rejected", p[0], p[1])
		}
	}
}

// normalizeAndValidate is exercised through a service whose only dependency it
// touches is the rail registry.
func validateSvc() *Service {
	r := NewRegistry()
	_ = r.Register(NewMockRail())
	return NewService(nil, nil, r, nil)
}

func TestNormalizeAndValidate(t *testing.T) {
	s := validateSvc()
	good := &CreateRequest{
		Rail: "mock", AmountMinor: 5000, Currency: "crc",
		Destination: Destination{Account: "123", Name: "Bob"}, IdempotencyKey: "k1",
	}
	if err := s.normalizeAndValidate(good); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}
	if good.Currency != "CRC" {
		t.Errorf("currency not upcased: %q", good.Currency)
	}

	bad := []struct {
		name string
		req  *CreateRequest
		want error
	}{
		{"nil", nil, ErrInvalidRequest},
		{"zero amount", &CreateRequest{Rail: "mock", AmountMinor: 0, Destination: Destination{Account: "1", Name: "B"}, IdempotencyKey: "k"}, ErrInvalidRequest},
		{"neg amount", &CreateRequest{Rail: "mock", AmountMinor: -1, Destination: Destination{Account: "1", Name: "B"}, IdempotencyKey: "k"}, ErrInvalidRequest},
		{"bad currency", &CreateRequest{Rail: "mock", AmountMinor: 1, Currency: "EUR", Destination: Destination{Account: "1", Name: "B"}, IdempotencyKey: "k"}, ErrInvalidRequest},
		{"no account", &CreateRequest{Rail: "mock", AmountMinor: 1, Destination: Destination{Name: "B"}, IdempotencyKey: "k"}, ErrInvalidRequest},
		{"no name", &CreateRequest{Rail: "mock", AmountMinor: 1, Destination: Destination{Account: "1"}, IdempotencyKey: "k"}, ErrInvalidRequest},
		{"no idem key", &CreateRequest{Rail: "mock", AmountMinor: 1, Destination: Destination{Account: "1", Name: "B"}}, ErrInvalidRequest},
		{"unknown rail", &CreateRequest{Rail: "ghost", AmountMinor: 1, Destination: Destination{Account: "1", Name: "B"}, IdempotencyKey: "k"}, ErrUnknownRail},
	}
	for _, tc := range bad {
		if err := s.normalizeAndValidate(tc.req); !errors.Is(err, tc.want) {
			t.Errorf("%s: got %v, want %v", tc.name, err, tc.want)
		}
	}
}

func TestRailSystemAccountCode(t *testing.T) {
	acc := railSystemAccount("mock", "crc")
	if acc.SystemCode != "SYSTEM:EXTERNAL:MOCK:CRC" {
		t.Errorf("system code = %q", acc.SystemCode)
	}
	if acc.UserID != "" {
		t.Errorf("system account should have empty UserID")
	}
}
