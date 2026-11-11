// Package protocol is the Runner's side of the Runner protocol (ADR 0004,
// packages/contracts/src/runner/): one WebSocket to the server's
// /api/ws?client=runner with the Runner's token, its hello first, a
// heartbeat every contracts.HeartbeatSeconds, and a new connection after
// each cut, with a backoff.
package protocol

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// ErrUnauthorized: the server knows no Runner of this token, or a newer link revoked it (4401). Linking again is the way out.
var ErrUnauthorized = errors.New("protocol: the server refused the Runner's token")

// ErrReplaced: another connection with the same token took this one's place (4409).
var ErrReplaced = errors.New("protocol: another connection of this Runner replaced this one")

// ErrNotConnected is returned by Send while no connection is accepted.
var ErrNotConnected = errors.New("protocol: not connected")

// UpdateRequiredError: the server no longer speaks this Runner's protocol (4426); RUNNER-8 updates it to LatestVersion.
type UpdateRequiredError struct {
	LatestVersion string
}

func (e *UpdateRequiredError) Error() string {
	return fmt.Sprintf("protocol: the server requires an update of the Runner (latest version %q)", e.LatestVersion)
}

// Handler handles a message of the server of one type; data is the whole message.
type Handler func(ctx context.Context, data []byte) error

// Config is what the client connects with.
type Config struct {
	// Server is the server's address, http(s)://host[:port].
	Server string
	Token  string
	// Machine is what the hello says of the Runner.
	Machine Machine
	Logger  *slog.Logger
	// HeartbeatEvery defaults to contracts.HeartbeatSeconds.
	HeartbeatEvery time.Duration
	// SilentAfter, without any message of the server, closes the connection
	// to open a new one; defaults to contracts.OfflineAfterSeconds.
	SilentAfter time.Duration
	// HelloTimeout is how long the server may take to answer the hello; defaults to 30 s.
	HelloTimeout time.Duration
	// Backoff defaults to DefaultBackoff.
	Backoff Backoff
	// OnAccepted is called on each accepted hello.
	OnAccepted func(contracts.RunnerHelloAccepted)
	// OnConnected is called on its own goroutine once each accepted
	// connection can Send (the capabilities, RUNNER-7); its context ends with
	// the connection.
	OnConnected func(context.Context)
}

// Client is the Runner's connection to the server.
type Client struct {
	cfg      Config
	handlers map[string]Handler

	mu   sync.Mutex
	conn *websocket.Conn
}

// New is a client of cfg; Run connects it.
func New(cfg Config) *Client {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.HeartbeatEvery == 0 {
		cfg.HeartbeatEvery = contracts.HeartbeatSeconds * time.Second
	}
	if cfg.SilentAfter == 0 {
		cfg.SilentAfter = contracts.OfflineAfterSeconds * time.Second
	}
	if cfg.HelloTimeout == 0 {
		cfg.HelloTimeout = 30 * time.Second
	}
	if cfg.Backoff.Min == 0 {
		cfg.Backoff = DefaultBackoff
	}
	return &Client{cfg: cfg, handlers: map[string]Handler{}}
}

// Handle registers the handler of the server's messages of `typ`; one per type.
func (c *Client) Handle(typ string, handler Handler) {
	if _, ok := c.handlers[typ]; ok {
		panic(fmt.Sprintf("protocol: a handler of %s is already registered", typ))
	}
	c.handlers[typ] = handler
}

// On registers a handler of `typ` that gets the message decoded, and validated, as T (a type of internal/contracts).
func On[T any](c *Client, typ string, handler func(context.Context, T) error) {
	c.Handle(typ, func(ctx context.Context, data []byte) error {
		var message T
		if err := json.Unmarshal(data, &message); err != nil {
			return fmt.Errorf("protocol: decode %s: %w", typ, err)
		}
		return handler(ctx, message)
	})
}

// Send sends a message (a type of internal/contracts) on the accepted connection.
func (c *Client) Send(ctx context.Context, message any) error {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return ErrNotConnected
	}
	return write(ctx, conn, message)
}

// Run stays connected until ctx ends (nil then, the connection closed
// cleanly) or the server refuses the Runner for good: ErrUnauthorized,
// ErrReplaced, *UpdateRequiredError.
func (c *Client) Run(ctx context.Context) error {
	failures := 0
	for {
		accepted, err := c.session(ctx)
		if ctx.Err() != nil {
			return nil
		}
		if final(err) {
			return err
		}
		if accepted {
			failures = 0
		}
		delay := c.cfg.Backoff.Delay(failures)
		failures++
		c.cfg.Logger.Warn("disconnected from the server, connecting again", "err", err, "in", delay)
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
}

func final(err error) bool {
	var update *UpdateRequiredError
	return errors.Is(err, ErrUnauthorized) || errors.Is(err, ErrReplaced) || errors.As(err, &update)
}

func (c *Client) socketURL() (string, error) {
	u, err := url.Parse(c.cfg.Server)
	if err != nil {
		return "", fmt.Errorf("protocol: server %q: %w", c.cfg.Server, err)
	}
	switch u.Scheme {
	case "http", "ws":
		u.Scheme = "ws"
	case "https", "wss":
		u.Scheme = "wss"
	default:
		return "", fmt.Errorf("protocol: server %q is neither http nor https", c.cfg.Server)
	}
	u.Path = "/api/ws"
	u.RawQuery = "client=runner"
	return u.String(), nil
}

// session is one connection, from its dial to its end; accepted says whether its hello was.
func (c *Client) session(ctx context.Context) (accepted bool, err error) {
	target, err := c.socketURL()
	if err != nil {
		return false, err
	}
	conn, _, err := websocket.Dial(ctx, target, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + c.cfg.Token}},
	})
	if err != nil {
		return false, fmt.Errorf("protocol: dial: %w", err)
	}
	defer conn.CloseNow()

	// The connection ends with ctx: closed cleanly, which ends its reads.
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			conn.Close(websocket.StatusNormalClosure, "stopping")
		case <-done:
		}
	}()

	if err := write(ctx, conn, NewHello(c.cfg.Machine)); err != nil {
		return false, closeError(err)
	}
	if err := c.awaitAcceptance(ctx, conn); err != nil {
		return false, err
	}

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		if c.conn == conn {
			c.conn = nil
		}
		c.mu.Unlock()
	}()

	var lastHeard atomic.Int64
	lastHeard.Store(time.Now().UnixNano())
	go c.heartbeat(ctx, conn, &lastHeard, done)
	if c.cfg.OnConnected != nil {
		connected, cancel := context.WithCancel(ctx)
		defer cancel()
		go c.cfg.OnConnected(connected)
	}

	for {
		_, data, err := conn.Read(context.Background())
		if err != nil {
			return true, closeError(err)
		}
		lastHeard.Store(time.Now().UnixNano())
		c.dispatch(ctx, data)
	}
}

