package claude_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/claude"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/enginetest"
)

// runnerPath is crewdeck-runner, built once: Claude Code's side of a Session
// (the permission tool, the hook) runs it.
var runnerPath string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "crewdeck-runner-test-")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	runnerPath = filepath.Join(dir, "crewdeck-runner")
	if err := enginetest.Build("github.com/maximed1412/crewdeck/apps/runner/cmd/crewdeck-runner", runnerPath); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

func newEngine() *claude.Engine {
	return &claude.Engine{RunnerPath: runnerPath}
}

// The recordings of testdata (the spike's, docs/spikes/engines.md), and what
// a replay of each needs beyond its stream.
type recording struct {
	name   string
	opts   []enginetest.Option
	sends  []string // sent after each `result`, in order
	resume string
}

var recordings = []recording{
	{name: "01-plain-turn"},
	{name: "02-permission-allow", sends: []string{"Now use the Bash tool to run exactly `touch second.txt`, then say done."}},
	{name: "02-permission-deny"},
	{name: "02-permission-idle-timeout"},
	{name: "02-permission-idle-timeout-off"},
	{name: "03-a-updated-input"},
	{name: "03-b-deny-reason"},
	{name: "03-c-held-2h"},
	{name: "04-interrupt"},
	{name: "04-resume", resume: "4a000000-0000-4000-8000-000000000014"},
	{name: "05-a-kill-mid-stream", opts: []enginetest.Option{enginetest.WithExit(137)}},
	{name: "05-a-resume", resume: "5a000000-0000-4000-8000-000000000005"},
	{name: "05-b-kill-pending-permission", opts: []enginetest.Option{enginetest.WithExit(137)}},
	{name: "05-b-resume", resume: "5b000000-0000-4000-8000-000000000005"},
	{name: "06-a-usage-subscription", sends: []string{"Réponds seulement « deux »."}},
	{name: "07-a-subscription"},
	{name: "07-b-not-signed-in"},
	{name: "07-c-unknown-model", opts: []enginetest.Option{enginetest.WithStartOptions(engine.StartOptions{Model: "claude-nonexistent-9", InitialPrompt: "Réponds seulement « ok »."})}},
	{name: "08-skills-mounting"},
	{name: "09-b-auto"},
	{name: "09-c-auto-outside"},
}

func TestEveryRecordingReplaysToItsGolden(t *testing.T) {
	entries, err := os.ReadDir("testdata")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		name, ok := strings.CutSuffix(entry.Name(), ".jsonl")
		if !ok || strings.Contains(name, ".") {
			continue
		}
		if !slices.ContainsFunc(recordings, func(r recording) bool { return r.name == name }) {
			t.Errorf("testdata/%s.jsonl is replayed by no test", name)
		}
	}
	for _, r := range recordings {
		t.Run(r.name, func(t *testing.T) {
			t.Parallel()
			opts := append([]enginetest.Option{enginetest.WithDirectives(directives(t, r.name)...)}, r.opts...)
			if len(r.sends) > 0 {
				opts = append(opts, sendAfterEachResult(r.sends...))
			}
			if r.name == "04-interrupt" {
				opts = append(opts, interruptTheBashCall(), sendAfterEachResult("Ne lance rien. Réponds seulement : « reçu après interruption »."))
			}
			if r.resume != "" {
				opts = append(opts, enginetest.WithResume(r.resume))
			}
			enginetest.Replay(t, newEngine(), r.name, r.name, opts...)
		})
	}
}

