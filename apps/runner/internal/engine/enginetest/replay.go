// Package enginetest replays the recorded streams of a Moteur (RUNNER-1,
// `internal/engine/<moteur>/testdata/*.jsonl`) through an adapter: the fake
// binary stands in for the Moteur, the adapter turns what it writes into
// normalised events, and those are compared with a golden file. Tests never
// run a real Moteur (ADR 0004).
package enginetest

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
)

// update rewrites the goldens: `go test ./internal/engine/claude/ -update`.
var update = flag.Bool("update", false, "rewrite the golden files of the replayed streams")

const fakeEnginePackage = "github.com/maximed1412/crewdeck/apps/runner/internal/engine/fake/cmd/fake-engine"

// Timeout is how long a replay may take before it fails.
const Timeout = 30 * time.Second

// Replayed is what a replay gives: the events as the adapter emitted them
// (raw and at included), the lines the fake binary read on its stdin, and
// what the run's Wait returned.
type Replayed struct {
	Events []contracts.EngineEvent
	Stdin  []string
	Err    error
}

type config struct {
	start  engine.StartOptions
	exit   int
	answer func(contracts.EngineEvent) engine.Answer
}

// Option changes how Replay starts the adapter.
type Option func(*config)

// WithStartOptions starts the adapter with these options (BinaryPath and the
// fake's variables of Env are Replay's own).
func WithStartOptions(opts engine.StartOptions) Option {
	return func(c *config) { c.start = opts }
}

// WithExit has the fake binary exit with this code once its stream is written.
func WithExit(code int) Option {
	return func(c *config) { c.exit = code }
}

// WithAnswer answers each `question` and `permission-request` with what the
// function gives; by default, the first option of a question, and allow.
func WithAnswer(answer func(contracts.EngineEvent) engine.Answer) Option {
	return func(c *config) { c.answer = answer }
}

// DefaultAnswer chooses the first option of a question, and allows a
// permission request.
func DefaultAnswer(event contracts.EngineEvent) engine.Answer {
	if event.Question != nil && len(event.Question.Options) > 0 {
		return engine.Answer{Options: []string{event.Question.Options[0].Label}}
	}
	allow := true
	return engine.Answer{Allow: &allow}
}

// Replay starts the adapter on the fake binary, which writes
// `testdata/<stream>.jsonl` and pauses at its `await-stdin` lines; answers
// each request the adapter emits; collects the events until the run ends; and
// compares them, without `raw` and `at`, with `testdata/<golden>.golden.json`
// (rewritten with -update). Paths are those of the test's package.
func Replay(t testing.TB, e engine.Engine, stream, golden string, opts ...Option) Replayed {
	t.Helper()
	cfg := config{
		start:  engine.StartOptions{InitialPrompt: "Rejoue la Session", PermissionMode: engine.PermissionAuto},
		answer: DefaultAnswer,
	}
	for _, opt := range opts {
		opt(&cfg)
	}
	streamPath, err := filepath.Abs(filepath.Join("testdata", stream+".jsonl"))
	if err != nil {
		t.Fatalf("enginetest: %v", err)
	}
	if _, err := os.Stat(streamPath); err != nil {
		t.Fatalf("enginetest: stream %s: %v", stream, err)
	}
	stdinLog := filepath.Join(t.TempDir(), "stdin.jsonl")

	start := cfg.start
	start.BinaryPath = FakeBinary(t)
	if start.Dir == "" {
		start.Dir = t.TempDir()
	}
	start.Env = append(append([]string(nil), start.Env...),
		"FAKE_ENGINE_STREAM="+streamPath,
		"FAKE_ENGINE_STDIN_LOG="+stdinLog,
		"FAKE_ENGINE_EXIT="+strconv.Itoa(cfg.exit),
	)

	ctx, cancel := context.WithTimeout(context.Background(), Timeout)
	t.Cleanup(cancel)
	run, err := e.Start(ctx, start)
	if err != nil {
		t.Fatalf("enginetest: start %s on %s: %v", e.ID(), stream, err)
	}

	var replayed Replayed
	for done := false; !done; {
		select {
		case event, open := <-run.Events():
			if !open {
				done = true
				break
			}
			replayed.Events = append(replayed.Events, event)
			if id := requestID(event); id != "" {
				if err := run.Answer(ctx, id, cfg.answer(event)); err != nil {
					t.Fatalf("enginetest: answer %s: %v", id, err)
				}
			}
		case <-ctx.Done():
			t.Fatalf("enginetest: %s did not end within %s; events so far:\n%s", stream, Timeout, render(t, replayed.Events))
		}
	}
	replayed.Err = run.Wait()
	if logged, err := os.ReadFile(stdinLog); err == nil {
		replayed.Stdin = strings.FieldsFunc(string(logged), func(r rune) bool { return r == '\n' })
	}

	compare(t, filepath.Join("testdata", golden+".golden.json"), render(t, replayed.Events))
	return replayed
}

func requestID(event contracts.EngineEvent) string {
	switch {
	case event.Question != nil:
		return event.Question.RequestId
	case event.PermissionRequest != nil:
		return event.PermissionRequest.RequestId
	}
	return ""
}

// render writes the events as the goldens hold them: an indented JSON array,
// each event without `raw` (the recording already holds it) nor `at` (the
// instant of the replay).
func render(t testing.TB, events []contracts.EngineEvent) []byte {
	t.Helper()
	stripped := make([]map[string]any, 0, len(events))
	for _, event := range events {
		data, err := json.Marshal(event)
		if err != nil {
			t.Fatalf("enginetest: encode %+v: %v", event.Value(), err)
		}
		var fields map[string]any
		if err := json.Unmarshal(data, &fields); err != nil {
			t.Fatalf("enginetest: %v", err)
		}
		delete(fields, "raw")
		delete(fields, "at")
		stripped = append(stripped, fields)
	}
	out, err := json.MarshalIndent(stripped, "", "  ")
	if err != nil {
		t.Fatalf("enginetest: %v", err)
	}
	return append(out, '\n')
}

func compare(t testing.TB, path string, got []byte) {
	t.Helper()
	if *update {
		if err := os.WriteFile(path, got, 0o644); err != nil {
			t.Fatalf("enginetest: write %s: %v", path, err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("enginetest: %v (run the test with -update to write it)", err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("enginetest: the events differ from %s (-update rewrites it)\ngot:\n%s\nwant:\n%s", path, got, want)
	}
}

// FakeBinary builds the fake binary into the test's temporary folder, and
// gives its path.
func FakeBinary(t testing.TB) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "fake-engine")
	build := exec.Command(goTool(), "build", "-o", out, fakeEnginePackage)
	build.Dir = moduleRoot() // whatever the test's working directory
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("enginetest: build the fake binary: %v\n%s", err, output)
	}
	return out
}

// moduleRoot is apps/runner, three folders above this file.
func moduleRoot() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..", "..", "..")
}

func goTool() string {
	if path, err := exec.LookPath("go"); err == nil {
		return path
	}
	return filepath.Join(runtime.GOROOT(), "bin", "go")
}
