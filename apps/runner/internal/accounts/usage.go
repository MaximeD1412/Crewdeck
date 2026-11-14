package accounts

import (
	"context"
	"slices"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
)

// usageRetries is how many windows that could not be sent wait for the
// next tick, the oldest dropped beyond. A spend waits until it is sent,
// a restart included (spent.go).
const usageRetries = 100

// usageWindowOrder is the order of the windows in a usage message.
var usageWindowOrder = []contracts.RunnerUsageWindowsElemId{contracts.RunnerUsageWindowsElemIdFiveHour, contracts.RunnerUsageWindowsElemIdWeek}

// usageOf is what a Moteur's Sessions last reported of its Compte IA.
type usageOf struct {
	windows    map[contracts.RunnerUsageWindowsElemId]contracts.RunnerUsageWindowsElem
	measuredAt time.Time
	// changed: measured since the last usage sent.
	changed bool
}

// observeUsage takes an event a run of `engineID` emitted (Watch) and gives
// the usage to send at once, nil when none: a `usage` with windows updates
// them; a `limit-reached` fills its window; a `result` with a cost sends, on
// its own and at its result's instant, what it adds to the cost counted so
// far. A Moteur reports the cost of its Session up to that turn, its runs
// before a `--resume` included (Claude's `total_cost_usd`): what is counted
// is the Session's (spent.go), else `spent`, the run's. Nothing for a Moteur
// without a Compte IA or before the first capabilities told which: its
// windows wait for the next tick.
func (r *Reporter) observeUsage(engineID contracts.EngineId, event contracts.EngineEvent, spent *int) *contracts.RunnerUsage {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.usage == nil {
		r.usage = map[contracts.EngineId]*usageOf{}
	}
	u := r.usage[engineID]
	if u == nil {
		u = &usageOf{windows: map[contracts.RunnerUsageWindowsElemId]contracts.RunnerUsageWindowsElem{}}
		r.usage[engineID] = u
	}
	switch {
	case event.Usage != nil && len(event.Usage.Windows) > 0:
		for _, w := range event.Usage.Windows {
			id := contracts.RunnerUsageWindowsElemId(w.Id)
			u.windows[id] = contracts.RunnerUsageWindowsElem{Id: id, UsedPercent: w.UsedPercent, ResetsAt: w.ResetsAt}
		}
		u.measuredAt, u.changed = r.instant(event.Usage.At), true
		return r.usageMessage(engineID, u, nil)
	case event.LimitReached != nil:
		id := contracts.RunnerUsageWindowsElemId(event.LimitReached.Window)
		known, ok := u.windows[id]
		switch {
		case event.LimitReached.ResetsAt != nil:
			known.ResetsAt = *event.LimitReached.ResetsAt
		case !ok:
			return nil // no reset to say: the capabilities carry the limit
		}
		u.windows[id] = contracts.RunnerUsageWindowsElem{Id: id, UsedPercent: 100, ResetsAt: known.ResetsAt}
		u.measuredAt = r.instant(event.LimitReached.At)
		return r.usageMessage(engineID, u, nil)
	case event.Result != nil && event.Result.CostUsdMicros != nil:
		cost := *event.Result.CostUsdMicros
		counted, key := *spent, ""
		if id := event.Result.EngineSessionId; id != nil && *id != "" {
			key = sessionKey(engineID, *id)
			if known, ok := r.sessionSpent(key); ok {
				counted = known
			}
		}
		added := cost - counted
		if added < 0 { // the Moteur started its count over: all of it is new
			added = cost
		}
		*spent = cost
		var message *contracts.RunnerUsage
		if added != 0 {
			message = r.spendMessage(engineID, added, r.instant(event.Result.At))
		}
		r.keepSpent(key, cost, message)
		return message
	default:
		return nil
	}
}

// usageMessage is the usage of `u`, nil when the Compte IA has none; it is
// then sent, `changed` cleared. Under r.mu.
func (r *Reporter) usageMessage(engineID contracts.EngineId, u *usageOf, spend *contracts.RunnerUsageSpend) *contracts.RunnerUsage {
	kind, ok := usageKind(r.kinds[engineID])
	if !ok {
		return nil
	}
	windows := []contracts.RunnerUsageWindowsElem{}
	for _, id := range usageWindowOrder {
		if w, ok := u.windows[id]; ok {
			windows = append(windows, w)
		}
	}
	measuredAt := u.measuredAt
	if measuredAt.IsZero() {
		measuredAt = r.now()
	}
	u.changed = false
	message := protocol.NewUsage(contracts.RunnerUsageEngine(engineID), kind, windows, spend, measuredAt)
	return &message
}