func TestAPermissionAllowedLetsTheToolRunAndADeniedOneGivesClaudeTheRefusal(t *testing.T) {
	answers := []bool{true, false}
	var mu sync.Mutex
	replayed := enginetest.Replay(t, newEngine(), "02-permission-allow", "02-permission-allow",
		enginetest.WithDirectives(directives(t, "02-permission-allow")...),
		sendAfterEachResult("Now use the Bash tool to run exactly `touch second.txt`, then say done."),
		enginetest.WithAnswer(func(contracts.EngineEvent) engine.Answer {
			mu.Lock()
			defer mu.Unlock()
			allow := answers[0]
			answers = answers[1:]
			return engine.Answer{Allow: &allow, Text: "Pas maintenant."}
		}),
	)
	requests := kinds(replayed.Events, contracts.EngineEventKindPermissionRequest)
	if len(requests) != 2 || requests[0].PermissionRequest.Tool != "Bash" || requests[0].PermissionRequest.Command != "touch allowed.txt" || requests[0].PermissionRequest.RequestId != "toolu_012qFBgnEYDhQujmDHZwgJDs" {
		t.Fatalf("permission requests %s", render(requests))
	}
	if len(replayed.Replies) != 2 {
		t.Fatalf("replies %q", replayed.Replies)
	}
	allowed, denied := decode(t, replayed.Replies[0]), decode(t, replayed.Replies[1])
	input, _ := json.Marshal(allowed["updatedInput"])
	if allowed["behavior"] != "allow" || !strings.Contains(string(input), `"command":"touch allowed.txt"`) {
		t.Errorf("the allowed call got %s", replayed.Replies[0])
	}
	if denied["behavior"] != "deny" || denied["message"] != "Pas maintenant." {
		t.Errorf("the denied call got %s", replayed.Replies[1])
	}
}

func TestADeniedPermissionWithNoTextGivesTheDefaultRefusal(t *testing.T) {
	replayed := enginetest.Replay(t, newEngine(), "02-permission-deny", "02-permission-deny",
		enginetest.WithDirectives(directives(t, "02-permission-deny")...),
		enginetest.WithAnswer(func(contracts.EngineEvent) engine.Answer {
			deny := false
			return engine.Answer{Allow: &deny}
		}),
	)
	if len(replayed.Replies) != 1 || decode(t, replayed.Replies[0])["message"] != "Refusé par le Pilote." {
		t.Fatalf("replies %q", replayed.Replies)
	}
}

func TestAnAskUserQuestionBecomesAQuestionWhoseAnswerReachesTheAgentThroughTheHook(t *testing.T) {
	replayed := enginetest.Replay(t, newEngine(), "03-a-updated-input", "03-a-updated-input",
		enginetest.WithDirectives(directives(t, "03-a-updated-input")...),
		enginetest.WithAnswer(func(contracts.EngineEvent) engine.Answer { return engine.Answer{Options: []string{"Bleu"}} }),
	)
	questions := kinds(replayed.Events, contracts.EngineEventKindQuestion)
	if len(questions) != 1 {
		t.Fatalf("questions %s", render(questions))
	}
	q := questions[0].Question
	if q.RequestId != "toolu_01KYG2Q9dXrQRxtp2hpymKjG" || q.Title != "Quelle couleur pour le titre du README ?" || q.Multiple || len(q.Options) != 2 || q.Options[1].Label != "Bleu" || q.Options[1].Detail == nil || *q.Options[1].Detail != "Titre du README en bleu" {
		t.Fatalf("question %s", render(questions))
	}
	if len(replayed.Replies) != 1 {
		t.Fatalf("replies %q", replayed.Replies)
	}
	var output struct {
		HookSpecificOutput struct {
			PermissionDecision string `json:"permissionDecision"`
			UpdatedInput       struct {
				Questions []json.RawMessage `json:"questions"`
				Answers   map[string]string `json:"answers"`
			} `json:"updatedInput"`
		} `json:"hookSpecificOutput"`
	}
	if err := json.Unmarshal([]byte(replayed.Replies[0]), &output); err != nil {
		t.Fatal(err)
	}
	if output.HookSpecificOutput.PermissionDecision != "allow" || len(output.HookSpecificOutput.UpdatedInput.Questions) != 1 || output.HookSpecificOutput.UpdatedInput.Answers["Quelle couleur pour le titre du README ?"] != "Bleu" {
		t.Fatalf("the hook printed %s", replayed.Replies[0])
	}
}

