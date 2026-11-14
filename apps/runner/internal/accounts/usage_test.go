package accounts

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/fake"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
)

// sentUsage is a server that stores each usage and acks it.
type sentUsage struct {
	mu       sync.Mutex
	messages []contracts.RunnerUsage
	// ack is what the Runner does with a usage.ack; nil, none is sent (the
	// server's transaction failed).
	ack func(usageID string)
}

func (s *sentUsage) send(_ context.Context, m contracts.RunnerUsage) error {
	s.mu.Lock()
	s.messages = append(s.messages, m)
	ack := s.ack
	s.mu.Unlock()
	if ack != nil {
		ack(m.Id)
	}
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
func usageReporter(t *testing.T, adapter engine.Engine, options ...func(*Reporter)) (*Reporter, *sentUsage) {
	t.Helper()
	var registry engine.Registry
	registry.Register(adapter)
	out := &sentUsage{}
	reporter := &Reporter{Send: (&sent{}).send, SendUsage: out.send}
	for _, option := range options {
		option(reporter)
	}
	out.ack = reporter.UsageAcked
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
	reporter.FlushUsage(context.Background())

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
	// As Claude reports it: the cost of the Session so far, at each turn (06-a-usage-subscription).
	codex.Events = []contracts.EngineEvent{costOf(27_307), costOf(45_438), costOf(45_438)}
	reporter, out := usageReporter(t, codex)

	startAndDrain(t, reporter.Engines, contracts.EngineIdCodex, "gpt-5.5")
	if got := spends(out.await(t, 2)); len(got) != 2 || got[0]+got[1] != 45_438 || (got[0] != 27_307 && got[1] != 27_307) {
		t.Fatalf("spends %v, want 27307 and 18131", got)
	}

	// A new Session (no Session id in common): its cost starts from nothing.
	startAndDrain(t, reporter.Engines, contracts.EngineIdCodex, "gpt-5.5")
	if got := spends(out.await(t, 4)); len(got) != 4 || got[2]+got[3] != 45_438 {
		t.Fatalf("spends %v", got)
	}
}

// recordedResults are the results of a recorded stream of Claude (its
// golden events): what it reports of its cost, turn after turn.
func recordedResults(t *testing.T, name string) []contracts.EngineEvent {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "engine", "claude", "testdata", name+".golden.json"))
	if err != nil {
		t.Fatal(err)
	}
	// Golden events are written without their instant: read only what a result says of its cost.
	var events []struct {
		Kind            string  `json:"kind"`
		CostUsdMicros   *int    `json:"costUsdMicros"`
		EngineSessionId *string `json:"engineSessionId"`
	}
	if err := json.Unmarshal(data, &events); err != nil {
		t.Fatal(err)
	}
	var results []contracts.EngineEvent
	for _, e := range events {
		if e.Kind == "result" {
			results = append(results, contracts.EngineEvent{Result: &contracts.EngineEventResult{Status: contracts.EngineEventResultStatusOk, CostUsdMicros: e.CostUsdMicros, EngineSessionId: e.EngineSessionId}})
		}
	}
	if len(results) == 0 {
		t.Fatalf("no result in %s", name)
	}
	return results
}

// claudeWithKey is Claude with an API key: its spends are kept.
func claudeWithKey(t *testing.T) *fake.Engine {
	t.Helper()
	store := Store{Keyring: memoryKeyring{}, Dir: t.TempDir()}
	if err := store.Set(contracts.EngineIdClaudeCode, "sk-ant-test"); err != nil {
		t.Fatal(err)
	}
	return &fake.Engine{APIKey: store.Provider(contracts.EngineIdClaudeCode)}
}

const recordedSession = "4a000000-0000-4000-8000-000000000014"

