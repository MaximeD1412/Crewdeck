package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/fake"
)

// The texts of the replayed Session, none of which may reach the log.
var secrets = []string{
	"Rejoue la Session : le prompt du Pilote",
	"Voici le plan secret de la refonte",
	"cat ~/.ssh/id_ed25519",
	"Quelle base choisir ?",
	"PostgreSQL privé",
	"Le résumé final de la Session",
	"sk-ant-api03-secret",
}

func sessionEvents() []contracts.EngineEvent {
	return []contracts.EngineEvent{
		{Message: &contracts.EngineEventMessage{Kind: contracts.EngineEventKindMessage, From: "agent", Text: secrets[1], Raw: json.RawMessage(`{"text":"` + secrets[1] + `"}`)}},
		{ToolCall: &contracts.EngineEventToolCall{Kind: contracts.EngineEventKindToolCall, CallId: "t1", Tool: "Bash", Target: &secrets[2]}},
		{Question: &contracts.EngineEventQuestion{Kind: contracts.EngineEventKindQuestion, RequestId: "q1", Title: secrets[3], Options: []contracts.EngineEventQuestionOptionsElem{{Label: secrets[4], Detail: &secrets[5]}}}},
		{Result: &contracts.EngineEventResult{Kind: contracts.EngineEventKindResult, Status: contracts.EngineEventResultStatusOk}},
	}
}

func TestTheLogOfAReplayedSessionHoldsNoTextOfIt(t *testing.T) {
	t.Setenv(LevelEnv, "debug")
	var log bytes.Buffer
	logger := New(&log)

	e := &fake.Engine{Events: sessionEvents()}
	run, err := e.Start(context.Background(), engine.StartOptions{InitialPrompt: secrets[0], Env: []string{"ANTHROPIC_API_KEY=" + secrets[6]}})
	if err != nil {
		t.Fatal(err)
	}
	logger.Info("session started", "engine", e.ID(), "prompt", secrets[0], "key", secrets[6])
	for event := range run.Events() {
		Event(logger, event)
		// Even an event, or its text, given whole to the logger.
		logger.Debug("engine event, whole", "event", event, "text", event.Message)
		if id := requestIDOf(event); id != "" {
			_ = run.Answer(context.Background(), id, engine.Answer{Options: []string{secrets[4]}})
			logger.Debug("answered", "requestId", id, "answer", secrets[4])
		}
	}
	if err := run.Wait(); err != nil {
		t.Fatal(err)
	}

	for _, secret := range secrets {
		if strings.Contains(log.String(), secret) {
			t.Errorf("the log holds %q:\n%s", secret, log.String())
		}
	}
	lines := strings.Split(strings.TrimSpace(log.String()), "\n")
	var kinds []string
	for _, line := range lines {
		var entry map[string]any
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("a log line is not JSON: %q", line)
		}
		if entry["msg"] == "engine event" {
			kinds = append(kinds, entry["kind"].(string))
		}
	}
	if strings.Join(kinds, ",") != "message,tool-call,question,result" {
		t.Fatalf("the events logged are %v:\n%s", kinds, log.String())
	}
}

func requestIDOf(event contracts.EngineEvent) string {
	if event.Question != nil {
		return event.Question.RequestId
	}
	return ""
}

func TestTheLogIsInfoAndAboveUnlessCrewdeckLogIsDebug(t *testing.T) {
	t.Setenv(LevelEnv, "")
	var log bytes.Buffer
	logger := New(&log)
	logger.Debug("hidden")
	logger.Info("shown")
	if strings.Contains(log.String(), "hidden") || !strings.Contains(log.String(), `"msg":"shown"`) {
		t.Fatalf("log:\n%s", log.String())
	}

	t.Setenv(LevelEnv, "debug")
	log.Reset()
	New(&log).Debug("shown in debug")
	if !strings.Contains(log.String(), `"level":"DEBUG"`) {
		t.Fatalf("log:\n%s", log.String())
	}
}
