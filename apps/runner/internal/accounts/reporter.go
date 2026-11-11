package accounts

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
)

// QuotaFallback is how long a model stays `quota-reached` after a
// `limit-reached` that gives no `resetsAt`: until the next periodic report.
const QuotaFallback = time.Duration(contracts.CapabilitiesEverySeconds) * time.Second

// Reporter tells the server what each Moteur can run (US-38): it asks every
// adapter its capabilities, marks `quota-reached` the models a
// `limit-reached` stopped until their reset, and sends the `capabilities`
// message. Its zero value is not usable: Engines and Send are required.
type Reporter struct {
	Engines *engine.Registry
	// Send sends the message to the server.
	Send func(context.Context, contracts.RunnerCapabilities) error
	// Now gives the instant; nil, time.Now.
	Now func() time.Time
	// Logger logs an adapter that failed to answer; nil, slog's default.
	Logger *slog.Logger

	mu    sync.Mutex
	quota map[contracts.EngineId]map[string]time.Time // the model ("" for every one) to the end of its limit
}

func (r *Reporter) now() time.Time {
	if r.Now == nil {
		return time.Now()
	}
	return r.Now()
}

func (r *Reporter) logger() *slog.Logger {
	if r.Logger == nil {
		return slog.Default()
	}
	return r.Logger
}

// Capabilities asks every adapter, in the order of their ids. An adapter in
// error still gives what it found (not installed, login required): it is
// logged, never fatal.
func (r *Reporter) Capabilities(ctx context.Context) []contracts.EngineCapabilities {
	caps := []contracts.EngineCapabilities{}
	for _, e := range r.Engines.All() {
		c, err := e.Capabilities(ctx)
		if err != nil {
			r.logger().Warn("capabilities", "engine", e.ID(), "error", err)
		}
		c.Engine = e.ID()
		if c.Models == nil {
			c.Models = []contracts.EngineCapabilitiesModelsElem{}
		}
		caps = append(caps, r.overlay(c))
	}
	return caps
}

// overlay marks `quota-reached` the usable models still under a limit.
func (r *Reporter) overlay(c contracts.EngineCapabilities) contracts.EngineCapabilities {
	r.mu.Lock()
	defer r.mu.Unlock()
	limits := r.quota[c.Engine]
	now := r.now()
	for model, until := range limits {
		if !now.Before(until) {
			delete(limits, model)
		}
	}
	models := make([]contracts.EngineCapabilitiesModelsElem, len(c.Models))
	for i, m := range c.Models {
		_, one := limits[m.Id]
		_, all := limits[""]
		if m.Usable && (one || all) {
			reason := contracts.EngineCapabilitiesModelsElemReasonQuotaReached
			m.Usable, m.Reason = false, &reason
		}
		models[i] = m
	}
	c.Models = models
	return c
}

// Report computes the capabilities and sends them.
func (r *Reporter) Report(ctx context.Context) ([]contracts.EngineCapabilities, error) {
	caps := r.Capabilities(ctx)
	return caps, r.Send(ctx, protocol.NewCapabilities(caps))
}

// record takes an event a Session of `engineID` on `model` emitted (Watch)
// and says whether the capabilities must be sent again: a `limit-reached`
// makes the model `quota-reached` until its `resetsAt` (every model of the
// Moteur when `model` is ""), the later end kept when a limit is already
// running; an `auth-required` changes the Compte IA. Other events, false.
func (r *Reporter) record(engineID contracts.EngineId, model string, event contracts.EngineEvent) bool {
	switch {
	case event.LimitReached != nil:
		until := r.now().Add(QuotaFallback)
		if event.LimitReached.ResetsAt != nil {
			until = *event.LimitReached.ResetsAt
		}
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.quota == nil {
			r.quota = map[contracts.EngineId]map[string]time.Time{}
		}
		if r.quota[engineID] == nil {
			r.quota[engineID] = map[string]time.Time{}
		}
		if running, ok := r.quota[engineID][model]; !ok || until.After(running) || !r.now().Before(running) {
			r.quota[engineID][model] = until
		}
		return true
	case event.AuthRequired != nil:
		return true
	default:
		return false
	}
}

// report sends the capabilities, logging a failure.
func (r *Reporter) report(ctx context.Context) {
	if _, err := r.Report(ctx); err != nil {
		r.logger().Warn("capabilities", "error", err)
	}
}

// Every sends the capabilities every `period` until ctx ends.
func (r *Reporter) Every(ctx context.Context, period time.Duration) {
	ticker := time.NewTicker(period)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := r.Report(ctx); err != nil && ctx.Err() == nil {
				r.logger().Warn("capabilities", "error", err)
			}
		}
	}
}
