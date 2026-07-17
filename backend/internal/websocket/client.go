package websocket

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/gorilla/websocket"
	jwtpkg "github.com/kiramopay/backend/pkg/jwt"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512

	// authMessageSize bounds reads on an authenticated socket. A signed access
	// token plus the {"type":"auth","token":"…"} envelope exceeds the 512-byte
	// price-feed limit, so the per-user channel needs a larger ceiling.
	authMessageSize = 4096
)

// allowedOrigins is the WebSocket Origin allowlist (CSWSH defense), configured
// once at startup from the CORS origins. Empty until SetAllowedOrigins runs.
var allowedOrigins []string

// SetAllowedOrigins configures the WebSocket Origin allowlist. Call once at
// startup with cfg.CORS.Origins.
func SetAllowedOrigins(origins []string) { allowedOrigins = origins }

// originAllowed enforces the Origin allowlist for the upgrade handshake. A
// missing Origin (native apps / non-browser clients, which carry no ambient
// cookie credential) is allowed; a browser Origin must be allowlisted or a
// native/local-dev origin, otherwise the cross-origin handshake is rejected.
func originAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	// Exact allowlist match (configured web origins) first.
	for _, o := range allowedOrigins {
		if o == origin {
			return true
		}
	}
	// Parse so the host is compared exactly — a raw prefix would also match an
	// attacker domain like https://localhost.evil.com.
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	switch u.Scheme {
	case "capacitor", "ionic", "file":
		return true // native app webviews; not web-attacker registerable
	case "http", "https":
		host := u.Hostname()
		return host == "localhost" || host == "127.0.0.1"
	default:
		return false
	}
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     originAllowed,
}

// JTIChecker reports whether an access token's jti has been revoked. It mirrors
// middleware.JTIChecker so the per-user socket enforces the same session
// revocation as the REST API (the auth repository satisfies both interfaces).
type JTIChecker interface {
	IsAccessJTIRevoked(ctx context.Context, jti string) (bool, error)
}

// wsAuth carries the dependencies an authenticated socket needs to verify the
// client. It is nil for the public price feed, which leaves that path untouched.
type wsAuth struct {
	jwt     *jwtpkg.Manager
	checker JTIChecker
}

// Client represents a WebSocket connection.
type Client struct {
	hub       *Hub
	conn      *websocket.Conn
	send      chan []byte
	logger    *slog.Logger
	auth      *wsAuth // non-nil → authenticated per-user channel
	readLimit int64
	UserID    string // Set after a successful auth message
}

// AuthMessage is sent by the client to authenticate.
type AuthMessage struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

// Control frames returned to the client after an auth attempt. The frontend
// hook tolerates these (NotificationWsMessage) and ignores them for rendering.
var (
	authOKMessage    = []byte(`{"type":"auth_ok"}`)
	authErrorMessage = []byte(`{"type":"auth_error"}`)
)

// readPump pumps messages from the websocket connection to the hub.
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(c.readLimit)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	authenticated := false
	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				c.logger.Error("WebSocket read error", "error", err)
			}
			break
		}

		var msg AuthMessage
		if err := json.Unmarshal(message, &msg); err != nil || msg.Type != "auth" {
			continue
		}

		// /ws/prices is a PUBLIC price feed and carries no per-user data, so an
		// auth message there is NOT trusted, validated, or logged and grants no
		// identity (c.auth is nil → the client is never registered to a user).
		if c.auth == nil {
			c.logger.Debug("WebSocket auth message ignored (public price feed)")
			continue
		}
		if authenticated {
			continue // ignore re-auth on an already-identified socket
		}
		if c.authenticate(msg.Token) {
			authenticated = true
		}
	}
}

// authenticate validates an access token from an auth message. On success it
// registers the connection to the verified user — so SendToUser reaches it —
// and returns true. It mirrors middleware.AuthWithSessionCheck: signature +
// access-type validation via the JWT manager, then a fail-closed jti
// revocation check.
func (c *Client) authenticate(token string) bool {
	claims, err := c.auth.jwt.ValidateAccess(token)
	if err != nil {
		c.logger.Debug("WebSocket auth failed: invalid token")
		c.trySend(authErrorMessage)
		return false
	}
	if c.auth.checker != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		revoked, err := c.auth.checker.IsAccessJTIRevoked(ctx, claims.ID)
		cancel()
		if err != nil || revoked {
			// Fail closed, exactly as the REST middleware does.
			c.logger.Debug("WebSocket auth rejected", "revoked", revoked, "error", err)
			c.trySend(authErrorMessage)
			return false
		}
	}
	c.hub.RegisterUserClient(c, claims.UserID)
	c.trySend(authOKMessage)
	return true
}

// trySend queues a frame without blocking the read loop; a full buffer drops it.
func (c *Client) trySend(msg []byte) {
	select {
	case c.send <- msg:
	default:
	}
}

// writePump pumps messages from the hub to the websocket connection.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			_, _ = w.Write(message)

			// Batch queued messages
			n := len(c.send)
			for i := 0; i < n; i++ {
				_, _ = w.Write([]byte("\n"))
				_, _ = w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ServeWs handles public price-feed websocket requests. Auth messages are
// ignored — the connection carries no per-user identity.
func ServeWs(hub *Hub, logger *slog.Logger, w http.ResponseWriter, r *http.Request) {
	serve(hub, logger, nil, maxMessageSize, w, r)
}

// ServeWsAuthenticated handles a per-user websocket channel. The client must
// send {"type":"auth","token":<access token>}; once the JWT is validated (and
// its session is not revoked) the connection is registered to that user and
// receives SendToUser deliveries.
func ServeWsAuthenticated(hub *Hub, logger *slog.Logger, jwtManager *jwtpkg.Manager, checker JTIChecker, w http.ResponseWriter, r *http.Request) {
	serve(hub, logger, &wsAuth{jwt: jwtManager, checker: checker}, authMessageSize, w, r)
}

func serve(hub *Hub, logger *slog.Logger, auth *wsAuth, readLimit int64, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Error("WebSocket upgrade failed", "error", err)
		return
	}

	client := &Client{
		hub:       hub,
		conn:      conn,
		send:      make(chan []byte, 256),
		logger:    logger,
		auth:      auth,
		readLimit: readLimit,
	}

	hub.register <- client

	go client.writePump()
	go client.readPump()
}
