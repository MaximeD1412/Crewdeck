package claude_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/enginetest"
)

// fakeStream starts the fake binary on the lines given, a stream of its own.
func fakeStream(t *testing.T, ctx context.Context, lines ...string) engine.Run {
	t.Helper()
	stream := filepath.Join(t.TempDir(), "stream.jsonl")
	if err := os.WriteFile(stream, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	run, err := newEngine().Start(ctx, engine.StartOptions{
		Dir:        t.TempDir(),
		BinaryPath: enginetest.FakeBinary(t),
		Env:        []string{"FAKE_ENGINE_STREAM=" + stream},
	})
	if err != nil {
		t.Fatal(err)
	}
	return run
}

// waitFor fails the test when the run is not over in 10 s.
func waitFor(t *testing.T, run engine.Run) error {
	t.Helper()
	done := make(chan error, 1)
	go func() { done <- run.Wait() }()
	select {
	case err := <-done:
		return err
	case <-time.After(10 * time.Second):
		t.Fatal("the run is not over 10 s later")
		return nil
	}
}

// When stdin is gone, the interrupt is a SIGINT; Claude ends on it with no
// result of its own, and the run still ends as interrupted, its Session kept.
func TestAnInterruptBySIGINTEndsAsInterruptedWithTheKeptSession(t *testing.T) {
	run := fakeStream(t, context.Background(),
		`{"type":"system","subtype":"init","session_id":"sigint-0000-4000-8000-000000000001"}`,
		`{"fake":"close-stdin"}`,
		`{"type":"assistant","message":{"content":[{"type":"text","text":"en cours"}]}}`,
		`{"fake":"await-sigint"}`,
	)
	var events []contracts.EngineEvent
	for event := range run.Events() {
		events = append(events, event)
		if event.Message != nil {
			if err := run.Interrupt(context.Background()); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := waitFor(t, run); err != nil {
		t.Fatalf("Wait: %v", err)
	}
	last := events[len(events)-1]
	if len(kinds(events, "error")) > 0 || last.Result == nil {
		t.Fatalf("events %s", render(events))
	}
	if last.Result.Status != contracts.EngineEventResultStatusInterrupted || last.Result.EngineSessionId == nil || *last.Result.EngineSessionId != "sigint-0000-4000-8000-000000000001" {
		t.Fatalf("result %+v", last.Result)
	}
}

// A Claude that no longer reads stdin blocks a long Send; cancelling the run
// still stops it.
func TestCancellingTheRunStopsItDuringABlockedSend(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	run := fakeStream(t, ctx,
		`{"type":"system","subtype":"init","session_id":"blocked-0000-4000-8000-000000000001"}`,
		`{"fake":"await-sigint"}`,
	)
	sent := make(chan error, 1)
	go func() { sent <- run.Send(context.Background(), strings.Repeat("x", 4<<20)) }()
	time.Sleep(200 * time.Millisecond)
	cancel()
	if err := waitFor(t, run); !errors.Is(err, context.Canceled) {
		t.Fatalf("Wait: %v", err)
	}
	select {
	case err := <-sent:
		if err == nil {
			t.Fatal("the blocked Send succeeded")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Send still blocked 5 s after the run ended")
	}
}
