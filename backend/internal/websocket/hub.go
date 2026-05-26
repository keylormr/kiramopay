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
