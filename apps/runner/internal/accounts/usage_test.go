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

func TestTheWindowsASessionReportsAreSentAtOnceWithTheirInstant(t *testing.T) {
	claude := &fake.Engine{Now: func() time.Time { return usageAt }, Events: []contracts.EngineEvent{{Message: &contracts.EngineEventMessage{}}, claudeUsage(40, 58)}}
	reporter, out := usageReporter(t, claude)

	startAndDrain(t, reporter.Engines, contracts.EngineIdClaudeCode, "opus")
	out.await(t, 1)
	reporter.flushUsage(context.Background())

	got := out.all()
	if len(got) != 1 {
		t.Fatalf("sent %d usages, want 1 (nothing new at the tick)", len(got))
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

// at gives the instants in turn, the last one again beyond.
func at(instants ...time.Time) func() time.Time {
	var mu sync.Mutex
	return func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		next := instants[0]
		if len(instants) > 1 {
			instants = instants[1:]
		}
		return next
	}
}

func costOf(micros int) contracts.EngineEvent {
	return contracts.EngineEvent{Result: &contracts.EngineEventResult{Status: contracts.EngineEventResultStatusOk, CostUsdMicros: &micros}}
}

func spends(usages []contracts.RunnerUsage) []int {
	var costs []int
	for _, u := range usages {
		if u.Spend != nil {
			costs = append(costs, u.Spend.CostUsdMicros)
		}
	}
	return costs
}

func TestEachResultSendsWhatItAddsToTheCostOfItsRunSoFar(t *testing.T) {
	store := Store{Keyring: memoryKeyring{}, Dir: t.TempDir()}
	if err := store.Set(contracts.EngineIdCodex, "sk-test"); err != nil {
		t.Fatal(err)
	}
	codex := codexWithKey(store)
	// As Claude reports it: the cost of the process so far, at each turn (06-a-usage-subscription).
	codex.Events = []contracts.EngineEvent{costOf(27_307), costOf(45_438), costOf(45_438)}
	reporter, out := usageReporter(t, codex)

	startAndDrain(t, reporter.Engines, contracts.EngineIdCodex, "gpt-5.5")
	if got := spends(out.await(t, 2)); len(got) != 2 || got[0]+got[1] != 45_438 || (got[0] != 27_307 && got[1] != 27_307) {
		t.Fatalf("spends %v, want 27307 and 18131", got)
	}

	// A resumed Session is a new process: its cost starts over.
	startAndDrain(t, reporter.Engines, contracts.EngineIdCodex, "gpt-5.5")
	if got := spends(out.await(t, 4)); len(got) != 4 || got[2]+got[3] != 45_438 {
		t.Fatalf("spends %v", got)
	}
}

func TestTheCostsOfConcurrentRunsAreNotMixed(t *testing.T) {
	store := Store{Keyring: memoryKeyring{}, Dir: t.TempDir()}
	if err := store.Set(contracts.EngineIdCodex, "sk-test"); err != nil {
		t.Fatal(err)
	}
	codex := codexWithKey(store)
	codex.Events = []contracts.EngineEvent{costOf(10_000), costOf(30_000)}
	reporter, out := usageReporter(t, codex)

	var both sync.WaitGroup
	for range 2 {
		both.Add(1)
		go func() { defer both.Done(); startAndDrain(t, reporter.Engines, contracts.EngineIdCodex, "gpt-5.5") }()
	}
	both.Wait()

	total := 0
	for _, cost := range spends(out.await(t, 4)) {
		total += cost
	}
	if total != 60_000 {
		t.Fatalf("spent %d, want 60000 (30000 a run)", total)
	}
}

func TestASpendIsDatedAtItsResultApartFromOlderWindows(t *testing.T) {
	store := Store{Keyring: memoryKeyring{}, Dir: t.TempDir()}
	if err := store.Set(contracts.EngineIdCodex, "sk-test"); err != nil {
		t.Fatal(err)
	}
	measured := time.Date(2026, 11, 30, 22, 50, 0, 0, time.UTC) // 23:50 in Paris, 30 November
	result := time.Date(2026, 11, 30, 23, 30, 0, 0, time.UTC)   // 00:30 in Paris, 1 December
	codex := codexWithKey(store)
	codex.Now = at(measured, result)
	codex.Events = []contracts.EngineEvent{claudeUsage(10, 10), costOf(5_000)}
	reporter, out := usageReporter(t, codex)

	startAndDrain(t, reporter.Engines, contracts.EngineIdCodex, "gpt-5.5")

	for _, u := range out.await(t, 2) {
		switch {
		case u.Spend != nil && (len(u.Windows) != 0 || !u.MeasuredAt.Equal(result)):
			t.Fatalf("spend %+v, want alone at %s", u, result)
		case u.Spend == nil && !u.MeasuredAt.Equal(measured):
			t.Fatalf("windows %+v, want at %s", u, measured)
		}
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

	full := false // the usage, then the limit, each sent at once
	for _, u := range out.await(t, 2) {
		w := u.Windows
		full = full || len(w) == 2 && w[0].UsedPercent == 100 && w[0].ResetsAt.Equal(resets) && w[1].UsedPercent == 60
	}
	if !full {
		t.Fatalf("usages %+v, want the five hours full", out.all())
	}
	reporter.flushUsage(context.Background())
	if len(out.all()) != 2 {
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
