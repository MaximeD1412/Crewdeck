// Package fake is an in-process Engine that replays a list of normalised
// events, for the tests of the Sessions (RUNNER-9) and the fake Runner. It
// runs nothing: each run emits Events in order, numbered from 1, waits after
// a `question` or a `permission-request` until it is answered, and ends after
// the last one. Interrupt ends it at once with a `result` `interrupted`;
// cancelling the context given to Start or Resume ends it with nothing more,
// as a killed Moteur process would, Wait then returning the context's error.
package fake

import (
	"context"
	"sync"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
)

// Engine is the fake Moteur. Its zero value is a Claude Code with no events.
type Engine struct {
	// EngineID is the Moteur it stands for; empty, claude-code.
	EngineID contracts.EngineId
	// Caps is what Capabilities returns (its engine set to EngineID); nil, an
	// installed, known Moteur, connected, with every feature.
	Caps *contracts.EngineCapabilities
	// Events are what every run emits, their seq and instant set by the run.
	Events []contracts.EngineEvent
	// Err is what Wait returns once the events are emitted (a Moteur that
	// exits in error), unless the run was interrupted.
	Err error
	// Now gives the instant of each event; nil, time.Now.
	Now func() time.Time

	mu   sync.Mutex
	runs []*Run
}

func (e *Engine) ID() contracts.EngineId {
	if e.EngineID == "" {
		return contracts.EngineIdClaudeCode
	}
	return e.EngineID
}

func (e *Engine) Capabilities(context.Context) (contracts.EngineCapabilities, error) {
	if e.Caps != nil {
		caps := *e.Caps
		caps.Engine = e.ID()
		return caps, nil
	}
	return contracts.EngineCapabilities{
		Engine:       e.ID(),
		Installed:    true,
		KnownVersion: true,
		Account:      contracts.EngineCapabilitiesAccount{Kind: contracts.EngineCapabilitiesAccountKindSubscription, State: contracts.EngineCapabilitiesAccountStateConnected},
		Models:       []contracts.EngineCapabilitiesModelsElem{},
		Features:     contracts.EngineCapabilitiesFeatures{Interrupt: true, Resume: true, Questions: true, Permissions: true},
	}, nil
}

func (e *Engine) Start(ctx context.Context, opts engine.StartOptions) (engine.Run, error) {
	return e.start(ctx, opts, ""), nil
}

func (e *Engine) Resume(ctx context.Context, opts engine.ResumeOptions) (engine.Run, error) {
	return e.start(ctx, opts.StartOptions, opts.EngineSessionID), nil
}

// Runs are the runs started so far, in order, for a test to read what they
// were given.
func (e *Engine) Runs() []*Run {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]*Run(nil), e.runs...)
}

func (e *Engine) start(ctx context.Context, opts engine.StartOptions, sessionID string) *Run {
	now := e.Now
	if now == nil {
		now = time.Now
	}
	r := &Run{
		opts:      opts,
		sessionID: sessionID,
		events:    make(chan contracts.EngineEvent),
		interrupt: make(chan struct{}),
		answers:   make(chan answerRequest),
		done:      make(chan struct{}),
		now:       now,
	}
	e.mu.Lock()
	e.runs = append(e.runs, r)
	e.mu.Unlock()
	go r.play(ctx, append([]contracts.EngineEvent(nil), e.Events...), e.Err)
	return r
}

// RecordedAnswer is an Answer a run took.
type RecordedAnswer struct {
	RequestID string
	Answer    engine.Answer
}

// Run is a run of the fake Engine.
type Run struct {
	opts      engine.StartOptions
	sessionID string
	now       func() time.Time

	events    chan contracts.EngineEvent
	interrupt chan struct{}
	answers   chan answerRequest
	done      chan struct{}
	err       error

	mu       sync.Mutex
	sent     []string
	answered []RecordedAnswer
}

type answerRequest struct {
	id     string
	answer engine.Answer
	reply  chan error
}

// play emits the events; it is the only one to write on r.events, and it
// takes every Interrupt and Answer, so that nothing is emitted after an
// Interrupt returns but the `interrupted` result. Every wait of it also ends
// on the context's cancellation.
func (r *Run) play(ctx context.Context, events []contracts.EngineEvent, err error) {
	defer close(r.done)
	defer close(r.events)
	seq := 0 // of the last event emitted
	interrupted := func() {
		select {
		case r.events <- engine.Stamp(contracts.EngineEvent{Result: &contracts.EngineEventResult{Status: contracts.EngineEventResultStatusInterrupted}}, seq+1, r.now()):
		case <-ctx.Done():
			r.err = ctx.Err()
		}
	}
	for _, event := range events {
		next := engine.Stamp(event, seq+1, r.now())
		for sent := false; !sent; {
			select {
			case r.events <- next:
				seq++
				sent = true
			case <-ctx.Done():
				r.err = ctx.Err()
				return
			case <-r.interrupt:
				interrupted()
				return
			case req := <-r.answers:
				req.reply <- engine.ErrNoSuchRequest
			}
		}
		pending := requestID(event)
		for pending != "" {
			select {
			case <-ctx.Done():
				r.err = ctx.Err()
				return
			case <-r.interrupt:
				interrupted()
				return
			case req := <-r.answers:
				if req.id != pending {
					req.reply <- engine.ErrNoSuchRequest
					continue
				}
				r.mu.Lock()
				r.answered = append(r.answered, RecordedAnswer{RequestID: req.id, Answer: req.answer})
				r.mu.Unlock()
				req.reply <- nil
				pending = ""
			}
		}
	}
	r.err = err
}

func requestID(event contracts.EngineEvent) string {
	switch {
	case event.Question != nil:
		return event.Question.RequestId
	case event.PermissionRequest != nil:
		return event.PermissionRequest.RequestId
	}
	return ""
}

func (r *Run) Events() <-chan contracts.EngineEvent { return r.events }

// Send records the text; the fake's events do not depend on it.
func (r *Run) Send(_ context.Context, text string) error {
	select {
	case <-r.done:
		return engine.ErrRunEnded
	default:
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sent = append(r.sent, text)
	return nil
}

func (r *Run) Answer(ctx context.Context, requestID string, answer engine.Answer) error {
	reply := make(chan error, 1)
	select {
	case r.answers <- answerRequest{id: requestID, answer: answer, reply: reply}:
		return <-reply
	case <-r.done:
		return engine.ErrRunEnded
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (r *Run) Interrupt(ctx context.Context) error {
	select {
	case r.interrupt <- struct{}{}:
		return nil
	case <-r.done:
		return engine.ErrRunEnded
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (r *Run) Wait() error {
	<-r.done
	return r.err
}

// Options are the options the run was started with.
func (r *Run) Options() engine.StartOptions { return r.opts }

// EngineSessionID is the Session it resumes, empty for a Start.
func (r *Run) EngineSessionID() string { return r.sessionID }

// Sent are the texts sent to it, in order.
func (r *Run) Sent() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.sent...)
}

// Answers are the answers it took, in order.
func (r *Run) Answers() []RecordedAnswer {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]RecordedAnswer(nil), r.answered...)
}