func TestInterruptEndsTheTurnAsInterruptedAndResumePassesTheKeptSessionID(t *testing.T) {
	replayed := enginetest.Replay(t, newEngine(), "04-interrupt", "04-interrupt",
		enginetest.WithDirectives(directives(t, "04-interrupt")...),
		interruptTheBashCall(),
		sendAfterEachResult("Ne lance rien. Réponds seulement : « reçu après interruption »."),
	)
	results := kinds(replayed.Events, contracts.EngineEventKindResult)
	if len(results) != 2 || results[0].Result.Status != contracts.EngineEventResultStatusInterrupted || results[1].Result.Status != contracts.EngineEventResultStatusOk {
		t.Fatalf("results %s", render(results))
	}
	if len(replayed.Stdin) != 3 || !strings.Contains(replayed.Stdin[1], `"subtype":"interrupt"`) || !strings.Contains(replayed.Stdin[1], `"type":"control_request"`) {
		t.Fatalf("stdin %q", replayed.Stdin)
	}
	kept := results[0].Result.EngineSessionId
	if kept == nil || *kept != "4a000000-0000-4000-8000-000000000014" {
		t.Fatalf("engineSessionId %v", kept)
	}

	resumed := enginetest.Replay(t, newEngine(), "04-resume", "04-resume",
		enginetest.WithDirectives(directives(t, "04-resume")...),
		enginetest.WithResume(*kept),
	)
	if len(resumed.Invocations) != 1 {
		t.Fatalf("invocations %+v", resumed.Invocations)
	}
	args := resumed.Invocations[0].Args
	if i := slices.Index(args, "--resume"); i < 0 || i+1 >= len(args) || args[i+1] != *kept {
		t.Fatalf("argv %q: want --resume %s", args, *kept)
	}
}

func TestTheCommandLineIsTheOneOfTheSpike(t *testing.T) {
	for _, tc := range []struct {
		mode engine.PermissionMode
		want string
	}{{engine.PermissionAuto, "auto"}, {engine.PermissionBypass, "bypassPermissions"}} {
		replayed := enginetest.Replay(t, newEngine(), "01-plain-turn", "01-plain-turn",
			enginetest.WithDirectives(directives(t, "01-plain-turn")...),
			enginetest.WithStartOptions(engine.StartOptions{Model: "haiku", PermissionMode: tc.mode, SkillsDir: "/skills", InitialPrompt: "Lis le README."}),
		)
		args := replayed.Invocations[0].Args
		for _, want := range [][]string{
			{"-p"}, {"--input-format", "stream-json"}, {"--output-format", "stream-json"}, {"--verbose"},
			{"--model", "haiku"}, {"--permission-mode", tc.want}, {"--plugin-dir", "/skills"},
			{"--permission-prompt-tool", "mcp__crewdeck__permission"},
		} {
			if !containsRun(args, want) {
				t.Errorf("argv %q has no %q", args, want)
			}
		}
		for _, flag := range []string{"--mcp-config", "--settings"} {
			i := slices.Index(args, flag)
			if i < 0 || i+1 >= len(args) {
				t.Fatalf("argv %q has no %s", args, flag)
			}
		}
		if len(replayed.Stdin) != 1 || !strings.Contains(replayed.Stdin[0], `"content":"Lis le README."`) || !strings.Contains(replayed.Stdin[0], `"type":"user"`) {
			t.Errorf("stdin %q", replayed.Stdin)
		}
	}
}

