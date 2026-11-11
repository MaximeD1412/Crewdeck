package contracts

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

var runnerFixtures = filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "runner")

var engineEventKinds = []string{
	EngineEventKindAuthRequired, EngineEventKindError, EngineEventKindLimitReached, EngineEventKindMessage,
	EngineEventKindPermissionRequest, EngineEventKindQuestion, EngineEventKindResult, EngineEventKindToolCall,
	EngineEventKindToolResult, EngineEventKindUsage,
}

func readEventFixture(t *testing.T, kind string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(runnerFixtures, "events", kind+".json"))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// Each fixture of packages/contracts/fixtures/runner/events decodes into the
// type its kind names, and encodes back to the same event (its instants as
// time.Time writes them, its raw event compacted).
func TestEveryEngineEventFixtureDecodesIntoItsKindAndBack(t *testing.T) {
	entries, err := os.ReadDir(filepath.Join(runnerFixtures, "events"))
	if err != nil {
		t.Fatal(err)
	}
	var kinds []string
	for _, entry := range entries {
		kinds = append(kinds, strings.TrimSuffix(entry.Name(), ".json"))
	}
	sort.Strings(kinds)
	if !reflect.DeepEqual(kinds, engineEventKinds) {
		t.Fatalf("fixtures %v, want one per kind %v", kinds, engineEventKinds)
	}
	for _, kind := range kinds {
		data := readEventFixture(t, kind)
		var event EngineEvent
		if err := json.Unmarshal(data, &event); err != nil {
			t.Errorf("fixture %s: %v", kind, err)
			continue
		}
		if event.Kind() != kind {
			t.Errorf("fixture %s: decoded as %q", kind, event.Kind())
		}
		back, err := json.Marshal(event)
		if err != nil {
			t.Fatalf("fixture %s: encode: %v", kind, err)
		}
		var again EngineEvent
		if err := json.Unmarshal(back, &again); err != nil || again.Kind() != kind {
			t.Fatalf("fixture %s: encoded back as %s, %v", kind, back, err)
		}
		if twice, err := json.Marshal(again); err != nil || !bytes.Equal(twice, back) {
			t.Errorf("fixture %s: encoded as %s, then %s", kind, back, twice)
		}
	}
}

func TestAnEngineEventKeepsTheProvidersRawEventAsItCame(t *testing.T) {
	var event EngineEvent
	if err := json.Unmarshal(readEventFixture(t, "tool-call"), &event); err != nil {
		t.Fatal(err)
	}
	var raw struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(event.ToolCall.Raw, &raw); err != nil || raw.Type != "assistant" {
		t.Fatalf("raw %s: %v", event.ToolCall.Raw, err)
	}
}

func TestAnEngineEventWritesTheKindOfTheTypeSet(t *testing.T) {
	data, err := json.Marshal(EngineEvent{Error: &EngineEventError{Seq: 1, Code: "exit", Message: "code 1"}})
	if err != nil {
		t.Fatal(err)
	}
	var back EngineEvent
	if err := json.Unmarshal(data, &back); err != nil || back.Error == nil || back.Error.Kind != "error" {
		t.Fatalf("%s decoded as %+v, %v", data, back, err)
	}
	if _, err := json.Marshal(EngineEvent{}); err == nil {
		t.Fatal("an EngineEvent with no type set encodes")
	}
}

func TestAnEngineEventRefusesAnUnknownKindOrAnInvalidEvent(t *testing.T) {
	message := readEventFixture(t, "message")
	for name, data := range map[string][]byte{
		"unknown kind": []byte(strings.Replace(string(message), `"kind": "message"`, `"kind": "thinking"`, 1)),
		"seq 0":        []byte(strings.Replace(string(message), `"seq": 3`, `"seq": 0`, 1)),
		"no text":      []byte(strings.Replace(string(message), `"text":`, `"texte":`, 1)),
		"from pilot":   []byte(strings.Replace(string(message), `"from": "agent"`, `"from": "pilot"`, 1)),
		"bad status":   []byte(strings.Replace(string(readEventFixture(t, "result")), `"status": "ok"`, `"status": "done"`, 1)),
	} {
		var event EngineEvent
		if err := json.Unmarshal(data, &event); err == nil {
			t.Errorf("%s: decoded %+v", name, event.Value())
		}
	}
}

func TestEngineCapabilitiesDecodeTheSharedFixture(t *testing.T) {
	data, err := os.ReadFile(filepath.Join(runnerFixtures, "engines", "claude-code.json"))
	if err != nil {
		t.Fatal(err)
	}
	var caps EngineCapabilities
	if err := json.Unmarshal(data, &caps); err != nil {
		t.Fatal(err)
	}
	if caps.Engine != EngineIdClaudeCode || !caps.KnownVersion || caps.Account.Kind != EngineCapabilitiesAccountKindSubscription {
		t.Fatalf("decoded %+v", caps)
	}
	if last := caps.Models[len(caps.Models)-1]; last.Usable || last.Reason == nil || *last.Reason != EngineCapabilitiesModelsElemReasonQuotaReached {
		t.Fatalf("model %+v", last)
	}
}
