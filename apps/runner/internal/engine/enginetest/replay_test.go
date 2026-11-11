package enginetest

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
)

// toy is the smallest adapter there is: its Moteur speaks one JSON line per
// event ({"t":"say"|"ask"|"done", …}) and reads one per message, answer or
// interrupt. It runs opts.BinaryPath as a real adapter runs its Moteur.
type toy struct{}

func (toy) ID() contracts.EngineId { return contracts.EngineIdClaudeCode }

func (toy) Capabilities(context.Context) (contracts.EngineCapabilities, error) {
	return contracts.EngineCapabilities{Engine: contracts.EngineIdClaudeCode}, nil
}

func (t toy) Resume(ctx context.Context, opts engine.ResumeOptions) (engine.Run, error) {
	return t.Start(ctx, opts.StartOptions)
}

func (toy) Start(ctx context.Context, opts engine.StartOptions) (engine.Run, error) {
	cmd := exec.CommandContext(ctx, opts.BinaryPath, "--toy")
	cmd.Dir = opts.Dir
	cmd.Env = append(os.Environ(), opts.Env...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	run := &toyRun{cmd: cmd, stdin: stdin, events: make(chan contracts.EngineEvent)}
	go run.read(stdout)
	return run, run.write(map[string]any{"t": "user", "text": opts.InitialPrompt})
}

type toyRun struct {
	cmd    *exec.Cmd
	mu     sync.Mutex
	stdin  io.WriteCloser
	events chan contracts.EngineEvent
}

type toyLine struct {
	T       string   `json:"t"`
	Text    string   `json:"text"`
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Options []string `json:"options"`
	Session string   `json:"session"`
}

func (r *toyRun) read(stdout io.Reader) {
	defer close(r.events)
	lines := bufio.NewScanner(stdout)
	seq := 0
	for lines.Scan() {
		raw := json.RawMessage(append([]byte(nil), lines.Bytes()...))
		var line toyLine
		if err := json.Unmarshal(raw, &line); err != nil {
			continue
		}
		var event contracts.EngineEvent
		switch line.T {
		case "say":
			event.Message = &contracts.EngineEventMessage{From: "agent", Text: line.Text, Final: true, Raw: raw}
		case "ask":
			var options []contracts.EngineEventQuestionOptionsElem
			for _, label := range line.Options {
				options = append(options, contracts.EngineEventQuestionOptionsElem{Label: label})
			}
			event.Question = &contracts.EngineEventQuestion{RequestId: line.ID, Title: line.Title, Options: options, Raw: raw}
		case "done":
			event.Result = &contracts.EngineEventResult{Status: contracts.EngineEventResultStatusOk, EngineSessionId: &line.Session, Raw: raw}
		default:
			continue
		}
		seq++
		r.events <- engine.Stamp(event, seq, time.Now())
	}
}

func (r *toyRun) write(line map[string]any) error {
	data, err := json.Marshal(line)
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	_, err = r.stdin.Write(append(data, '\n'))
	return err
}

func (r *toyRun) Events() <-chan contracts.EngineEvent { return r.events }
func (r *toyRun) Send(_ context.Context, text string) error {
	return r.write(map[string]any{"t": "user", "text": text})
}
func (r *toyRun) Answer(_ context.Context, id string, answer engine.Answer) error {
	return r.write(map[string]any{"t": "answer", "id": id, "options": answer.Options})
}
func (r *toyRun) Interrupt(context.Context) error { return r.write(map[string]any{"t": "interrupt"}) }
func (r *toyRun) Wait() error {
	for range r.events { // the run ends once its stream is read
	}
	return r.cmd.Wait()
}

func TestReplayDrivesAnAdapterThroughTheFakeBinaryAnswersItsQuestionAndMatchesTheGolden(t *testing.T) {
	replayed := Replay(t, toy{}, "toy", "toy")
	if replayed.Err != nil {
		t.Fatalf("the run ended with %v", replayed.Err)
	}
	if len(replayed.Events) != 4 || replayed.Events[1].Question == nil {
		t.Fatalf("events %+v", replayed.Events)
	}
	if raw := replayed.Events[0].Message.Raw; !strings.Contains(string(raw), `"Bonjour"`) {
		t.Fatalf("raw %s", raw)
	}
	want := []string{
		`{"t":"user","text":"Rejoue la Session"}`,
		`{"id":"q-1","options":["Bleu"],"t":"answer"}`,
	}
	if strings.Join(replayed.Stdin, "\n") != strings.Join(want, "\n") {
		t.Fatalf("the fake binary read %q, want %q", replayed.Stdin, want)
	}
}

func TestReplayWithUpdateRewritesTheGolden(t *testing.T) {
	stream, err := os.ReadFile(filepath.Join("testdata", "toy.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	committed, err := os.ReadFile(filepath.Join("testdata", "toy.golden.json"))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "testdata"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "testdata", "toy.jsonl"), stream, 0o644); err != nil {
		t.Fatal(err)
	}
	golden := filepath.Join(dir, "testdata", "stale.golden.json")
	if err := os.WriteFile(golden, []byte("[]\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Chdir(dir)

	if failures := replayFailures(t, "toy", "stale"); len(failures) == 0 {
		t.Fatal("a stale golden matched")
	}
	*update = true
	defer func() { *update = false }()
	Replay(t, toy{}, "toy", "stale")
	*update = false
	if rewritten, _ := os.ReadFile(golden); string(rewritten) != string(committed) {
		t.Fatalf("rewritten as\n%s\nwant\n%s", rewritten, committed)
	}
	if failures := replayFailures(t, "toy", "stale"); len(failures) != 0 {
		t.Fatalf("the rewritten golden fails: %v", failures)
	}
}

func TestReplayGivesTheExitOfTheMoteur(t *testing.T) {
	replayed := Replay(t, toy{}, "toy", "toy", WithExit(3))
	var exit *exec.ExitError
	if !asExit(replayed.Err, &exit) || exit.ExitCode() != 3 {
		t.Fatalf("Err %v, want exit status 3", replayed.Err)
	}
}

func asExit(err error, target **exec.ExitError) bool {
	exit, ok := err.(*exec.ExitError)
	*target = exit
	return ok
}

// recorder is a testing.TB whose failures are kept rather than reported.
type recorder struct {
	testing.TB
	mu       sync.Mutex
	failures []string
}

func (r *recorder) Errorf(format string, args ...any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.failures = append(r.failures, fmt.Sprintf(format, args...))
}

func (r *recorder) Fatalf(format string, args ...any) {
	r.Errorf(format, args...)
	runtime.Goexit()
}

func replayFailures(t *testing.T, stream, golden string) []string {
	r := &recorder{TB: t}
	done := make(chan struct{})
	go func() {
		defer close(done)
		Replay(r, toy{}, stream, golden)
	}()
	<-done
	return r.failures
}
