package websocket

import (
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// TestDisconnectUser_ClosesTheLiveSocket is the point of the whole thing: an
// account gets blocked and its already-open, already-authenticated socket must
// die right there, not sixty seconds later when the pong deadline expires.
func TestDisconnectUser_ClosesTheLiveSocket(t *testing.T) {
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
	defer conn.Close()

	if err := conn.WriteJSON(AuthMessage{Type: "auth", Token: pair.AccessToken}); err != nil {
		t.Fatalf("write auth: %v", err)
	}
	if got := readType(t, conn); got != "auth_ok" {
		t.Fatalf("auth handshake: got %q, want auth_ok", got)
	}

	if closed := hub.DisconnectUser("user-42"); closed != 1 {
		t.Fatalf("DisconnectUser closed %d connections, want 1", closed)
	}

	// The client's read must fail promptly. pongWait is 60s, so anything that
	// only relies on the ping deadline would blow this budget by far.
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("the socket stayed alive after DisconnectUser")
	}

	// The natural teardown still runs: readPump's defer reaches the unregister
	// case, which is the only place that drops the maps and closes send. If
	// DisconnectUser had done any of that itself this would panic or hang.
	deadline := time.Now().Add(2 * time.Second)
	for {
		hub.mu.RLock()
		left := len(hub.userClients["user-42"])
		total := len(hub.clients)
		hub.mu.RUnlock()
		if left == 0 && total == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the hub never cleaned up: userClients=%d clients=%d", left, total)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// TestDisconnectUser_OtherUsersSurvive guards the obvious blast radius: cutting
// one blocked account must not touch anyone else's socket.
func TestDisconnectUser_OtherUsersSurvive(t *testing.T) {
	hub := NewHub(testLogger())
	go hub.Run()
	jwt := newTestJWT()
	srv := authWSServer(hub, jwt, fakeChecker{})
	defer srv.Close()

	dial := func(userID string) *websocket.Conn {
		pair, err := jwt.GenerateTokenPair(userID)
		if err != nil {
			t.Fatalf("token: %v", err)
		}
		conn := dialWS(t, srv)
		if err := conn.WriteJSON(AuthMessage{Type: "auth", Token: pair.AccessToken}); err != nil {
			t.Fatalf("write auth: %v", err)
		}
		if got := readType(t, conn); got != "auth_ok" {
			t.Fatalf("auth handshake for %s: got %q", userID, got)
		}
		return conn
	}

	bloqueado := dial("user-blocked")
	defer bloqueado.Close()
	otro := dial("user-other")
	defer closeWS(otro)

	hub.DisconnectUser("user-blocked")

	hub.SendToUser("user-other", map[string]any{"type": "notification"})
	if got := readType(t, otro); got != "notification" {
		t.Fatalf("the untouched user stopped receiving: got %q", got)
	}
}

// TestSlowClientEviction_LeavesNoOrphan is the other half of the same hazard.
// A client whose buffer is full during a price broadcast gets dropped; if that
// eviction forgot h.userClients — as it did — the client stayed listed there
// with an already-closed channel, and the next per-user send panicked on it.
// That is the same crash SendToUser's locking is meant to rule out, reached
// from the other side.
func TestSlowClientEviction_LeavesNoOrphan(t *testing.T) {
	hub := NewHub(testLogger())
	go hub.Run()

	client := &Client{hub: hub, send: make(chan []byte, 1)}
	hub.mu.Lock()
	hub.clients[client] = true
	hub.mu.Unlock()
	hub.RegisterUserClient(client, "user-lento")

	// Fill the buffer so the broadcast's non-blocking send falls through to
	// the eviction branch.
	client.send <- []byte("ocupado")
	hub.Broadcast(map[string]any{"type": "prices"})

	deadline := time.Now().Add(2 * time.Second)
	for {
		hub.mu.RLock()
		total := len(hub.clients)
		porUsuario := len(hub.userClients["user-lento"])
		hub.mu.RUnlock()
		if total == 0 {
			if porUsuario != 0 {
				t.Fatalf("the evicted client is still listed under its user: %d", porUsuario)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the slow client was never evicted")
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Would panic on a closed channel if the user still pointed at it.
	hub.SendToUser("user-lento", map[string]any{"type": "notification"})
}

// TestDisconnectUser_NoConnectionsIsHarmless covers the two cheap edge cases:
// an unknown user, and the hand-built clients the other hub tests use, whose
// conn is nil. Both must be no-ops rather than panics.
func TestDisconnectUser_NoConnectionsIsHarmless(t *testing.T) {
	hub := NewHub(testLogger())

	if closed := hub.DisconnectUser("nobody"); closed != 0 {
		t.Fatalf("DisconnectUser on an unknown user closed %d", closed)
	}

	client := &Client{hub: hub, send: make(chan []byte, 1)}
	hub.mu.Lock()
	hub.clients[client] = true
	hub.mu.Unlock()
	hub.RegisterUserClient(client, "user-nil-conn")

	if closed := hub.DisconnectUser("user-nil-conn"); closed != 0 {
		t.Fatalf("a client without a connection reported %d closed", closed)
	}
}