func TestTheAPIKeyIsInTheEnvironmentAndInNoArgument(t *testing.T) {
	const key = "sk-ant-api03-test-key-not-real"
	e := newEngine()
	e.APIKey = func(context.Context) (string, error) { return key, nil }
	replayed := enginetest.Replay(t, e, "01-plain-turn", "01-plain-turn",
		enginetest.WithDirectives(directives(t, "01-plain-turn")...),
		enginetest.WithLoggedEnv("ANTHROPIC_API_KEY"),
	)
	for _, arg := range replayed.Invocations[0].Args {
		if strings.Contains(arg, key) {
			t.Fatalf("the key is in the argument %q", arg)
		}
		if strings.HasSuffix(arg, ".json") {
			if data, err := os.ReadFile(arg); err == nil && strings.Contains(string(data), key) {
				t.Fatalf("the key is written in %s", arg)
			}
		}
	}
	if replayed.Invocations[0].Env["ANTHROPIC_API_KEY"] != key {
		t.Fatalf("env %v", replayed.Invocations[0].Env)
	}
}

func TestWithoutAnAPIKeyTheRunnersOwnIsNotPassedOn(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "sk-ant-of-the-runner-environment")
	replayed := enginetest.Replay(t, newEngine(), "01-plain-turn", "01-plain-turn",
		enginetest.WithDirectives(directives(t, "01-plain-turn")...),
		enginetest.WithLoggedEnv("ANTHROPIC_API_KEY"),
	)
	if _, ok := replayed.Invocations[0].Env["ANTHROPIC_API_KEY"]; ok {
		t.Fatalf("env %v: a subscription's Session got an API key", replayed.Invocations[0].Env)
	}
}

