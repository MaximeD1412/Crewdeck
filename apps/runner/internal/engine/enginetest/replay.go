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
// (raw and at included), the lines the fake binary read on its stdin, what
// its side channels answered it (Replies: the permission tool's results, the
// hooks' outputs), how it was run, and what the run's Wait returned.
type Replayed struct {
	Events      []contracts.EngineEvent
	Stdin       []string
	Replies     []string
	Invocations []Invocation
	Err         error
}

// Invocation is one run of the fake binary: its arguments, and those of the
// variables WithLoggedEnv names that were set.
type Invocation struct {
	Args []string          `json:"args"`
	Env  map[string]string `json:"env"`
}

type config struct {
	start      engine.StartOptions
	resume     *string
	exit       int
	answer     func(contracts.EngineEvent) engine.Answer
	onEvent    func(context.Context, engine.Run, contracts.EngineEvent)
	directives []Directive
	loggedEnv  []string
}

// Option changes how Replay starts the adapter.
type Option func(*config)

// WithStartOptions starts the adapter with these options (BinaryPath and the
// fake's variables of Env are Replay's own).
func WithStartOptions(opts engine.StartOptions) Option {
	return func(c *config) { c.start = opts }
}

// WithResume resumes the Session engineSessionID instead of starting one.
func WithResume(engineSessionID string) Option {
	return func(c *config) { c.resume = &engineSessionID }
}

// WithDirectives plays the stream with these directives inserted (the
// recordings hold none: where the Moteur waited for stdin or used a side
// channel depends on what the adapter drives).
func WithDirectives(directives ...Directive) Option {
	return func(c *config) { c.directives = append(c.directives, directives...) }
}

// WithOnEvent calls the function on each event, after it is collected and
// before a request is answered: a test sends, interrupts there.
func WithOnEvent(onEvent func(context.Context, engine.Run, contracts.EngineEvent)) Option {
	return func(c *config) { c.onEvent = onEvent }
}

// WithLoggedEnv has the fake binary log the values of these variables, in
// Invocations.
func WithLoggedEnv(names ...string) Option {
	return func(c *config) { c.loggedEnv = append(c.loggedEnv, names...) }
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
	streamPath := Stream(t, stream, cfg.directives...)
	logs := t.TempDir()
	stdinLog := filepath.Join(logs, "stdin.jsonl")
	replyLog := filepath.Join(logs, "replies.jsonl")
	argvLog := filepath.Join(logs, "argv.jsonl")

	start := cfg.start
	start.BinaryPath = FakeBinary(t)
	if start.Dir == "" {
		start.Dir = t.TempDir()
	}
	start.Env = append(append([]string(nil), start.Env...),
		"FAKE_ENGINE_STREAM="+streamPath,
		"FAKE_ENGINE_STDIN_LOG="+stdinLog,
		"FAKE_ENGINE_EXIT="+strconv.Itoa(cfg.exit),
		"FAKE_ENGINE_REPLY_LOG="+replyLog,
		"FAKE_ENGINE_ARGV_LOG="+argvLog,
		"FAKE_ENGINE_LOG_ENV="+strings.Join(cfg.loggedEnv, ","),
	)

	ctx, cancel := context.WithTimeout(context.Background(), Timeout)
	t.Cleanup(cancel)
	var (
		run engine.Run
		err error
	)
	if cfg.resume != nil {
		run, err = e.Resume(ctx, engine.ResumeOptions{StartOptions: start, EngineSessionID: *cfg.resume})
	} else {
		run, err = e.Start(ctx, start)
	}
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
			if cfg.onEvent != nil {
				cfg.onEvent(ctx, run, event)
			}
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
	replayed.Stdin = lines(stdinLog)
	replayed.Replies = lines(replyLog)
	for _, line := range lines(argvLog) {
		var invocation Invocation
		if err := json.Unmarshal([]byte(line), &invocation); err != nil {
			t.Fatalf("enginetest: argv log %q: %v", line, err)
		}
		replayed.Invocations = append(replayed.Invocations, invocation)
	}

	compare(t, filepath.Join("testdata", golden+".golden.json"), render(t, replayed.Events))
	return replayed
}

func lines(path string) []string {
	logged, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return strings.FieldsFunc(string(logged), func(r rune) bool { return r == '\n' })
}

// Directive is a line {"fake":"…"} of the fake binary, played before the line
// Before (from 1) of a recording; past its last line, at its end.
type Directive struct {
	Before int
	Line   map[string]any
}

// AwaitStdin has the fake binary wait for a line on its stdin.
func AwaitStdin(before int) Directive {
	return Directive{Before: before, Line: map[string]any{"fake": "await-stdin"}}
}

// Stream gives the path of `testdata/<stream>.jsonl` with the directives
// inserted, a copy in the test's temporary folder when there are any.
func Stream(t testing.TB, stream string, directives ...Directive) string {
	t.Helper()
	path, err := filepath.Abs(filepath.Join("testdata", stream+".jsonl"))
	if err != nil {
		t.Fatalf("enginetest: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("enginetest: stream %s: %v", stream, err)
	}
	if len(directives) == 0 {
		return path
	}
	recorded := strings.SplitAfter(string(data), "\n")
	if recorded[len(recorded)-1] == "" {
		recorded = recorded[:len(recorded)-1]
	}
	var out strings.Builder
	for n := 1; n <= len(recorded)+1; n++ {
		for _, d := range directives {
			if d.Before == n || (n == len(recorded)+1 && d.Before > n) {
				line, err := json.Marshal(d.Line)
				if err != nil {
					t.Fatalf("enginetest: directive %+v: %v", d, err)
				}
				out.Write(append(line, '\n'))
			}
		}
		if n <= len(recorded) {
			out.WriteString(strings.TrimRight(recorded[n-1], "\n") + "\n")
		}
	}
	copied := filepath.Join(t.TempDir(), filepath.Base(stream)+".jsonl")
	if err := os.WriteFile(copied, []byte(out.String()), 0o644); err != nil {
		t.Fatalf("enginetest: %v", err)
	}
	return copied
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
