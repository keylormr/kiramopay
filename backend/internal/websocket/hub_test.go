package websocket

import (
	"log/slog"
	"os"
	"testing"
	"time"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
}

func TestHub_RegisterUserClient(t *testing.T) {
	hub := NewHub(testLogger())

	client := &Client{
		hub:  hub,
		send: make(chan []byte, 256),
	}

	// Register the client
	hub.mu.Lock()
	hub.clients[client] = true
	hub.mu.Unlock()

	// Associate with user
	hub.RegisterUserClient(client, "user-123")

	if client.UserID != "user-123" {
		t.Errorf("UserID = %q, want %q", client.UserID, "user-123")
	}

	hub.mu.RLock()
	clients := hub.userClients["user-123"]
	hub.mu.RUnlock()

	if len(clients) != 1 {
		t.Errorf("expected 1 client for user-123, got %d", len(clients))
	}
}

func TestHub_SendToUser_CorrectUserOnly(t *testing.T) {
	hub := NewHub(testLogger())

	client1 := &Client{hub: hub, send: make(chan []byte, 256)}
	client2 := &Client{hub: hub, send: make(chan []byte, 256)}

	hub.mu.Lock()
	hub.clients[client1] = true
	hub.clients[client2] = true
	hub.mu.Unlock()

	hub.RegisterUserClient(client1, "user-A")
	hub.RegisterUserClient(client2, "user-B")

	hub.SendToUser("user-A", map[string]string{"msg": "hello A"})

	// Give time for async send
	time.Sleep(50 * time.Millisecond)

	// Client1 should have message
	select {
	case msg := <-client1.send:
		if len(msg) == 0 {
			t.Error("client1 received empty message")
		}
	default:
		t.Error("client1 should have received a message")
	}

	// Client2 should NOT have message
	select {
	case <-client2.send:
		t.Error("client2 should not have received a message")
	default:
		// Expected
	}
}

func TestHub_SendToUser_MultipleConnections(t *testing.T) {
	hub := NewHub(testLogger())

	client1 := &Client{hub: hub, send: make(chan []byte, 256)}
	client2 := &Client{hub: hub, send: make(chan []byte, 256)}

	hub.mu.Lock()
	hub.clients[client1] = true
	hub.clients[client2] = true
	hub.mu.Unlock()

	// Both clients belong to the same user
	hub.RegisterUserClient(client1, "user-X")
	hub.RegisterUserClient(client2, "user-X")

	hub.SendToUser("user-X", map[string]string{"msg": "broadcast"})

	time.Sleep(50 * time.Millisecond)

	for i, c := range []*Client{client1, client2} {
		select {
		case msg := <-c.send:
			if len(msg) == 0 {
				t.Errorf("client%d received empty message", i+1)
			}
		default:
			t.Errorf("client%d should have received a message", i+1)
		}
	}
}

func TestHub_Disconnect_CleansUserClients(t *testing.T) {
	hub := NewHub(testLogger())
	go hub.Run()

	client := &Client{hub: hub, send: make(chan []byte, 256), UserID: "user-Z"}

	hub.register <- client
	time.Sleep(50 * time.Millisecond)

	hub.RegisterUserClient(client, "user-Z")

	hub.mu.RLock()
	count := len(hub.userClients["user-Z"])
	hub.mu.RUnlock()
	if count != 1 {
		t.Fatalf("expected 1 client before disconnect, got %d", count)
	}

	hub.unregister <- client
	time.Sleep(50 * time.Millisecond)

	hub.mu.RLock()
	count = len(hub.userClients["user-Z"])
	hub.mu.RUnlock()
	if count != 0 {
		t.Errorf("expected 0 clients after disconnect, got %d", count)
	}
}

func TestHub_UnauthenticatedClient_NoUserMessages(t *testing.T) {
	hub := NewHub(testLogger())

	// Unauthenticated client (no UserID)
	client := &Client{hub: hub, send: make(chan []byte, 256)}
	hub.mu.Lock()
	hub.clients[client] = true
	hub.mu.Unlock()

	// Send to a specific user
	hub.SendToUser("user-123", map[string]string{"msg": "secret"})

	time.Sleep(50 * time.Millisecond)

	select {
	case <-client.send:
		t.Error("unauthenticated client should not receive user messages")
	default:
		// Expected
	}
}
