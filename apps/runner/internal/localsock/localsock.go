// Package localsock is the running Runner's socket, runner.sock in its
// state folder (mode 600): the machine's own commands (`login`, `logout`,
// `miroir`) ask the Runner what only it does (it holds the tokens, it is the
// Miroir's only writer). One connection per request, one JSON line each
// way: a request `{ op, … }`, a reply `{ ok, error?, … }`, the handlers
// registered by op. Nothing of a request nor of a reply is logged.
package localsock

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// SocketName is the socket's file in the Runner's state folder.
const SocketName = "runner.sock"

// Timeout is how long an op may take before its reply is `timeout`.
const Timeout = 30 * time.Second

// ErrNoRunner: no Runner listens on the socket (not started, or crashed).
var ErrNoRunner = errors.New("localsock: no Runner is running")

// CodeTimeout is the reply's error of an op that took longer than Timeout.
const CodeTimeout = "timeout"

// CodeUnknownOp is the reply's error of an op no handler serves.
const CodeUnknownOp = "unknown-op"

// Handler answers one request (its whole line); the reply is its value's
// JSON object, with `ok` added.
type Handler func(ctx context.Context, request json.RawMessage) (any, error)

// Coded is an error whose reply names a code (`unavailable`, `not-found`…)
// rather than its text.
type Coded interface {
	error
	Code() string
}

// Server serves the handlers on the socket.
type Server struct {
	// DefaultOp is the op of a request without one (accounts.refresh, the
	// first request runner.sock knew).
	DefaultOp string
	// Timeout defaults to Timeout.
	Timeout time.Duration

	mu       sync.RWMutex
	handlers map[string]Handler
}

// Handle registers h for op.
func (s *Server) Handle(op string, h Handler) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.handlers == nil {
		s.handlers = map[string]Handler{}
	}
	s.handlers[op] = h
}

// Serve listens on the socket (mode 600, a stale one replaced) until ctx ends.
func (s *Server) Serve(ctx context.Context, socket string) error {
	if err := os.MkdirAll(filepath.Dir(socket), 0o700); err != nil {
		return fmt.Errorf("localsock: %w", err)
	}
	if err := os.Remove(socket); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("localsock: remove the stale socket: %w", err)
	}
	var config net.ListenConfig
	listener, err := config.Listen(ctx, "unix", socket)
	if err != nil {
		return fmt.Errorf("localsock: listen: %w", err)
	}
	defer listener.Close()
	if err := os.Chmod(socket, 0o600); err != nil {
		return fmt.Errorf("localsock: chmod the socket: %w", err)
	}
	stop := context.AfterFunc(ctx, func() { listener.Close() })
	defer stop()
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("localsock: accept: %w", err)
		}
		go s.answer(ctx, conn)
	}
}

type failure struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

func (s *Server) answer(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	line, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		return
	}
	reply := s.reply(ctx, line)
	_, _ = conn.Write(append(reply, '\n'))
}

func (s *Server) reply(ctx context.Context, line []byte) []byte {
	var head struct {
		Op string `json:"op"`
	}
	if err := json.Unmarshal(line, &head); err != nil {
		return marshal(failure{Error: "bad-request"})
	}
	if head.Op == "" {
		head.Op = s.DefaultOp
	}
	s.mu.RLock()
	h, ok := s.handlers[head.Op]
	s.mu.RUnlock()
	if !ok {
		return marshal(failure{Error: CodeUnknownOp})
	}
	timeout := s.Timeout
	if timeout == 0 {
		timeout = Timeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	type result struct {
		value any
		err   error
	}
	done := make(chan result, 1)
	go func() {
		value, err := h(ctx, line)
		done <- result{value, err}
	}()
	var r result
	select {
	case r = <-done:
	case <-ctx.Done():
		return marshal(failure{Error: CodeTimeout})
	}
	if r.err != nil {
		var coded Coded
		if errors.As(r.err, &coded) {
			return marshal(failure{Error: coded.Code()})
		}
		if errors.Is(r.err, context.DeadlineExceeded) {
			return marshal(failure{Error: CodeTimeout})
		}
		return marshal(failure{Error: r.err.Error()})
	}
	fields := map[string]json.RawMessage{}
	if r.value != nil {
		data, err := json.Marshal(r.value)
		if err != nil || json.Unmarshal(data, &fields) != nil {
			return marshal(failure{Error: "bad-reply"})
		}
	}
	fields["ok"] = json.RawMessage("true")
	return marshal(fields)
}

func marshal(v any) []byte {
	data, _ := json.Marshal(v)
	return data
}

// Failed is a reply whose ok is false: Code is its error.
type Failed struct{ Code string }

func (e *Failed) Error() string { return "the Runner: " + e.Code }

// Call sends op with request's fields to the Runner on the socket and
// decodes its reply into reply (nil: ignored); ErrNoRunner when none
// listens, *Failed when it answered an error.
func Call(ctx context.Context, socket, op string, request, reply any) error {
	fields := map[string]json.RawMessage{}
	if request != nil {
		data, err := json.Marshal(request)
		if err != nil {
			return fmt.Errorf("localsock: %w", err)
		}
		if err := json.Unmarshal(data, &fields); err != nil {
			return fmt.Errorf("localsock: a request is an object: %w", err)
		}
	}
	if op != "" {
		fields["op"] = marshal(op)
	}
	line, err := RawCall(ctx, socket, marshal(fields))
	if err != nil {
		return err
	}
	var head struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(line, &head); err != nil {
		return fmt.Errorf("localsock: %s: %w", op, err)
	}
	if !head.OK {
		return &Failed{Code: head.Error}
	}
	if reply != nil {
		if err := json.Unmarshal(line, reply); err != nil {
			return fmt.Errorf("localsock: %s: %w", op, err)
		}
	}
	return nil
}

// RawCall sends one line and gives the reply's line.
func RawCall(ctx context.Context, socket string, line []byte) ([]byte, error) {
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "unix", socket)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNoRunner, err)
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	if _, err := conn.Write(append(line, '\n')); err != nil {
		return nil, fmt.Errorf("localsock: %w", err)
	}
	reply, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("localsock: %w", err)
	}
	return reply, nil
}
