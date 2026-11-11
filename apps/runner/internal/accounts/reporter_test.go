package accounts

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/fake"
)

type sent struct {
	mu       sync.Mutex
	messages []contracts.RunnerCapabilities
}

func (s *sent) send(_ context.Context, m contracts.RunnerCapabilities) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.messages = append(s.messages, m)
	return nil
}

func (s *sent) last(t *testing.T) contracts.RunnerCapabilities {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.messages) == 0 {
		t.Fatal("no capabilities sent")
	}
	return s.messages[len(s.messages)-1]
}

func (s *sent) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.messages)
}

func codexWithKey(store Store) *fake.Engine {
	return &fake.Engine{
		EngineID: contracts.EngineIdCodex,
		APIKey:   store.Provider(contracts.EngineIdCodex),
		Models:   []contracts.EngineCapabilitiesModelsElem{{Id: "gpt-5.5", Label: "GPT-5.5"}, {Id: "gpt-5.5-pro", Label: "GPT-5.5 Pro"}},
	}
}

func model(t *testing.T, caps []contracts.EngineCapabilities, engineID contracts.EngineId, id string) contracts.EngineCapabilitiesModelsElem {
	t.Helper()
	for _, c := range caps {
		if c.Engine != engineID {
			continue
		}
		for _, m := range c.Models {
			if m.Id == id {
				return m
			}
		}
	}
	t.Fatalf("no model %s of %s in %+v", id, engineID, caps)
	return contracts.EngineCapabilitiesModelsElem{}
}

func TestReportSendsWhatEachMoteurCanRunInTheOrderOfTheirIds(t *testing.T) {
	var registry engine.Registry
	store := Store{Keyring: memoryKeyring{}, Dir: t.TempDir()}
	registry.Register(codexWithKey(store))
	registry.Register(&fake.Engine{})
	out := &sent{}
	reporter := &Reporter{Engines: &registry, Send: out.send}

	caps, err := reporter.Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	message := out.last(t)
	if message.Type != "capabilities" || len(message.Engines) != 2 || message.Engines[0].Engine != contracts.EngineIdClaudeCode || message.Engines[1].Engine != contracts.EngineIdCodex {
		t.Fatalf("message %+v", message)
	}
	if len(caps) != 2 {
		t.Fatalf("Report gave %+v", caps)
	}
	codex := message.Engines[1]
	if codex.Account.State != contracts.EngineCapabilitiesAccountStateLoginRequired || model(t, caps, contracts.EngineIdCodex, "gpt-5.5").Usable {
		t.Fatalf("codex without a key: %+v", codex)
	}
}

// startAndDrain starts a Session of `engineID` on `model` through the
// registry, as the Sessions do, and reads its events to the end.
func startAndDrain(t *testing.T, registry *engine.Registry, engineID contracts.EngineId, model string) {
	t.Helper()
	adapter, ok := registry.Get(engineID)
	if !ok {
		t.Fatalf("no adapter for %s", engineID)
	}
	run, err := adapter.Start(context.Background(), engine.StartOptions{Model: model, InitialPrompt: "go"})
	if err != nil {
		t.Fatal(err)
	}
	for range run.Events() {
	}
	if err := run.Wait(); err != nil {
		t.Fatal(err)
	}
}

// await waits for the n-th message sent.
func (s *sent) await(t *testing.T, n int) contracts.RunnerCapabilities {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for s.count() < n {
		if time.Now().After(deadline) {
			t.Fatalf("sent %d messages, want %d", s.count(), n)
		}
		time.Sleep(5 * time.Millisecond)
	}
	return s.last(t)
}

func TestALimitASessionMeetsMakesTheModelQuotaReachedUntilItsReset(t *testing.T) {
	store := Store{Keyring: memoryKeyring{}, Dir: t.TempDir()}
	if err := store.Set(contracts.EngineIdCodex, "sk-test"); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 11, 8, 0, 0, 0, time.UTC)
	resets := now.Add(2 * time.Hour)
	codex := codexWithKey(store)
	codex.Events = []contracts.EngineEvent{{LimitReached: &contracts.EngineEventLimitReached{Window: contracts.EngineEventLimitReachedWindow("five-hour"), ResetsAt: &resets}}}
	var registry engine.Registry
	registry.Register(codex)
	out := &sent{}
	reporter := &Reporter{Send: out.send, Now: func() time.Time { return now }}
	reporter.Engines = reporter.Watch(&registry)

	startAndDrain(t, reporter.Engines, contracts.EngineIdCodex, "gpt-5.5-pro")

	caps := out.await(t, 1).Engines
	if got := model(t, caps, contracts.EngineIdCodex, "gpt-5.5-pro"); got.Usable || got.Reason == nil || *got.Reason != contracts.EngineCapabilitiesModelsElemReasonQuotaReached {
		t.Fatalf("after the limit: %+v", got)
	}
	if got := model(t, caps, contracts.EngineIdCodex, "gpt-5.5"); !got.Usable {
		t.Fatalf("another model of the same Moteur: %+v", got)
	}

	now = resets.Add(time.Second)
	caps, _ = reporter.Report(context.Background())
	if got := model(t, caps, contracts.EngineIdCodex, "gpt-5.5-pro"); !got.Usable {
		t.Fatalf("after its reset: %+v", got)
	}
}

func TestAnAuthRequiredASessionMeetsSendsTheCapabilitiesAgain(t *testing.T) {
	claude := &fake.Engine{Events: []contracts.EngineEvent{
		{Message: &contracts.EngineEventMessage{}},
		{AuthRequired: &contracts.EngineEventAuthRequired{Reason: "expired"}},
	}}
	var registry engine.Registry
	registry.Register(claude)
	out := &sent{}
	reporter := &Reporter{Send: out.send}
	reporter.Engines = reporter.Watch(&registry)

	startAndDrain(t, reporter.Engines, contracts.EngineIdClaudeCode, "opus")

	out.await(t, 1)
	time.Sleep(50 * time.Millisecond)
	if out.count() != 1 {
		t.Fatalf("sent %d messages, want 1 (only the auth-required)", out.count())
	}
}

func TestTheWatchedRegistryPassesEveryEventOnInOrder(t *testing.T) {
	claude := &fake.Engine{Events: []contracts.EngineEvent{
		{Message: &contracts.EngineEventMessage{}},
		{LimitReached: &contracts.EngineEventLimitReached{Window: contracts.EngineEventLimitReachedWindow("five-hour")}},
	}}
	var registry engine.Registry
	registry.Register(claude)
	reporter := &Reporter{Send: (&sent{}).send}
	reporter.Engines = reporter.Watch(&registry)
	adapter, _ := reporter.Engines.Get(contracts.EngineIdClaudeCode)
	run, err := adapter.Start(context.Background(), engine.StartOptions{Model: "opus", InitialPrompt: "go"})
	if err != nil {
		t.Fatal(err)
	}
	var got []contracts.EngineEvent
	for event := range run.Events() {
		got = append(got, event)
	}
	if len(got) < 2 || got[0].Message == nil || got[1].LimitReached == nil {
		t.Fatalf("events %+v", got)
	}
}

func TestEverySendsTheCapabilitiesOnEachTick(t *testing.T) {
	var registry engine.Registry
	registry.Register(&fake.Engine{})
	out := &sent{}
	reporter := &Reporter{Engines: &registry, Send: out.send}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { reporter.Every(ctx, 5*time.Millisecond); close(done) }()

	deadline := time.Now().Add(2 * time.Second)
	for out.count() < 2 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	cancel()
	<-done
	if out.count() < 2 {
		t.Fatalf("sent %d messages in 2 s", out.count())
	}
}