func (c *Client) awaitAcceptance(ctx context.Context, conn *websocket.Conn) error {
	readCtx, cancel := context.WithTimeout(context.Background(), c.cfg.HelloTimeout)
	defer cancel()
	for {
		_, data, err := conn.Read(readCtx)
		if err != nil {
			return closeError(err)
		}
		typ, err := typeOf(data)
		if err != nil {
			c.cfg.Logger.Warn("invalid message of the server", "type", "invalid", "bytes", len(data))
			continue
		}
		switch typ {
		case TypeHelloAccepted:
			var accepted contracts.RunnerHelloAccepted
			if err := json.Unmarshal(data, &accepted); err != nil {
				return fmt.Errorf("protocol: decode %s: %w", typ, err)
			}
			c.cfg.Logger.Info("connected to the server", "runnerId", accepted.RunnerId, "protocolVersion", accepted.ProtocolVersion)
			if c.cfg.OnAccepted != nil {
				c.cfg.OnAccepted(accepted)
			}
			return nil
		case TypeHelloRejected:
			var rejected contracts.RunnerHelloRejected
			if err := json.Unmarshal(data, &rejected); err != nil {
				return fmt.Errorf("protocol: decode %s: %w", typ, err)
			}
			conn.Close(websocket.StatusNormalClosure, "rejected")
			return rejection(rejected)
		case TypeError:
			c.logError(data)
		default:
			c.cfg.Logger.Warn("message of the server before hello.accepted", "type", typ, "bytes", len(data))
		}
	}
}

func rejection(rejected contracts.RunnerHelloRejected) error {
	switch rejected.Reason {
	case contracts.RunnerHelloRejectedReasonUpdateRequired:
		latest := ""
		if rejected.LatestVersion != nil {
			latest = *rejected.LatestVersion
		}
		return &UpdateRequiredError{LatestVersion: latest}
	default:
		return fmt.Errorf("%w (%s)", ErrUnauthorized, rejected.Reason)
	}
}

// heartbeat sends a heartbeat every HeartbeatEvery, and closes a connection silent for SilentAfter.
func (c *Client) heartbeat(ctx context.Context, conn *websocket.Conn, lastHeard *atomic.Int64, done <-chan struct{}) {
	ticker := time.NewTicker(c.cfg.HeartbeatEvery)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			if time.Since(time.Unix(0, lastHeard.Load())) > c.cfg.SilentAfter {
				c.cfg.Logger.Warn("the server is silent, connecting again")
				conn.CloseNow()
				return
			}
			if err := write(ctx, conn, NewHeartbeat()); err != nil {
				conn.CloseNow()
				return
			}
		}
	}
}

func (c *Client) dispatch(ctx context.Context, data []byte) {
	typ, err := typeOf(data)
	if err != nil {
		c.cfg.Logger.Warn("invalid message of the server", "type", "invalid", "bytes", len(data))
		return
	}
	c.cfg.Logger.Debug("message of the server", "direction", "in", "type", typ, "bytes", len(data))
	switch typ {
	case TypeHeartbeatAck:
		return
	case TypeError:
		c.logError(data)
		return
	}
	handler, ok := c.handlers[typ]
	if !ok {
		c.cfg.Logger.Warn("no handler of this message of the server", "type", typ)
		return
	}
	if err := handler(ctx, data); err != nil {
		c.cfg.Logger.Error("handling a message of the server failed", "type", typ, "err", err)
	}
}

func (c *Client) logError(data []byte) {
	var protocolError contracts.RunnerError
	if err := json.Unmarshal(data, &protocolError); err != nil {
		c.cfg.Logger.Warn("invalid message of the server", "type", TypeError, "bytes", len(data))
		return
	}
	c.cfg.Logger.Warn("the server refused a message", "code", protocolError.Code)
}

// closeError is the error of a connection's end: the final ones by their close code.
func closeError(err error) error {
	switch websocket.CloseStatus(err) {
	case contracts.CloseUnauthorized:
		return ErrUnauthorized
	case contracts.CloseReplaced:
		return ErrReplaced
	case contracts.CloseUpdateRequired:
		return &UpdateRequiredError{}
	}
	return err
}

func write(ctx context.Context, conn *websocket.Conn, message any) error {
	data, err := json.Marshal(message)
	if err != nil {
		return fmt.Errorf("protocol: encode: %w", err)
	}
	return conn.Write(ctx, websocket.MessageText, data)
}
