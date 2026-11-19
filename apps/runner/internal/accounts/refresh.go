package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

// SocketName is the running Runner's socket in its state folder
// (localsock), through which `crewdeck-runner login` and `logout` ask it to
// send its capabilities again.
const SocketName = localsock.SocketName

// OpRefresh is the op of a refresh, also a request without op.
const OpRefresh = "accounts.refresh"

// ErrNoRunner: no Runner listens on the socket (not started, or crashed).
var ErrNoRunner = localsock.ErrNoRunner

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
	Error   string                         `json:"failure,omitempty"`
}

// Register serves the refreshes on s with what `refresh` gives; it is the
// socket's default op.
func Register(s *localsock.Server, refresh func(context.Context) ([]contracts.EngineCapabilities, error)) {
	s.DefaultOp = OpRefresh
	s.Handle(OpRefresh, func(ctx context.Context, _ json.RawMessage) (any, error) {
		var reply refreshReply
		engines, err := refresh(ctx)
		if err != nil {
			reply.Error = err.Error()
		}
		reply.Engines = engines
		return reply, nil
	})
}

// Serve listens on the socket (mode 600, a stale one replaced) until ctx
// ends, answering only the refreshes.
func Serve(ctx context.Context, socket string, refresh func(context.Context) ([]contracts.EngineCapabilities, error)) error {
	s := &localsock.Server{}
	Register(s, refresh)
	return s.Serve(ctx, socket)
}

// Refresh asks the Runner listening on the socket to send its capabilities
// to the server, and gives them; ErrNoRunner when none listens.
func Refresh(ctx context.Context, socket string) ([]contracts.EngineCapabilities, error) {
	var reply refreshReply
	if err := localsock.Call(ctx, socket, OpRefresh, nil, &reply); err != nil {
		if errors.Is(err, ErrNoRunner) {
			return nil, err
		}
		return nil, fmt.Errorf("accounts: refresh: %w", err)
	}
	if reply.Error != "" {
		return reply.Engines, fmt.Errorf("the Runner: %s", reply.Error)
	}
	return reply.Engines, nil
}
