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
		TypeHello:         decodeInto[contracts.RunnerHello],
		TypeHelloAccepted: decodeInto[contracts.RunnerHelloAccepted],
		TypeHelloRejected: decodeInto[contracts.RunnerHelloRejected],
		TypeHeartbeat:     decodeInto[contracts.RunnerHeartbeat],
		TypeHeartbeatAck:  decodeInto[contracts.RunnerHeartbeatAck],
		TypeError:         decodeInto[contracts.RunnerError],
		TypeStepVerdict:   decodeInto[contracts.RunnerStepVerdict],
		TypeCapabilities:  decodeInto[contracts.RunnerCapabilities],
		TypeUsage:         decodeInto[contracts.RunnerUsage],
		TypeUsageAck:      decodeInto[contracts.RunnerUsageAck],
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
	hello := NewHello(Machine{RunnerVersion: "0.1.0", Machine: "atelier", OS: contracts.RunnerHelloOsLinux, Arch: contracts.RunnerHelloArchAmd64})
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

func TestTheUsageMatchesItsSchema(t *testing.T) {
	measured := now().Add(-time.Minute)
	usage := NewUsage(contracts.RunnerUsageEngineCodex, contracts.RunnerUsageAccountKindApiKey, nil, &contracts.RunnerUsageSpend{CostUsdMicros: 1_250_000}, measured)
	data, err := json.Marshal(usage)
	if err != nil {
		t.Fatal(err)
	}
	var back contracts.RunnerUsage
	if err := json.Unmarshal(data, &back); err != nil {
		t.Fatalf("decode the usage: %v", err)
	}
	if back.Type != TypeUsage || !uuidV7.MatchString(back.Id) || back.Windows == nil || back.Spend.CostUsdMicros != 1_250_000 || !back.MeasuredAt.Equal(measured) {
		t.Fatalf("usage %+v", back)
	}
}