func resumeAndDrain(t *testing.T, registry *engine.Registry, engineSessionID string) {
	t.Helper()
	adapter, _ := registry.Get(contracts.EngineIdClaudeCode)
	run, err := adapter.Resume(context.Background(), engine.ResumeOptions{StartOptions: engine.StartOptions{Model: "opus", InitialPrompt: "go on"}, EngineSessionID: engineSessionID})
	if err != nil {
		t.Fatal(err)
	}
	for range run.Events() {
	}
	if err := run.Wait(); err != nil {
		t.Fatal(err)
	}
}

func sum(costs []int) int {
	total := 0
	for _, c := range costs {
		total += c
	}
	return total
}

// Claude keeps the cost of its Session across `--resume` (04-interrupt ends
// at 1 480, 04-resume reports 1 784 for the same Session): the resumed run
// sends only the 304 it adds.
func TestAResumedSessionSendsOnlyWhatItAddsToItsCostSoFar(t *testing.T) {
	claude := claudeWithKey(t)
	claude.Events = recordedResults(t, "04-interrupt")
	reporter, out := usageReporter(t, claude)
	startAndDrain(t, reporter.Engines, contracts.EngineIdClaudeCode, "opus")
	out.await(t, 2)

	claude.Events = recordedResults(t, "04-resume")
	resumeAndDrain(t, reporter.Engines, recordedSession)

	if got := spends(out.await(t, 3)); sum(got) != 1784 || !slices.Contains(got, 304) {
		t.Fatalf("spends %v, want 1 784 in all, 304 for the resumed run", got)
	}
}

// What a Session cost so far outlives the Runner: a resume after a restart
// sends only what it adds.
func TestTheCostOfASessionSoFarOutlivesTheRunner(t *testing.T) {
	path := filepath.Join(t.TempDir(), "spent.json")
	claude := claudeWithKey(t)
	claude.Events = recordedResults(t, "04-interrupt")
	before, out := usageReporter(t, claude, func(r *Reporter) { r.SpentPath = path })
	startAndDrain(t, before.Engines, contracts.EngineIdClaudeCode, "opus")
	out.await(t, 2)

	claude.Events = recordedResults(t, "04-resume")
	after, out := usageReporter(t, claude, func(r *Reporter) { r.SpentPath = path })
	resumeAndDrain(t, after.Engines, recordedSession)

	if got := spends(out.await(t, 1)); len(got) != 1 || got[0] != 304 {
		t.Fatalf("spends %v, want 304", got)
	}
}

// A spend the server could not get outlives the Runner: written with the
// Session's cost before it is sent, it is sent once at the first tick after
// a restart (04-interrupt's 1 183 and 297), beside the resume's 304.
func TestASpendTheServerCouldNotGetOutlivesTheRunner(t *testing.T) {
	path := filepath.Join(t.TempDir(), "spent.json")
	claude := claudeWithKey(t)
	claude.Events = recordedResults(t, "04-interrupt")
	var failed sync.WaitGroup
	failed.Add(2)
	before, _ := usageReporter(t, claude, func(r *Reporter) {
		r.SpentPath = path
		r.SendUsage = func(context.Context, contracts.RunnerUsage) error {
			defer failed.Done()
			return protocol.ErrNotConnected
		}
	})
	startAndDrain(t, before.Engines, contracts.EngineIdClaudeCode, "opus")
	failed.Wait()

	claude.Events = recordedResults(t, "04-resume")
	after, out := usageReporter(t, claude, func(r *Reporter) { r.SpentPath = path })
	resumeAndDrain(t, after.Engines, recordedSession)
	out.await(t, 1)
	after.FlushUsage(context.Background())
	after.FlushUsage(context.Background())

	got := out.all()
	if costs := spends(got); len(costs) != 3 || sum(costs) != 1784 || !slices.Contains(costs, 304) {
		t.Fatalf("spends %v, want 1 183, 297 and 304", costs)
	}
	ids := map[string]bool{}
	for _, u := range got {
		if ids[u.Id] {
			t.Fatalf("usage %s sent twice", u.Id)
		}
		ids[u.Id] = true
	}

	// Sent: a third Runner has nothing left to send.
	again, out := usageReporter(t, claude, func(r *Reporter) { r.SpentPath = path })
	again.FlushUsage(context.Background())
	if got := out.all(); len(got) != 0 {
		t.Fatalf("sent again %+v", got)
	}
}

