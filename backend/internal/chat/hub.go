package chat

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 64 * 1024 // 64 KiB
	clientQueueCap = 256
	rateLimitMax   = 10 // Max 10 messages per second per connection
)

type Hub struct {
	mu             sync.RWMutex
	clients        map[string]map[*Client]bool // key: userID -> set of active Clients
	allowedOrigins []string
	logger         *slog.Logger
	upgrader       websocket.Upgrader
	onClientAction func(client *Client, action WSClientMessage)
}

type Client struct {
	hub            *Hub
	conn           *websocket.Conn
	userID         string
	send           chan []byte
	rateLimitCount int
	rateLimitReset time.Time
	mu             sync.Mutex
}

func NewHub(allowedOrigins []string, logger *slog.Logger) *Hub {
	h := &Hub{
		clients:        make(map[string]map[*Client]bool),
		allowedOrigins: allowedOrigins,
		logger:         logger,
	}

	h.upgrader = websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool {
			return h.checkOrigin(r)
		},
	}

	return h
}

func (h *Hub) SetActionHandler(handler func(client *Client, action WSClientMessage)) {
	h.onClientAction = handler
}

func (h *Hub) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // Allow non-browser requests (e.g. mobile apps, backend services)
	}

	u, err := url.Parse(origin)
	if err != nil {
		return false
	}

	reqHost := r.Host
	if strings.EqualFold(u.Host, reqHost) {
		return true
	}

	for _, allowed := range h.allowedOrigins {
		allowed = strings.TrimSpace(allowed)
		if allowed == "" || allowed == "*" {
			// Disallow wildcard '*' origin for WebSockets to protect cookie-authenticated sessions against CSWSH
			continue
		}
		if strings.EqualFold(allowed, origin) || strings.EqualFold(allowed, u.Host) {
			return true
		}
		if parsedAllowed, err := url.Parse(allowed); err == nil && parsedAllowed.Host != "" {
			if strings.EqualFold(parsedAllowed.Host, u.Host) {
				return true
			}
		}
	}

	return false
}

func (h *Hub) Upgrade(w http.ResponseWriter, r *http.Request, userID string) (*Client, error) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return nil, err
	}

	client := &Client{
		hub:            h,
		conn:           conn,
		userID:         userID,
		send:           make(chan []byte, clientQueueCap),
		rateLimitReset: time.Now().Add(time.Second),
	}

	h.registerClient(client)

	go client.writePump()
	go client.readPump()

	return client, nil
}

func (h *Hub) registerClient(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	userClients, exists := h.clients[c.userID]
	if !exists {
		userClients = make(map[*Client]bool)
		h.clients[c.userID] = userClients
	}
	userClients[c] = true

	h.logger.Info("ws_client_connected",
		slog.String("user_id", c.userID),
		slog.Int("user_active_conns", len(userClients)),
	)
}

func (h *Hub) unregisterClient(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	userClients, exists := h.clients[c.userID]
	if exists {
		delete(userClients, c)
		if len(userClients) == 0 {
			delete(h.clients, c.userID)
		}
	}

	c.mu.Lock()
	if c.send != nil {
		close(c.send)
		c.send = nil
	}
	c.mu.Unlock()

	_ = c.conn.Close()

	h.logger.Info("ws_client_disconnected",
		slog.String("user_id", c.userID),
	)
}

// IsUserOnline returns true if the user has at least one active WebSocket connection.
func (h *Hub) IsUserOnline(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	conns, ok := h.clients[userID]
	return ok && len(conns) > 0
}