func TestCapabilitiesReportsTheThreeAccountStatesOfTheSpike(t *testing.T) {
	version := "FAKE_ENGINE_VERSION=2.1.319 (Claude Code)"
	probe := func(t *testing.T, stream string) *claude.Engine {
		e := newEngine()
		e.BinaryPath = enginetest.FakeBinary(t)
		e.Env = []string{version, "FAKE_ENGINE_STREAM=" + enginetest.Stream(t, stream, enginetest.AwaitStdin(1))}
		return e
	}

	t.Run("subscription", func(t *testing.T) {
		caps, err := probe(t, "07-a-subscription").Capabilities(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if !caps.Installed || caps.Version == nil || *caps.Version != "2.1.319" || !caps.KnownVersion || caps.Engine != contracts.EngineIdClaudeCode {
			t.Fatalf("caps %+v", caps)
		}
		if caps.Account.Kind != contracts.EngineCapabilitiesAccountKindSubscription || caps.Account.State != contracts.EngineCapabilitiesAccountStateConnected {
			t.Fatalf("account %+v", caps.Account)
		}
		if !(caps.Features.Interrupt && caps.Features.Resume && caps.Features.Questions && caps.Features.Permissions) {
			t.Fatalf("features %+v", caps.Features)
		}
		opus := model(t, caps, "opus")
		if opus.Label != "Opus 5.5" || !opus.Usable || opus.Reason != nil {
			t.Fatalf("opus %+v", opus)
		}
	})

	t.Run("not signed in", func(t *testing.T) {
		caps, err := probe(t, "07-b-not-signed-in").Capabilities(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if caps.Account.Kind != contracts.EngineCapabilitiesAccountKindNone || caps.Account.State != contracts.EngineCapabilitiesAccountStateLoginRequired {
			t.Fatalf("account %+v", caps.Account)
		}
		haiku := model(t, caps, "haiku")
		if haiku.Usable || haiku.Reason == nil || *haiku.Reason != contracts.EngineCapabilitiesModelsElemReasonLoginRequired {
			t.Fatalf("haiku %+v", haiku)
		}
	})

	t.Run("api key", func(t *testing.T) {
		e := probe(t, "07-b-not-signed-in")
		e.APIKey = func(context.Context) (string, error) { return "sk-ant-api03-test-key-not-real", nil }
		caps, err := e.Capabilities(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if caps.Account.Kind != contracts.EngineCapabilitiesAccountKindApiKey || caps.Account.State != contracts.EngineCapabilitiesAccountStateConnected {
			t.Fatalf("account %+v", caps.Account)
		}
		if haiku := model(t, caps, "haiku"); !haiku.Usable {
			t.Fatalf("haiku %+v", haiku)
		}
	})

	t.Run("a model the binary refused", func(t *testing.T) {
		e := probe(t, "07-c-unknown-model")
		enginetest.Replay(t, e, "07-c-unknown-model", "07-c-unknown-model",
			enginetest.WithDirectives(directives(t, "07-c-unknown-model")...),
			enginetest.WithStartOptions(engine.StartOptions{Model: "claude-nonexistent-9", InitialPrompt: "Réponds seulement « ok »."}),
		)
		caps, err := e.Capabilities(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		refused := model(t, caps, "claude-nonexistent-9")
		if refused.Usable || refused.Reason == nil || *refused.Reason != contracts.EngineCapabilitiesModelsElemReasonNotInPlan {
			t.Fatalf("refused %+v", refused)
		}
		if !model(t, caps, "haiku").Usable {
			t.Fatal("haiku is no longer usable")
		}
	})

	t.Run("an unknown version", func(t *testing.T) {
		e := probe(t, "07-a-subscription")
		e.Env[0] = "FAKE_ENGINE_VERSION=3.0.0 (Claude Code)"
		caps, err := e.Capabilities(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if caps.Version == nil || *caps.Version != "3.0.0" || caps.KnownVersion {
			t.Fatalf("caps %+v", caps)
		}
	})

	t.Run("not installed", func(t *testing.T) {
		e := newEngine()
		e.BinaryPath = filepath.Join(t.TempDir(), "claude")
		caps, err := e.Capabilities(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if caps.Installed || caps.Version != nil || caps.Account.Kind != contracts.EngineCapabilitiesAccountKindNone {
			t.Fatalf("caps %+v", caps)
		}
	})
}

func model(t *testing.T, caps contracts.EngineCapabilities, id string) contracts.EngineCapabilitiesModelsElem {
	t.Helper()
	for _, m := range caps.Models {
		if m.Id == id {
			return m
		}
	}
	t.Fatalf("no model %s in %+v", id, caps.Models)
	return contracts.EngineCapabilitiesModelsElem{}
}

// interruptTheBashCall interrupts the run once Claude starts the long Bash
// call of 04-interrupt, as the spike's driver did.
func interruptTheBashCall() enginetest.Option {
	var once sync.Once
	return enginetest.WithOnEvent(func(ctx context.Context, run engine.Run, event contracts.EngineEvent) {
		if event.ToolCall != nil && event.ToolCall.Tool == "Bash" {
			once.Do(func() {
				if err := run.Interrupt(ctx); err != nil {
					panic(err)
				}
			})
		}
	})
}

// sendAfterEachResult sends the texts in order, one after each `result`, as
// the spike's driver did.
func sendAfterEachResult(texts ...string) enginetest.Option {
	var mu sync.Mutex
	return enginetest.WithOnEvent(func(ctx context.Context, run engine.Run, event contracts.EngineEvent) {
		mu.Lock()
		defer mu.Unlock()
		if event.Result != nil && len(texts) > 0 {
			if err := run.Send(ctx, texts[0]); err != nil {
				panic(err)
			}
			texts = texts[1:]
		}
	})
}

func kinds(events []contracts.EngineEvent, kind string) []contracts.EngineEvent {
	var out []contracts.EngineEvent
	for _, e := range events {
		if e.Kind() == kind {
			out = append(out, e)
		}
	}
	return out
}

func render(events []contracts.EngineEvent) string {
	data, _ := json.Marshal(events)
	return string(data)
}

func decode(t *testing.T, text string) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		t.Fatalf("%q: %v", text, err)
	}
	return out
}

func containsRun(args, run []string) bool {
	for i := range args {
		if i+len(run) <= len(args) && slices.Equal(args[i:i+len(run)], run) {
			return true
		}
	}
	return false
}
