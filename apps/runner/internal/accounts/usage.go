package accounts

import (
	"context"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
)

// usageRetries is how many usages that could not be sent wait for the next
// tick, the oldest dropped beyond.
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

// observeUsage takes an event a Session of `engineID` emitted (Watch) and
// gives the usage to send at once, nil when none: a `usage` updates the
// windows, sent at the next tick (UsageEvery); a `limit-reached` fills its
// window, sent at once; a `result` with a cost sends that spend, with the
// windows. Nothing for a Moteur without a Compte IA or before the first
// capabilities told which.
func (r *Reporter) observeUsage(engineID contracts.EngineId, event contracts.EngineEvent) *contracts.RunnerUsage {
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
		return nil
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
	case event.Result != nil && event.Result.CostUsdMicros != nil && *event.Result.CostUsdMicros > 0:
		if len(u.windows) == 0 {
			u.measuredAt = r.instant(event.Result.At)
		}
		return r.usageMessage(engineID, u, &contracts.RunnerUsageSpend{CostUsdMicros: *event.Result.CostUsdMicros})
	default:
		return nil
	}
}

// usageMessage is the usage of `u`, nil when the Compte IA has none; it is
// then sent, `changed` cleared. Under r.mu.
func (r *Reporter) usageMessage(engineID contracts.EngineId, u *usageOf, spend *contracts.RunnerUsageSpend) *contracts.RunnerUsage {
	var kind contracts.RunnerUsageAccountKind
	switch r.kinds[engineID] {
	case contracts.EngineCapabilitiesAccountKindSubscription:
		kind = contracts.RunnerUsageAccountKindSubscription
	case contracts.EngineCapabilitiesAccountKindApiKey:
		kind = contracts.RunnerUsageAccountKindApiKey
	default:
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

func (r *Reporter) instant(at time.Time) time.Time {
	if at.IsZero() {
		return r.now()
	}
	return at
}

// sendUsage sends `messages` in order; one the server could not get waits
// for the next tick, as do the ones after it.
func (r *Reporter) sendUsage(ctx context.Context, messages []contracts.RunnerUsage) {
	if r.SendUsage == nil {
		return
	}
	for i, m := range messages {
		if err := r.SendUsage(ctx, m); err != nil {
			r.logger().Debug("usage", "engine", m.Engine, "error", err)
			r.mu.Lock()
			r.usageRetry = append(r.usageRetry, messages[i:]...)
			if extra := len(r.usageRetry) - usageRetries; extra > 0 {
				r.usageRetry = r.usageRetry[extra:]
			}
			r.mu.Unlock()
			return
		}
	}
}

// flushUsage sends what waits: the usages not sent yet, then the windows
// measured since the last usage of each Moteur.
func (r *Reporter) flushUsage(ctx context.Context) {
	r.mu.Lock()
	messages := r.usageRetry
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
			r.flushUsage(ctx)
		}
	}
}