// DeliverToUser delivers a serialized event to all active connections of a specific user.
// Returns true if delivered to at least one connection.
func (h *Hub) DeliverToUser(userID string, event *WSServerMessage) bool {
	raw, err := json.Marshal(event)
	if err != nil {
		h.logger.Error("failed to marshal ws event", "err", err)
		return false
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	conns, ok := h.clients[userID]
	if !ok || len(conns) == 0 {
		return false
	}

	delivered := false
	for client := range conns {
		if client.enqueueMessage(raw) {
			delivered = true
		}
	}
	return delivered
}

// RevokeConversation immediately broadcasts a revocation notice to both participants.
func (h *Hub) RevokeConversation(conversationID, userLowID, userHighID, reason string) {
	event, _ := NewWSEvent(EventConversationRevoke, map[string]string{
		"conversation_id": conversationID,
		"reason":          reason,
	})
	if event != nil {
		h.DeliverToUser(userLowID, event)
		h.DeliverToUser(userHighID, event)
	}
}

// DisconnectUser forcibly terminates all active WebSocket connections for a user (e.g. on ban or suspension).
func (h *Hub) DisconnectUser(userID string) {
	h.mu.Lock()
	conns, exists := h.clients[userID]
	if !exists || len(conns) == 0 {
		h.mu.Unlock()
		return
	}
	delete(h.clients, userID)
	h.mu.Unlock()

	for client := range conns {
		_ = client.conn.WriteControl(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "account access suspended or banned"),
			time.Now().Add(time.Second),
		)
		client.mu.Lock()
		if client.send != nil {
			close(client.send)
			client.send = nil
		}
		client.mu.Unlock()
		_ = client.conn.Close()
	}
	h.logger.Info("ws_user_forcibly_disconnected", slog.String("user_id", userID))
}

// Shutdown gracefully closes all client connections with CloseNormalClosure.
func (h *Hub) Shutdown(ctx context.Context) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.logger.Info("shutting_down_websocket_hub")
	for userID, conns := range h.clients {
		for client := range conns {
			_ = client.conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, "server shutting down"),
				time.Now().Add(time.Second),
			)
			_ = client.conn.Close()
		}
		delete(h.clients, userID)
	}
	return nil
}

// -----------------------------------------------------------------------------
// Client Pumps & Backpressure
// -----------------------------------------------------------------------------

func (c *Client) enqueueMessage(msg []byte) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.send == nil {
		return false
	}

	select {
	case c.send <- msg:
		return true
	default:
		// Backpressure handling: Queue is saturated. Drop connection to prevent buffer leak.
		c.hub.logger.Warn("ws_client_backpressure_drop", slog.String("user_id", c.userID))
		go c.hub.unregisterClient(c)
		return false
	}
}

func (c *Client) checkRateLimit() bool {
	now := time.Now()
	if now.After(c.rateLimitReset) {
		c.rateLimitCount = 1
		c.rateLimitReset = now.Add(time.Second)
		return true
	}

	c.rateLimitCount++
	return c.rateLimitCount <= rateLimitMax
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregisterClient(c)
	}()

	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, messageBytes, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure, websocket.CloseNormalClosure) {
				c.hub.logger.Debug("ws_read_error", "err", err, "user_id", c.userID)
			}
			break
		}

		if !c.checkRateLimit() {
			errEvent, _ := NewWSEvent(EventError, map[string]string{
				"code":    "RATE_LIMIT_EXCEEDED",
				"message": "Too many requests. Please slow down.",
			})
			if errEvent != nil {
				raw, _ := json.Marshal(errEvent)
				c.enqueueMessage(raw)
			}
			continue
		}

		var action WSClientMessage
		if err := json.Unmarshal(messageBytes, &action); err != nil {
			errEvent, _ := NewWSEvent(EventError, map[string]string{
				"code":    "INVALID_FRAME",
				"message": "Malformed JSON frame received",
			})
			if errEvent != nil {
				raw, _ := json.Marshal(errEvent)
				c.enqueueMessage(raw)
			}
			continue
		}

		if action.Action == ActionPing {
			pongEvent, _ := NewWSEvent(EventPong, map[string]int64{
				"server_time": time.Now().UnixMilli(),
			})
			if pongEvent != nil {
				raw, _ := json.Marshal(pongEvent)
				c.enqueueMessage(raw)
			}
			continue
		}

		if c.hub.onClientAction != nil {
			c.hub.onClientAction(c, action)
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			_, _ = w.Write(msg)

			// Drain any queued frames into current batch
			n := len(c.send)
			for i := 0; i < n; i++ {
				_, _ = w.Write([]byte{'\n'})
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