// spendMessage is the spend of `engineID`, without its windows: they keep
// the instant they were measured at. Nil when its Compte IA has no usage.
// Under r.mu.
func (r *Reporter) spendMessage(engineID contracts.EngineId, costUsdMicros int, at time.Time) *contracts.RunnerUsage {
	kind, ok := usageKind(r.kinds[engineID])
	if !ok {
		return nil
	}
	message := protocol.NewUsage(contracts.RunnerUsageEngine(engineID), kind, nil, &contracts.RunnerUsageSpend{CostUsdMicros: costUsdMicros}, at)
	return &message
}

// usageKind is the kind of a Compte IA in a usage, false for none.
func usageKind(kind contracts.EngineCapabilitiesAccountKind) (contracts.RunnerUsageAccountKind, bool) {
	switch kind {
	case contracts.EngineCapabilitiesAccountKindSubscription:
		return contracts.RunnerUsageAccountKindSubscription, true
	case contracts.EngineCapabilitiesAccountKindApiKey:
		return contracts.RunnerUsageAccountKindApiKey, true
	}
	return "", false
}

func (r *Reporter) instant(at time.Time) time.Time {
	if at.IsZero() {
		return r.now()
	}
	return at
}

// sendUsage sends `messages` in order, one sending at a time; one the
// server could not get waits for the next tick, as do the ones after it. A
// spend waits in the record of the spends (spent.go) until the server acks
// it (UsageAcked), sent again at each tick and each connection until then,
// never once acked.
func (r *Reporter) sendUsage(ctx context.Context, messages []contracts.RunnerUsage) {
	if r.SendUsage == nil {
		return
	}
	r.sendMu.Lock()
	defer r.sendMu.Unlock()
	for i, m := range messages {
		if m.Spend != nil {
			r.mu.Lock()
			pending := r.isPending(m.Id)
			r.mu.Unlock()
			if !pending {
				continue // acked already
			}
		}
		if err := r.SendUsage(ctx, m); err != nil {
			r.logger().Debug("usage", "engine", m.Engine, "error", err)
			r.mu.Lock()
			for _, rest := range messages[i:] {
				if rest.Spend == nil {
					r.usageRetry = append(r.usageRetry, rest)
				}
			}
			if extra := len(r.usageRetry) - usageRetries; extra > 0 {
				r.usageRetry = r.usageRetry[extra:]
			}
			r.mu.Unlock()
			return
		}
	}
}

// UsageAcked takes the server's `usage.ack` of the usage `usageID`: stored,
// its transaction committed. A spend is forgotten then only: a frame
// written to the socket may still fail to be stored, and is sent again.
func (r *Reporter) UsageAcked(usageID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.loadSpent()
	if r.isPending(usageID) {
		r.spendAcked(usageID)
	}
}

// FlushUsage sends what waits: the spends the server has not acked, those
// of before a restart included, the windows it could not get, then the
// windows measured since the last usage of each Moteur. At each tick and
// each accepted connection.
func (r *Reporter) FlushUsage(ctx context.Context) {
	r.mu.Lock()
	r.loadSpent()
	messages := append(slices.Clone(r.pending), r.usageRetry...)
	r.usageRetry = nil
	for _, e := range r.Engines.All() {
		if u := r.usage[e.ID()]; u != nil && u.changed {
			engineID := e.ID()
			if m := r.usageMessage(engineID, u, nil); m != nil {
				messages = append(messages, *m)
			}
		}
	}
	r.mu.Unlock()
	r.sendUsage(ctx, messages)
}

// UsageEvery sends, every `period` until ctx ends, the usage the Sessions
// reported since the last tick (contracts.UsageEverySeconds): a Moteur
// reports its windows at each turn, the server needs them only so often.
func (r *Reporter) UsageEvery(ctx context.Context, period time.Duration) {
	ticker := time.NewTicker(period)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.FlushUsage(ctx)
		}
	}
}
