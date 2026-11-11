package accounts

import (
	"context"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
)

// Watch gives the adapters of `registry` with every Run they start watched
// by the Reporter: a `limit-reached` or an `auth-required` of a Session
// is recorded, and reaches the next capabilities. The Runner drives its
// Sessions through this registry (run.go), and the Reporter asks it too.
func (r *Reporter) Watch(registry *engine.Registry) *engine.Registry {
	var watched engine.Registry
	for _, e := range registry.All() {
		watched.Register(watchedEngine{Engine: e, reporter: r})
	}
	return &watched
}

type watchedEngine struct {
	engine.Engine
	reporter *Reporter
}

func (w watchedEngine) Start(ctx context.Context, opts engine.StartOptions) (engine.Run, error) {
	run, err := w.Engine.Start(ctx, opts)
	if err != nil {
		return nil, err
	}
	return w.watch(ctx, run, opts.Model), nil
}

func (w watchedEngine) Resume(ctx context.Context, opts engine.ResumeOptions) (engine.Run, error) {
	run, err := w.Engine.Resume(ctx, opts)
	if err != nil {
		return nil, err
	}
	return w.watch(ctx, run, opts.Model), nil
}

// watch passes the run's events on, in order. A `limit-reached` is recorded
// before it is passed on, so the limits keep the order of the stream; the
// capabilities it calls for are sent beside, never in the way. Once ctx ends,
// the events nobody reads any more are dropped, still recorded, and the
// relay ends with the adapter's stream.
func (w watchedEngine) watch(ctx context.Context, run engine.Run, model string) engine.Run {
	events := make(chan contracts.EngineEvent)
	go func() {
		defer close(events)
		reading := true
		for event := range run.Events() {
			if w.reporter.record(w.ID(), model, event) {
				go w.reporter.report(context.WithoutCancel(ctx))
			}
			if !reading {
				continue
			}
			select {
			case events <- event:
			case <-ctx.Done():
				reading = false
			}
		}
	}()
	return watchedRun{Run: run, events: events}
}

type watchedRun struct {
	engine.Run
	events chan contracts.EngineEvent
}

func (w watchedRun) Events() <-chan contracts.EngineEvent { return w.events }
