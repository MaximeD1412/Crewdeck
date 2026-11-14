package accounts

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/fake"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
)

type sentUsage struct {
	mu       sync.Mutex
	messages []contracts.RunnerUsage
}

func (s *sentUsage) send(_ context.Context, m contracts.RunnerUsage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.messages = append(s.messages, m)
	return nil
}

func (s *sentUsage) all() []contracts.RunnerUsage {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]contracts.RunnerUsage(nil), s.messages...)
}

// await waits for n usages sent, then gives them all.
func (s *sentUsage) await(t *testing.T, n int) []contracts.RunnerUsage {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for len(s.all()) < n {
		if time.Now().After(deadline) {
			t.Fatalf("sent %d usages, want %d", len(s.all()), n)
		}
		time.Sleep(time.Millisecond)
	}
	return s.all()
}

var (
	usageAt    = time.Date(2026, 11, 11, 13, 0, 0, 0, time.UTC)
	fiveResets = usageAt.Add(100 * time.Minute)
	weekResets = usageAt.Add(4 * 24 * time.Hour)
)

func claudeUsage(fiveHour, week float64) contracts.EngineEvent {
	return contracts.EngineEvent{Usage: &contracts.EngineEventUsage{Windows: []contracts.EngineEventUsageWindowsElem{
		{Id: contracts.EngineEventUsageWindowsElemIdFiveHour, UsedPercent: fiveHour, ResetsAt: fiveResets},
		{Id: contracts.EngineEventUsageWindowsElemIdWeek, UsedPercent: week, ResetsAt: weekResets},
	}}}
}

// usageReporter watches `adapter`, its Compte IA known from a first report.
func usageReporter(t *testing.T, adapter engine.Engine) (*Reporter, *sentUsage) {
	t.Helper()
	var registry engine.Registry
	registry.Register(adapter)
	out := &sentUsage{}
	reporter := &Reporter{Send: (&sent{}).send, SendUsage: out.send}
	reporter.Engines = reporter.Watch(&registry)
	if _, err := reporter.Report(context.Background()); err != nil {
		t.Fatal(err)
	}
	return reporter, out
}

func TestTheWindowsASessionReportsAreSentAtTheNextTickOnceWithTheirInstant(t *testing.T) {
	claude := &fake.Engine{Now: func() time.Time { return usageAt }, Events: []contracts.EngineEvent{{Message: &contracts.EngineEventMessage{}}, claudeUsage(40, 58)}}
	reporter, out := usageReporter(t, claude)

	startAndDrain(t, reporter.Engines, contracts.EngineIdClaudeCode, "opus")
	if got := out.all(); len(got) != 0 {
		t.Fatalf("sent before the tick: %+v", got)
	}
	reporter.flushUsage(context.Background())
	reporter.flushUsage(context.Background())

	got := out.all()
	if len(got) != 1 {
		t.Fatalf("sent %d usages, want 1 (nothing new at the second tick)", len(got))
	}
	usage := got[0]
	if usage.Type != "usage" || usage.Engine != contracts.RunnerUsageEngineClaudeCode || usage.AccountKind != contracts.RunnerUsageAccountKindSubscription || usage.Spend != nil || !usage.MeasuredAt.Equal(usageAt) {
		t.Fatalf("usage %+v", usage)
	}
	want := []contracts.RunnerUsageWindowsElem{
		{Id: contracts.RunnerUsageWindowsElemIdFiveHour, UsedPercent: 40, ResetsAt: fiveResets},
		{Id: contracts.RunnerUsageWindowsElemIdWeek, UsedPercent: 58, ResetsAt: weekResets},
	}
	if len(usage.Windows) != 2 || usage.Windows[0] != want[0] || usage.Windows[1] != want[1] {
		t.Fatalf("windows %+v, want %+v", usage.Windows, want)
	}
}

