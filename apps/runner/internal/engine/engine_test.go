package engine_test

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
)

type stubEngine struct{ id contracts.EngineId }

func (s stubEngine) ID() contracts.EngineId { return s.id }
func (s stubEngine) Capabilities(context.Context) (contracts.EngineCapabilities, error) {
	return contracts.EngineCapabilities{Engine: s.id}, nil
}
func (stubEngine) Start(context.Context, engine.StartOptions) (engine.Run, error)   { return nil, nil }
func (stubEngine) Resume(context.Context, engine.ResumeOptions) (engine.Run, error) { return nil, nil }

func TestTheRegistryGivesEachMoteurByItsIdAndAllInTheOrderOfTheirIds(t *testing.T) {
	var registry engine.Registry
	codex, claude := stubEngine{contracts.EngineIdCodex}, stubEngine{contracts.EngineIdClaudeCode}
	registry.Register(codex)
	registry.Register(claude)

	if got, ok := registry.Get(contracts.EngineIdCodex); !ok || got != codex {
		t.Fatalf("Get(codex) = %v, %v", got, ok)
	}
	if _, ok := (&engine.Registry{}).Get(contracts.EngineIdCodex); ok {
		t.Fatal("an empty registry has codex")
	}
	if all := registry.All(); !reflect.DeepEqual(all, []engine.Engine{claude, codex}) {
		t.Fatalf("All() = %v", all)
	}
}

func TestTheRegistryRefusesTheSameMoteurTwice(t *testing.T) {
	var registry engine.Registry
	registry.Register(stubEngine{contracts.EngineIdCodex})
	defer func() {
		if recover() == nil {
			t.Fatal("registered codex twice")
		}
	}()
	registry.Register(stubEngine{contracts.EngineIdCodex})
}

func TestStampSetsTheSeqAndTheInstantOfAnEventOfAnyKindWithoutTouchingTheOriginal(t *testing.T) {
	at := time.Date(2026, 11, 11, 9, 0, 0, 0, time.UTC)
	message := &contracts.EngineEventMessage{Text: "Bonjour", Final: true}
	stamped := engine.Stamp(contracts.EngineEvent{Message: message}, 4, at)
	if stamped.Message == message || stamped.Message.Seq != 4 || !stamped.Message.At.Equal(at) || stamped.Message.Text != "Bonjour" {
		t.Fatalf("stamped %+v", stamped.Message)
	}
	if message.Seq != 0 {
		t.Fatalf("the original was changed: %+v", message)
	}
	result := engine.Stamp(contracts.EngineEvent{Result: &contracts.EngineEventResult{Status: contracts.EngineEventResultStatusOk}}, 9, at)
	if result.Result.Seq != 9 || result.Kind() != contracts.EngineEventKindResult {
		t.Fatalf("stamped %+v", result.Result)
	}
	if empty := engine.Stamp(contracts.EngineEvent{}, 1, at); empty.Value() != nil {
		t.Fatalf("stamped an empty event into %+v", empty)
	}
}
