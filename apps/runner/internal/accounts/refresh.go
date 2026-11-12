package accounts

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

// SocketName is the running Runner's socket in its state folder, through
// which `crewdeck-runner login` and `logout` ask it to send its capabilities
// again: one connection per refresh, one JSON line each way.
const SocketName = "runner.sock"

// ErrNoRunner: no Runner listens on the socket (not started, or crashed).
var ErrNoRunner = errors.New("accounts: no Runner is running")

// DefaultSocket is the socket of the Runner's state folder.
func DefaultSocket() (string, error) {
	home, err := state.Default()
	if err != nil {
		return "", err
	}
	return filepath.Join(home.Dir, SocketName), nil
}

type refreshReply struct {
	Engines []contracts.EngineCapabilities `json:"engines"`
	Error   string                         `json:"error,omitempty"`
}

// Serve listens on the socket (mode 600, a stale one replaced) until ctx
// ends, answering each refresh with what `refresh` gives.
func Serve(ctx context.Context, socket string, refresh func(context.Context) ([]contracts.EngineCapabilities, error)) error {
	if err := os.MkdirAll(filepath.Dir(socket), 0o700); err != nil {
		return fmt.Errorf("accounts: %w", err)
	}
	if err := os.Remove(socket); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("accounts: remove the stale socket: %w", err)
	}
	var config net.ListenConfig
	listener, err := config.Listen(ctx, "unix", socket)
	if err != nil {
		return fmt.Errorf("accounts: listen: %w", err)
	}
	defer listener.Close()
	if err := os.Chmod(socket, 0o600); err != nil {
		return fmt.Errorf("accounts: chmod the socket: %w", err)
	}
	stop := context.AfterFunc(ctx, func() { listener.Close() })
	defer stop()
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("accounts: accept: %w", err)
		}
		go answer(ctx, conn, refresh)
	}
}

func answer(ctx context.Context, conn net.Conn, refresh func(context.Context) ([]contracts.EngineCapabilities, error)) {
	defer conn.Close()
	if _, err := bufio.NewReader(conn).ReadBytes('\n'); err != nil {
		return
	}
	var reply refreshReply
	engines, err := refresh(ctx)
	if err != nil {
		reply.Error = err.Error()
	}
	reply.Engines = engines
	line, _ := json.Marshal(reply)
	_, _ = conn.Write(append(line, '\n'))
}

// Refresh asks the Runner listening on the socket to send its capabilities
// to the server, and gives them; ErrNoRunner when none listens.
func Refresh(ctx context.Context, socket string) ([]contracts.EngineCapabilities, error) {
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "unix", socket)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNoRunner, err)
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	if _, err := conn.Write([]byte("{\"refresh\":true}\n")); err != nil {
		return nil, fmt.Errorf("accounts: refresh: %w", err)
	}
	line, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		return nil, fmt.Errorf("accounts: refresh: %w", err)
	}
	var reply refreshReply
	if err := json.Unmarshal(line, &reply); err != nil {
		return nil, fmt.Errorf("accounts: refresh: %w", err)
	}
	if reply.Error != "" {
		return reply.Engines, fmt.Errorf("the Runner: %s", reply.Error)
	}
	return reply.Engines, nil
}
