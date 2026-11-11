package accounts

import (
	"context"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
)

// Watch gives the adapters of `registry` with every Run they start watched
// by the Reporter: a `limit-reached` or an `auth-required` of a Session
// reaches observe, and so the next capabilities. The Runner drives its
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

// watch passes the run's events on, in order, and has the Reporter observe
// them; the capabilities they call for are sent beside, never in the way.
func (w watchedEngine) watch(ctx context.Context, run engine.Run, model string) engine.Run {
	events := make(chan contracts.EngineEvent)
	go func() {
		defer close(events)
		for event := range run.Events() {
			if event.LimitReached != nil || event.AuthRequired != nil {
				go w.reporter.observe(context.WithoutCancel(ctx), w.ID(), model, event)
			}
			events <- event
		}
	}()
	return watchedRun{Run: run, events: events}
}

type watchedRun struct {
	engine.Run
	events chan contracts.EngineEvent
}

func (w watchedRun) Events() <-chan contracts.EngineEvent { return w.events }