// settled waits until the server got every spend of `r`, and r wrote so.
func settled(t *testing.T, r *Reporter) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		r.sendMu.Lock()
		r.mu.Lock()
		left := len(r.pending)
		r.mu.Unlock()
		r.sendMu.Unlock()
		if left == 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d spends not sent", left)
		}
		time.Sleep(time.Millisecond)
	}
}

// A line the Runner was writing when it stopped is skipped, and what
// follows is still read after the next restart.
func TestALineCutByACrashLosesNothingAfterIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "spent.json")
	claude := claudeWithKey(t)
	claude.Events = recordedResults(t, "04-interrupt")
	before, out := usageReporter(t, claude, func(r *Reporter) { r.SpentPath = path })
	startAndDrain(t, before.Engines, contracts.EngineIdClaudeCode, "opus")
	out.await(t, 2)
	settled(t, before) // the Runner stops: it writes nothing more
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString(`{"session":"claude-code/4a0`); err != nil {
		t.Fatal(err)
	}
	f.Close()

	claude.Events = []contracts.EngineEvent{resultOf(recordedSession, 1600)}
	after, out := usageReporter(t, claude, func(r *Reporter) { r.SpentPath = path })
	resumeAndDrain(t, after.Engines, recordedSession)
	out.await(t, 1)

	claude.Events = recordedResults(t, "04-resume")
	again, out := usageReporter(t, claude, func(r *Reporter) { r.SpentPath = path })
	resumeAndDrain(t, again.Engines, recordedSession)
	if got := spends(out.await(t, 1)); len(got) != 1 || got[0] != 184 {
		t.Fatalf("spends %v, want 184 (1 784 less the 1 600 read)", got)
	}
}

// A spend written to the socket is forgotten only once the server acks it:
// one its transaction failed to store is sent again, at the reconnection
// or after a restart, with the same id.
func TestASpendTheServerDidNotAckIsSentAgain(t *testing.T) {
	path := filepath.Join(t.TempDir(), "spent.json")
	claude := claudeWithKey(t)
	claude.Events = recordedResults(t, "04-interrupt")
	before, written := usageReporter(t, claude, func(r *Reporter) { r.SpentPath = path })
	written.ack = nil // the frames arrive, their transaction fails
	startAndDrain(t, before.Engines, contracts.EngineIdClaudeCode, "opus")
	first := written.await(t, 2)

	// The reconnection: the server stores and acks now.
	reconnected := &sentUsage{ack: before.UsageAcked}
	before.SendUsage = reconnected.send
	before.FlushUsage(context.Background())
	if got := reconnected.all(); !sameIds(got, first) {
		t.Fatalf("sent again %+v, want the 2 spends of %+v", got, first)
	}
	before.FlushUsage(context.Background())
	if got := reconnected.all(); len(got) != 2 {
		t.Fatalf("sent %d usages, want 2 (acked: nothing more)", len(got))
	}

	// A restart: nothing waits any more.
	after, out := usageReporter(t, claude, func(r *Reporter) { r.SpentPath = path })
	after.FlushUsage(context.Background())
	if got := out.all(); len(got) != 0 {
		t.Fatalf("sent after the restart %+v", got)
	}
}

