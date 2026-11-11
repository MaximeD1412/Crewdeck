package accounts

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

func TestRefreshAsksTheRunningRunnerForItsCapabilities(t *testing.T) {
	socket := filepath.Join(t.TempDir(), SocketName)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	asked := make(chan struct{}, 1)
	served := make(chan error, 1)
	go func() {
		served <- Serve(ctx, socket, func(context.Context) ([]contracts.EngineCapabilities, error) {
			asked <- struct{}{}
			return []contracts.EngineCapabilities{{
				Engine:  contracts.EngineIdCodex,
				Account: contracts.EngineCapabilitiesAccount{Kind: contracts.EngineCapabilitiesAccountKindNone, State: contracts.EngineCapabilitiesAccountStateLoginRequired},
				Models:  []contracts.EngineCapabilitiesModelsElem{},
			}}, nil
		})
	}()
	waitFor(t, socket)
	if info, err := os.Stat(socket); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("socket %v, %v: want mode 600", info, err)
	}

	caps, err := Refresh(ctx, socket)
	if err != nil {
		t.Fatal(err)
	}
	<-asked
	if len(caps) != 1 || caps[0].Engine != contracts.EngineIdCodex {
		t.Fatalf("Refresh = %+v", caps)
	}
	cancel()
	if err := <-served; err != nil {
		t.Fatalf("Serve after its context: %v", err)
	}
}

func TestRefreshWithoutARunningRunnerIsErrNoRunner(t *testing.T) {
	socket := filepath.Join(t.TempDir(), SocketName)
	if _, err := Refresh(context.Background(), socket); !errors.Is(err, ErrNoRunner) {
		t.Fatalf("Refresh = %v, want ErrNoRunner", err)
	}
	// A socket left by a Runner that crashed.
	if err := os.WriteFile(socket, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Refresh(context.Background(), socket); !errors.Is(err, ErrNoRunner) {
		t.Fatalf("Refresh on a stale socket = %v, want ErrNoRunner", err)
	}
}

func TestRefreshGivesTheRunnersErrorBack(t *testing.T) {
	socket := filepath.Join(t.TempDir(), SocketName)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = Serve(ctx, socket, func(context.Context) ([]contracts.EngineCapabilities, error) {
			return nil, errors.New("protocol: not connected")
		})
	}()
	waitFor(t, socket)
	if _, err := Refresh(ctx, socket); err == nil || err.Error() != "the Runner: protocol: not connected" {
		t.Fatalf("Refresh = %v", err)
	}
}

func waitFor(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); err == nil {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("%s never appeared", path)
}