func TestALimitReachedSendsTheUsageAtOnceItsWindowFull(t *testing.T) {
	resets := usageAt.Add(30 * time.Minute)
	claude := &fake.Engine{Now: func() time.Time { return usageAt }, Events: []contracts.EngineEvent{
		claudeUsage(97, 60),
		{LimitReached: &contracts.EngineEventLimitReached{Window: contracts.EngineEventLimitReachedWindowFiveHour, ResetsAt: &resets}},
	}}
	reporter, out := usageReporter(t, claude)

	startAndDrain(t, reporter.Engines, contracts.EngineIdClaudeCode, "opus")

	got := out.await(t, 1)
	if w := got[0].Windows; len(w) != 2 || w[0].UsedPercent != 100 || !w[0].ResetsAt.Equal(resets) || w[1].UsedPercent != 60 {
		t.Fatalf("windows %+v", w)
	}
	reporter.flushUsage(context.Background())
	if len(out.all()) != 1 {
		t.Fatal("the tick sent again what the limit sent")
	}
}

func TestAResultSendsTheCostOfTheSessionOfAnAPIKey(t *testing.T) {
	store := Store{Keyring: memoryKeyring{}, Dir: t.TempDir()}
	if err := store.Set(contracts.EngineIdCodex, "sk-test"); err != nil {
		t.Fatal(err)
	}
	cost := 1_250_000
	codex := codexWithKey(store)
	codex.Now = func() time.Time { return usageAt }
	codex.Events = []contracts.EngineEvent{{Result: &contracts.EngineEventResult{Status: contracts.EngineEventResultStatusOk, CostUsdMicros: &cost}}}
	reporter, out := usageReporter(t, codex)

	startAndDrain(t, reporter.Engines, contracts.EngineIdCodex, "gpt-5.5")

	got := out.await(t, 1)
	if len(got) != 1 || got[0].AccountKind != contracts.RunnerUsageAccountKindApiKey || got[0].Spend == nil || got[0].Spend.CostUsdMicros != cost || len(got[0].Windows) != 0 || !got[0].MeasuredAt.Equal(usageAt) {
		t.Fatalf("usages %+v", got)
	}
}

func TestAMoteurWithoutACompteIASendsNoUsage(t *testing.T) {
	store := Store{Keyring: memoryKeyring{}, Dir: t.TempDir()}
	cost := 1_000
	codex := codexWithKey(store) // no key: `none`
	codex.Events = []contracts.EngineEvent{claudeUsage(10, 10), {Result: &contracts.EngineEventResult{Status: contracts.EngineEventResultStatusOk, CostUsdMicros: &cost}}}
	reporter, out := usageReporter(t, codex)

	startAndDrain(t, reporter.Engines, contracts.EngineIdCodex, "gpt-5.5")
	reporter.flushUsage(context.Background())

	if got := out.all(); len(got) != 0 {
		t.Fatalf("usages %+v", got)
	}
}

func TestUsageEveryFlushesOnEachTick(t *testing.T) {
	claude := &fake.Engine{Events: []contracts.EngineEvent{claudeUsage(5, 5)}}
	reporter, out := usageReporter(t, claude)
	startAndDrain(t, reporter.Engines, contracts.EngineIdClaudeCode, "opus")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { reporter.UsageEvery(ctx, 5*time.Millisecond); close(done) }()

	out.await(t, 1)
	cancel()
	<-done
	if len(out.all()) != 1 {
		t.Fatalf("sent %d usages, want 1", len(out.all()))
	}
}

func TestAUsageTheServerCouldNotGetIsSentAtTheNextTick(t *testing.T) {
	resets := usageAt.Add(30 * time.Minute)
	claude := &fake.Engine{Now: func() time.Time { return usageAt }, Events: []contracts.EngineEvent{
		{LimitReached: &contracts.EngineEventLimitReached{Window: contracts.EngineEventLimitReachedWindowFiveHour, ResetsAt: &resets}},
	}}
	reporter, out := usageReporter(t, claude)
	var failed sync.WaitGroup
	failed.Add(1)
	reporter.SendUsage = func(context.Context, contracts.RunnerUsage) error {
		defer failed.Done()
		return protocol.ErrNotConnected
	}

	startAndDrain(t, reporter.Engines, contracts.EngineIdClaudeCode, "opus")
	failed.Wait()
	reporter.SendUsage = out.send
	reporter.flushUsage(context.Background())

	if got := out.all(); len(got) != 1 || got[0].Windows[0].UsedPercent != 100 || !got[0].MeasuredAt.Equal(usageAt) {
		t.Fatalf("usages %+v", got)
	}
}
