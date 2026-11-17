package protocol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

var fixturesDir = filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "runner")

// Each fixture of the protocol decodes into its generated type, and into the envelope with its type.
func TestEveryFixtureOfTheProtocolDecodesIntoItsGeneratedType(t *testing.T) {
	decoders := map[string]func([]byte) error{
		TypeHello:             decodeInto[contracts.RunnerHello],
		TypeHelloAccepted:     decodeInto[contracts.RunnerHelloAccepted],
		TypeHelloRejected:     decodeInto[contracts.RunnerHelloRejected],
		TypeHeartbeat:         decodeInto[contracts.RunnerHeartbeat],
		TypeHeartbeatAck:      decodeInto[contracts.RunnerHeartbeatAck],
		TypeError:             decodeInto[contracts.RunnerError],
		TypeStepVerdict:       decodeInto[contracts.RunnerStepVerdict],
		TypeCapabilities:      decodeInto[contracts.RunnerCapabilities],
		TypeMcpServers:        decodeInto[contracts.RunnerMcpServers],
		TypeGitHubChanged:     decodeInto[contracts.RunnerGithubChanged],
		TypeMirrorResync:      decodeInto[contracts.RunnerMirrorResync],
		TypeMirrorLive:        decodeInto[contracts.RunnerMirrorLive],
		TypeMirrorProjects:    decodeInto[contracts.RunnerMirrorProjects],
		TypeMirrorToken:       decodeInto[contracts.RunnerMirrorToken],
		TypeMirrorTokenIssued: decodeInto[contracts.RunnerMirrorTokenIssued],
		TypeMirrorTokenFailed: decodeInto[contracts.RunnerMirrorTokenFailed],
		TypeSessionStart:      decodeInto[contracts.RunnerSessionStart],
		TypeSessionStop:       decodeInto[contracts.RunnerSessionStop],
		TypeSessionResume:     decodeInto[contracts.RunnerSessionResume],
		TypeSessionState:      decodeInto[contracts.RunnerSessionState],
	}
	entries, err := os.ReadDir(fixturesDir)
	if err != nil {
		t.Fatalf("read %s: %v", fixturesDir, err)
	}
	var seen []string
	for _, entry := range entries {
		if entry.IsDir() { // events/, engines/: not messages of the protocol
			continue
		}
		typ := strings.TrimSuffix(entry.Name(), ".json")
		decode, ok := decoders[typ]
		if !ok {
			t.Errorf("fixture %s: no generated type maps it", entry.Name())
			continue
		}
		data, err := os.ReadFile(filepath.Join(fixturesDir, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if err := decode(data); err != nil {
			t.Errorf("fixture %s: %v", entry.Name(), err)
		}
		if got, err := typeOf(data); err != nil || got != typ {
			t.Errorf("fixture %s: envelope type %q, %v", entry.Name(), got, err)
		}
		seen = append(seen, typ)
	}
	sort.Strings(seen)
	if len(seen) != len(decoders) {
		t.Errorf("fixtures %v, want one per type of %d", seen, len(decoders))
	}
}

func decodeInto[T any](data []byte) error {
	var message T
	return json.Unmarshal(data, &message)
}

func TestTheHelloAndTheHeartbeatMatchTheirSchema(t *testing.T) {
	hello := NewHello(Machine{RunnerVersion: "0.1.0", Machine: "atelier", OS: contracts.RunnerHelloOsLinux, Arch: contracts.RunnerHelloArchAmd64}, nil)
	data, err := json.Marshal(hello)
	if err != nil {
		t.Fatal(err)
	}
	var back contracts.RunnerHello
	if err := json.Unmarshal(data, &back); err != nil {
		t.Fatalf("decode the hello: %v", err)
	}
	if back.ProtocolVersion != contracts.ProtocolVersion || back.Type != TypeHello || !uuidV7.MatchString(back.Id) {
		t.Fatalf("hello %+v", back)
	}
	beat, err := json.Marshal(NewHeartbeat())
	if err != nil {
		t.Fatal(err)
	}
	if err := decodeInto[contracts.RunnerHeartbeat](beat); err != nil {
		t.Fatalf("decode the heartbeat: %v", err)
	}
}

// The relay's fixtures (SESSION-1) are in relay/, beside the tab's
// (`tab.<type>.json`), which the Runner never reads: each of the Runner's
// decodes into its generated type, and a frame outside its schema does not.
func TestEveryFixtureOfTheRelayDecodesIntoItsGeneratedType(t *testing.T) {
	decoders := map[string]func([]byte) error{
		TypeSessionReplay: decodeInto[contracts.RunnerSessionReplay],
		TypeSessionInput:  decodeInto[contracts.RunnerSessionInput],
		TypeSessionKeys:   decodeInto[contracts.RunnerSessionKeys],
		TypeRelay:         decodeInto[contracts.RunnerRelay],
	}
	dir := filepath.Join(fixturesDir, "relay")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	seen := 0
	for _, entry := range entries {
		typ := strings.TrimSuffix(entry.Name(), ".json")
		if strings.HasPrefix(typ, "tab.") {
			continue
		}
		decode, ok := decoders[typ]
		if !ok {
			t.Errorf("fixture %s: no generated type maps it", entry.Name())
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if err := decode(data); err != nil {
			t.Errorf("fixture %s: %v", entry.Name(), err)
		}
		seen++
	}
	if seen != len(decoders) {
		t.Errorf("%d fixtures, want one per type of %d", seen, len(decoders))
	}
	var replay map[string]any
	data, _ := os.ReadFile(filepath.Join(dir, "session.replay.json"))
	if err := json.Unmarshal(data, &replay); err != nil {
		t.Fatal(err)
	}
	delete(replay, "tabId")
	data, _ = json.Marshal(replay)
	if decodeInto[contracts.RunnerSessionReplay](data) == nil {
		t.Error("a session.replay without its tabId decodes")
	}
}

func TestTheRelaysFramesMatchTheirSchemaWithOrWithoutTheirTab(t *testing.T) {
	wraps := []contracts.RunnerSessionKeysWrapsElem{{HolderId: strings.Repeat("A", 43), Enc: strings.Repeat("B", 43), WrappedKey: strings.Repeat("C", 64), Tag: strings.Repeat("D", 43)}}
	for _, message := range []any{
		NewSessionKeys("019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a91", "", wraps),
		NewSessionKeys("019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a91", "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6aa1", wraps),
		NewRelay("019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a91", "", 1, strings.Repeat("E", 16), strings.Repeat("F", 22)),
		NewRelay("019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a91", "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6aa1", 2, strings.Repeat("E", 16), strings.Repeat("F", 22)),
	} {
		data, err := json.Marshal(message)
		if err != nil {
			t.Fatal(err)
		}
		var err2 error
		switch message.(type) {
		case contracts.RunnerSessionKeys:
			err2 = decodeInto[contracts.RunnerSessionKeys](data)
		case contracts.RunnerRelay:
			err2 = decodeInto[contracts.RunnerRelay](data)
		}
		if err2 != nil {
			t.Errorf("%s: %v", data, err2)
		}
		if strings.Contains(string(data), `"tabId":""`) {
			t.Errorf("%s: an empty tabId", data)
		}
	}
}

// The Commandes' fixtures (RUNNER-18) are in command/, beside the tab's:
// each of the Runner's decodes into its generated type, and the messages the
// Runner makes match their schema, a verdict without an exit code included.
func TestEveryFixtureOfTheCommandesDecodesIntoItsGeneratedType(t *testing.T) {
	decoders := map[string]func([]byte) error{
		TypeCommandRun:     decodeInto[contracts.RunnerCommandRun],
		TypeCommandStop:    decodeInto[contracts.RunnerCommandStop],
		TypeCommandReplay:  decodeInto[contracts.RunnerCommandReplay],
		TypeCommandStarted: decodeInto[contracts.RunnerCommandStarted],
		TypeCommandVerdict: decodeInto[contracts.RunnerCommandVerdict],
		TypeCommandKeys:    decodeInto[contracts.RunnerCommandKeys],
		TypeCommandOutput:  decodeInto[contracts.RunnerCommandOutput],
	}
	dir := filepath.Join(fixturesDir, "command")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	seen := 0
	for _, entry := range entries {
		typ := strings.TrimSuffix(entry.Name(), ".json")
		if strings.HasPrefix(typ, "tab.") {
			continue
		}
		decode, ok := decoders[typ]
		if !ok {
			t.Errorf("fixture %s: no generated type maps it", entry.Name())
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if err := decode(data); err != nil {
			t.Errorf("fixture %s: %v", entry.Name(), err)
		}
		if got, err := typeOf(data); err != nil || got != typ {
			t.Errorf("fixture %s: envelope type %q, %v", entry.Name(), got, err)
		}
		seen++
	}
	if seen != len(decoders) {
		t.Errorf("%d fixtures, want one per type of %d", seen, len(decoders))
	}

	run := "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01"
	code := 3
	for _, message := range []any{
		NewCommandStarted(run),
		NewCommandVerdict(run, contracts.RunnerCommandVerdictReasonExited, &code, 1500*time.Millisecond),
		NewCommandVerdict(run, contracts.RunnerCommandVerdictReasonTimeout, nil, 30*time.Minute),
		NewCommandKeys(run, "", []contracts.RunnerCommandKeysWrapsElem{{HolderId: strings.Repeat("A", 43), Enc: strings.Repeat("B", 43), WrappedKey: strings.Repeat("C", 64), Tag: strings.Repeat("D", 43)}}),
		NewCommandOutput(run, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6aa1", 2, strings.Repeat("E", 16), strings.Repeat("F", 22)),
	} {
		data, err := json.Marshal(message)
		if err != nil {
			t.Fatal(err)
		}
		typ, _ := typeOf(data)
		if err := decoders[typ](data); err != nil {
			t.Errorf("%s: %v", data, err)
		}
		if strings.Contains(string(data), `"tabId":""`) {
			t.Errorf("%s: an empty tabId", data)
		}
		if verdict, ok := message.(contracts.RunnerCommandVerdict); ok {
			want := `"exitCode":3`
			if verdict.Reason == contracts.RunnerCommandVerdictReasonTimeout {
				want = `"exitCode":null`
			}
			if !strings.Contains(string(data), want) || strings.Contains(string(data), `"passed":true`) {
				t.Errorf("%s: want %s, not passed", data, want)
			}
		}
	}
	zero := 0
	if passed := NewCommandVerdict(run, contracts.RunnerCommandVerdictReasonExited, &zero, 0); !passed.Passed {
		t.Error("an exit code 0 does not pass")
	}
}
