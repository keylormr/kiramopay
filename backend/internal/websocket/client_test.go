package websocket

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	jwtpkg "github.com/kiramopay/backend/pkg/jwt"
)

// fakeChecker stands in for the auth repository's jti revocation check.
type fakeChecker struct {
	revoked bool
	err     error
}

func (f fakeChecker) IsAccessJTIRevoked(_ context.Context, _ string) (bool, error) {
	return f.revoked, f.err
}

func newTestJWT() *jwtpkg.Manager {
	return jwtpkg.NewManager("test-secret-bytes-please-rotate-0001", time.Hour, 24*time.Hour)
}

func authWSServer(hub *Hub, jwt *jwtpkg.Manager, checker JTIChecker) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ServeWsAuthenticated(hub, testLogger(), jwt, checker, w, r)
	}))
}

func dialWS(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	return conn
}

// closeWS shuts a test connection down with a normal close handshake so the
// server's read loop exits cleanly instead of logging a 1006 abnormal closure.
func closeWS(conn *websocket.Conn) {
	_ = conn.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
	_ = conn.Close()
}

// readType reads one frame and returns its "type" field.
func readType(t *testing.T, conn *websocket.Conn) string {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var env struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatalf("unmarshal %q: %v", data, err)
	}
	return env.Type
}

// assertNoMessage fails if a frame arrives within a short window.
func assertNoMessage(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("expected no message, but one was delivered")
	}
}

// TestServeWsAuthenticated_AuthThenDelivery is the end-to-end happy path: a
// client opens the socket, authenticates with a real access token, and then
// receives a notification fanned out via SendToUser — exactly the flow the
// notification service drives in production.
func TestServeWsAuthenticated_AuthThenDelivery(t *testing.T) {
	hub := NewHub(testLogger())
	go hub.Run()

	jwt := newTestJWT()
	srv := authWSServer(hub, jwt, fakeChecker{})
	defer srv.Close()

	pair, err := jwt.GenerateTokenPair("user-42")
	if err != nil {
		t.Fatalf("token: %v", err)
	}

	conn := dialWS(t, srv)
	defer closeWS(conn)

	if err := conn.WriteJSON(AuthMessage{Type: "auth", Token: pair.AccessToken}); err != nil {
		t.Fatalf("write auth: %v", err)
	}
	if got := readType(t, conn); got != "auth_ok" {
		t.Fatalf("auth handshake: got %q, want auth_ok", got)
	}

	// auth_ok is sent only after RegisterUserClient, so the user is reachable now.
	hub.SendToUser("user-42", map[string]any{
		"type": "notification",
		"notification": map[string]any{
			"id": "n1", "title": "SINPE recibido", "message": "Recibiste 5,000 CRC",
			"type": "transaction", "date": "24/6/2026", "read": false,
		},
	})

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read notification: %v", err)
	}
	var env struct {
		Type         string `json:"type"`
		Notification struct {
			ID      string `json:"id"`
			Message string `json:"message"`
		} `json:"notification"`
	}
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatalf("unmarshal %q: %v", data, err)
	}
	if env.Type != "notification" || env.Notification.ID != "n1" || env.Notification.Message != "Recibiste 5,000 CRC" {
		t.Fatalf("unexpected delivery: %s", data)
	}
}

// TestServeWsAuthenticated_InvalidToken_NotRegistered verifies a malformed token
// yields auth_error and never registers the socket, so per-user sends miss it.
func TestServeWsAuthenticated_InvalidToken_NotRegistered(t *testing.T) {
	hub := NewHub(testLogger())
	go hub.Run()

	srv := authWSServer(hub, newTestJWT(), fakeChecker{})
	defer srv.Close()

	conn := dialWS(t, srv)
	defer closeWS(conn)

	if err := conn.WriteJSON(AuthMessage{Type: "auth", Token: "not-a-jwt"}); err != nil {
		t.Fatalf("write: %v", err)
	}
	if got := readType(t, conn); got != "auth_error" {
		t.Fatalf("got %q, want auth_error", got)
	}

	hub.SendToUser("user-42", map[string]any{"type": "notification"})
	assertNoMessage(t, conn)
}

// TestServeWsAuthenticated_RevokedToken_NotRegistered verifies a valid token
// whose session was revoked is rejected (fail-closed) and not registered.
func TestServeWsAuthenticated_RevokedToken_NotRegistered(t *testing.T) {
	hub := NewHub(testLogger())
	go hub.Run()

	jwt := newTestJWT()
	srv := authWSServer(hub, jwt, fakeChecker{revoked: true})
	defer srv.Close()

	pair, err := jwt.GenerateTokenPair("user-99")
	if err != nil {
		t.Fatalf("token: %v", err)
	}

	conn := dialWS(t, srv)
	defer closeWS(conn)

	if err := conn.WriteJSON(AuthMessage{Type: "auth", Token: pair.AccessToken}); err != nil {
		t.Fatalf("write: %v", err)
	}
	if got := readType(t, conn); got != "auth_error" {
		t.Fatalf("got %q, want auth_error", got)
	}

	hub.SendToUser("user-99", map[string]any{"type": "notification"})
	assertNoMessage(t, conn)
}

// TestServeWs_PublicFeed_IgnoresAuth confirms /ws/prices stays public: an auth
// message never registers the connection to a user, but broadcasts still flow.
func TestServeWs_PublicFeed_IgnoresAuth(t *testing.T) {
	hub := NewHub(testLogger())
	go hub.Run()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ServeWs(hub, testLogger(), w, r)
	}))
	defer srv.Close()

	conn := dialWS(t, srv)
	defer closeWS(conn)

	// Even a syntactically valid token must not grant identity on the price feed.
	pair, err := newTestJWT().GenerateTokenPair("user-7")
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	if err := conn.WriteJSON(AuthMessage{Type: "auth", Token: pair.AccessToken}); err != nil {
		t.Fatalf("write: %v", err)
	}

	// Let the read loop process the (ignored) auth message before asserting.
	time.Sleep(100 * time.Millisecond)
	hub.mu.RLock()
	_, registered := hub.userClients["user-7"]
	hub.mu.RUnlock()
	if registered {
		t.Fatal("public feed must not register a user from an auth message")
	}

	hub.Broadcast(map[string]any{"type": "price_update"})
	if got := readType(t, conn); got != "price_update" {
		t.Fatalf("got %q, want price_update", got)
	}
}

func TestOriginAllowed(t *testing.T) {
	SetAllowedOrigins([]string{"https://kiramopay.vercel.app"})
	defer SetAllowedOrigins(nil)
	cases := []struct {
		origin string
		want   bool
	}{
		{"", true},                             // native / non-browser (no Origin)
		{"https://kiramopay.vercel.app", true}, // allowlisted
		{"capacitor://localhost", true},        // native webview
		{"ionic://localhost", true},
		{"http://localhost:9999", true}, // local dev
		{"http://127.0.0.1:9999", true},
		{"https://evil.com", false},                     // cross-origin
		{"https://localhost.evil.com", false},           // prefix-bypass attempt
		{"http://localhostevil.com", false},             // prefix-bypass attempt
		{"https://kiramopay.vercel.app.evil.com", false}, // suffix-bypass attempt
	}
	for _, c := range cases {
		r := httptest.NewRequest(http.MethodGet, "/ws/notifications", nil)
		if c.origin != "" {
			r.Header.Set("Origin", c.origin)
		}
		if got := originAllowed(r); got != c.want {
			t.Errorf("originAllowed(%q) = %v, want %v", c.origin, got, c.want)
		}
	}
}