// One never acked before a restart is sent after it.
func TestASpendNotAckedBeforeARestartIsSentAfterIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "spent.json")
	claude := claudeWithKey(t)
	claude.Events = recordedResults(t, "04-interrupt")
	before, written := usageReporter(t, claude, func(r *Reporter) { r.SpentPath = path })
	written.ack = nil
	startAndDrain(t, before.Engines, contracts.EngineIdClaudeCode, "opus")
	first := written.await(t, 2)

	after, out := usageReporter(t, claude, func(r *Reporter) { r.SpentPath = path })
	after.FlushUsage(context.Background())
	got := out.all()
	if costs := spends(got); len(costs) != 2 || sum(costs) != 1480 || !sameIds(got, first) {
		t.Fatalf("usages %+v, want 1 183 and 297 with their ids of before the restart", got)
	}
}

// sameIds: the same usages, by their ids, whatever their order.
func sameIds(a, b []contracts.RunnerUsage) bool {
	ids := func(usages []contracts.RunnerUsage) []string {
		var out []string
		for _, u := range usages {
			out = append(out, u.Id)
		}
		slices.Sort(out)
		return out
	}
	return slices.Equal(ids(a), ids(b))
}

// resultOf is a result of the Session `engineSessionID` that cost `micros` so far.
func resultOf(engineSessionID string, micros int) contracts.EngineEvent {
	event := costOf(micros)
	event.Result.EngineSessionId = &engineSessionID
	return event
}

// However many Sessions ran since, a Session resumed sends only what it adds.
func TestTheCostOfASessionIsKeptHoweverManySessionsRanSince(t *testing.T) {
	path := filepath.Join(t.TempDir(), "spent.json")
	claude := claudeWithKey(t)
	claude.Events = recordedResults(t, "04-interrupt")
	before, out := usageReporter(t, claude, func(r *Reporter) { r.SpentPath = path })
	startAndDrain(t, before.Engines, contracts.EngineIdClaudeCode, "opus")
	out.await(t, 2)
	for i := range 600 {
		claude.Events = []contracts.EngineEvent{resultOf(fmt.Sprintf("4a000000-0000-4000-8000-%012d", 1000+i), 100)}
		startAndDrain(t, before.Engines, contracts.EngineIdClaudeCode, "opus")
	}
	out.await(t, 602)

	claude.Events = recordedResults(t, "04-resume")
	after, out := usageReporter(t, claude, func(r *Reporter) { r.SpentPath = path })
	resumeAndDrain(t, after.Engines, recordedSession)

	if got := spends(out.await(t, 1)); len(got) != 1 || got[0] != 304 {
		t.Fatalf("spends %v, want 304", got)
	}
}

// A Session not heard from for over a year is forgotten: Claude Code
// deletes its transcript long before (cleanupPeriodDays, 30 days by
// default), it cannot be resumed.
func TestTheCostOfASessionSilentForOverAYearIsForgotten(t *testing.T) {
	path := filepath.Join(t.TempDir(), "spent.json")
	claude := claudeWithKey(t)
	claude.Events = recordedResults(t, "04-interrupt")
	before, out := usageReporter(t, claude, func(r *Reporter) { r.SpentPath = path; r.Now = func() time.Time { return usageAt } })
	startAndDrain(t, before.Engines, contracts.EngineIdClaudeCode, "opus")
	out.await(t, 2)

	claude.Events = []contracts.EngineEvent{resultOf(recordedSession, 1784)}
	after, out := usageReporter(t, claude, func(r *Reporter) {
		r.SpentPath = path
		r.Now = func() time.Time { return usageAt.Add(366 * 24 * time.Hour) }
	})
	resumeAndDrain(t, after.Engines, recordedSession)

	if got := spends(out.await(t, 1)); len(got) != 1 || got[0] != 1784 {
		t.Fatalf("spends %v, want 1 784", got)
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
	reporter.FlushUsage(context.Background())
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
	reporter.FlushUsage(context.Background())

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
	reporter.FlushUsage(context.Background())

	if got := out.all(); len(got) != 1 || got[0].Windows[0].UsedPercent != 100 || !got[0].MeasuredAt.Equal(usageAt) {
		t.Fatalf("usages %+v", got)
	}
}
