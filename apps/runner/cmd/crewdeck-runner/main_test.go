package main

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/maximed1412/crewdeck/apps/runner/internal/accounts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/fake"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

func TestVersionPrintsTheBuildVersion(t *testing.T) {
	previous := version
	version = "1.2.3"
	t.Cleanup(func() { version = previous })

	var out bytes.Buffer
	root := newRootCommand()
	root.SetOut(&out)
	root.SetArgs([]string{"version"})

	if err := root.Execute(); err != nil {
		t.Fatalf("version: %v", err)
	}
	if got := out.String(); got != "1.2.3\n" {
		t.Fatalf("version printed %q, want %q", got, "1.2.3\n")
	}
}

func TestVersionDefaultsToDev(t *testing.T) {
	if version != "dev" {
		t.Fatalf("default version is %q, want %q", version, "dev")
	}
}

func TestTheVersionFlagPrintsTheBuildVersion(t *testing.T) {
	previous := version
	version = "1.2.3"
	t.Cleanup(func() { version = previous })

	var out bytes.Buffer
	root := newRootCommand()
	root.SetOut(&out)
	root.SetArgs([]string{"--version"})

	if err := root.Execute(); err != nil {
		t.Fatalf("--version: %v", err)
	}
	if got := out.String(); got != "1.2.3\n" {
		t.Fatalf("--version printed %q, want %q", got, "1.2.3\n")
	}
}

func TestRunRefusesAnUnlinkedRunnerInFrench(t *testing.T) {
	t.Setenv(state.HomeEnv, t.TempDir())
	root := newRootCommand()
	root.SetArgs([]string{"run"})

	err := root.Execute()
	if err == nil || !strings.Contains(err.Error(), "relié à aucun compte") {
		t.Fatalf("run = %v, want the not-linked message", err)
	}
}

func TestRunConnectsWithTheLinkedTokenAndStopsCleanlyWhenItsContextEnds(t *testing.T) {
	hello := make(chan string, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer rnr_linked" {
			http.Error(w, "refused", http.StatusBadRequest)
			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		_, data, err := conn.Read(r.Context())
		if err != nil {
			return
		}
		hello <- string(data)
		for {
			if _, _, err := conn.Read(r.Context()); err != nil {
				return
			}
		}
	}))
	t.Cleanup(srv.Close)
	home := t.TempDir()
	t.Setenv(state.HomeEnv, home)
	// runner.json names another server: --server takes its place.
	linkedHome(t, home, "http://127.0.0.1:1")

	ctx, cancel := context.WithCancel(context.Background())
	root := newRootCommand()
	root.SetErr(io.Discard)
	root.SetArgs([]string{"run", "--server", srv.URL})
	done := make(chan error, 1)
	go func() { done <- root.ExecuteContext(ctx) }()

	select {
	case data := <-hello:
		if !strings.Contains(data, `"type":"hello"`) {
			t.Fatalf("first message %s", data)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no hello")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run after its context ended: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("run did not stop")
	}
}

func TestRefusalsOfTheServerAreSaidInFrench(t *testing.T) {
	cases := map[error]string{
		protocol.ErrUnauthorized:                              "ne reconnaît plus ce Runner",
		protocol.ErrReplaced:                                  "Une autre connexion",
		&protocol.UpdateRequiredError{LatestVersion: "0.2.0"}: "mets-le à jour (version 0.2.0)",
	}
	for err, want := range cases {
		if got := refusal(err); got == nil || !strings.Contains(got.Error(), want) {
			t.Errorf("refusal(%v) = %v, want %q", err, got, want)
		}
	}
	if refusal(nil) != nil {
		t.Error("refusal(nil) is not nil")
	}
}

func TestRunSendsItsCapabilitiesOnceAcceptedAndAgainWhenLoginAsks(t *testing.T) {
	messages := make(chan string, 8)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		ctx := r.Context()
		if _, _, err := conn.Read(ctx); err != nil { // hello
			return
		}
		accepted := `{"type":"hello.accepted","id":"019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a00","at":"2026-11-11T08:00:00.000Z","runnerId":"019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01","protocolVersion":1}`
		if err := conn.Write(ctx, websocket.MessageText, []byte(accepted)); err != nil {
			return
		}
		for {
			_, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			if strings.Contains(string(data), `"type":"capabilities"`) {
				messages <- string(data)
			}
		}
	}))
	t.Cleanup(srv.Close)
	home := t.TempDir()
	t.Setenv(state.HomeEnv, home)
	linkedHome(t, home, srv.URL)
	previous := runnerEngines
	runnerEngines = func(accounts.Store) *engine.Registry {
		var registry engine.Registry
		registry.Register(&fake.Engine{Models: []contracts.EngineCapabilitiesModelsElem{{Id: "opus", Label: "Opus"}}})
		return &registry
	}
	t.Cleanup(func() { runnerEngines = previous })

	ctx, cancel := context.WithCancel(context.Background())
	root := newRootCommand()
	root.SetErr(io.Discard)
	root.SetArgs([]string{"run"})
	done := make(chan error, 1)
	go func() { done <- root.ExecuteContext(ctx) }()

	await := func(what string) string {
		select {
		case data := <-messages:
			return data
		case <-time.After(5 * time.Second):
			t.Fatalf("no capabilities %s", what)
			return ""
		}
	}
	if data := await("once accepted"); !strings.Contains(data, `"engine":"claude-code"`) || !strings.Contains(data, `"id":"opus"`) {
		t.Fatalf("capabilities %s", data)
	}
	caps, err := accounts.Refresh(ctx, filepath.Join(home, accounts.SocketName))
	if err != nil || len(caps) != 1 {
		t.Fatalf("Refresh = %+v, %v", caps, err)
	}
	await("after the refresh")
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run after its context ended: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("run did not stop")
	}
}
