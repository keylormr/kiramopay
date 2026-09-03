package websocket

import (
	"encoding/json"
	"log/slog"
	"sync"
)

// Hub manages WebSocket connections and broadcasts messages.
type Hub struct {
	clients     map[*Client]bool
	userClients map[string][]*Client // userID -> clients
	broadcast   chan []byte
	register    chan *Client
	unregister  chan *Client
	mu          sync.RWMutex
	logger      *slog.Logger
}

// NewHub creates a new Hub.
func NewHub(logger *slog.Logger) *Hub {
	return &Hub{
		clients:     make(map[*Client]bool),
		userClients: make(map[string][]*Client),
		broadcast:   make(chan []byte, 256),
		register:    make(chan *Client),
		unregister:  make(chan *Client),
		logger:      logger,
	}
}

// Run starts the hub's event loop.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			h.logger.Info("WebSocket client connected", "total", h.ClientCount())

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)

				// Clean up user tracking
				if client.UserID != "" {
					clients := h.userClients[client.UserID]
					for i, c := range clients {
						if c == client {
							h.userClients[client.UserID] = append(clients[:i], clients[i+1:]...)
							break
						}
					}
					if len(h.userClients[client.UserID]) == 0 {
						delete(h.userClients, client.UserID)
					}
				}
			}
			h.mu.Unlock()
			h.logger.Info("WebSocket client disconnected", "total", h.ClientCount())

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					h.mu.RUnlock()
					h.mu.Lock()
					delete(h.clients, client)
					close(client.send)
					h.mu.Unlock()
					h.mu.RLock()
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Broadcast sends a message to all connected clients.
func (h *Hub) Broadcast(data interface{}) {
	msg, err := json.Marshal(data)
	if err != nil {
		h.logger.Error("Failed to marshal broadcast", "error", err)
		return
	}
	h.broadcast <- msg
}

// ClientCount returns the number of connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// RegisterUserClient associates a client with a user ID.
func (h *Hub) RegisterUserClient(client *Client, userID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	client.UserID = userID
	h.userClients[userID] = append(h.userClients[userID], client)
}

// DisconnectUser closes every open connection of a user, right away. It is
// called when the account becomes blocked: a socket authenticates ONCE, on its
// first message, and neither /ws/notifications nor /ws/prices goes through the
// middleware that rejects blocked accounts — so without this cut an already
// open socket would keep receiving notifications until the client closed it.
//
// It closes the connection and NOTHING else: it does not touch the maps and
// does not close client.send. Those two steps belong solely to the unregister
// case of Run, reached only by readPump's defer when its ReadMessage fails —
// which is exactly what this Close causes. Closing send here would race that
// path ("close of closed channel") and whoever is writing to it.
//
// The list is copied under the lock and the connections are closed OUTSIDE it,
// as SendToUser does: holding h.mu while the close triggers the unregister
// would leave Run waiting for the Lock and freeze the whole hub.
//
// Returns how many connections were closed. It only reaches identified sockets
// (/ws/notifications); /ws/prices is a public feed that never registers a user
// and carries no personal data.
func (h *Hub) DisconnectUser(userID string) int {
	h.mu.RLock()
	clients := make([]*Client, len(h.userClients[userID]))
	copy(clients, h.userClients[userID])
	h.mu.RUnlock()

	closed := 0
	for _, client := range clients {
		// conn is nil in the clients the hub tests build by hand.
		if client == nil || client.conn == nil {
			continue
		}
		_ = client.conn.Close()
		closed++
	}
	if closed > 0 {
		h.logger.Info("WebSocket connections closed for blocked user", "user_id", userID, "closed", closed)
	}
	return closed
}

// SendToUser sends a message to all connections of a specific user.
func (h *Hub) SendToUser(userID string, data interface{}) {
	msg, err := json.Marshal(data)
	if err != nil {
		h.logger.Error("Failed to marshal user message", "error", err)
		return
	}

	h.mu.RLock()
	clients := h.userClients[userID]
	h.mu.RUnlock()

	for _, client := range clients {
		select {
		case client.send <- msg:
		default:
			h.logger.Warn("failed to send to user client", "user_id", userID)
		}
	}
}
