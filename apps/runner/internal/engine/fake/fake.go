// Package fake is an in-process Engine that replays a list of normalised
// events, for the tests of the Sessions (RUNNER-9) and the fake Runner. It
// runs nothing: each run emits Events in order, numbered from 1, waits after
// a `question` or a `permission-request` until it is answered (then emits
// its `answer`; with Together, after the last of requests that follow one
// another, until each is), and ends after
// the last one (with StayOpen, once End is called after it, as Claude Code
// that takes messages between its turns). Interrupt ends it at once with a `result` `interrupted`;
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
	// APIKey, when set, makes Capabilities say a Compte IA of `api-key`,
	// connected, with its Models usable, when it gives a key, and `none`,
	// `login-required`, every model unusable, when it gives "" (the adapters
	// read their key the same way, RUNNER-7). Caps wins over it.
	APIKey func(context.Context) (string, error)
	// Models are the models Capabilities lists when Caps is nil.
	Models []contracts.EngineCapabilitiesModelsElem
	// Events are what every run emits, their seq and instant set by the run.
	Events []contracts.EngineEvent
	// Err is what Wait returns once the events are emitted (a Moteur that
	// exits in error), unless the run was interrupted.
	Err error
	// Now gives the instant of each event; nil, time.Now.
	Now func() time.Time
	// Together, when set, emits requests that follow one another at once,
	// several then waiting together (Claude's parallel tool calls), the run
	// going on once every one is answered; unset, it waits after each.
	Together bool
	// StayOpen, when set, keeps every run alive after its last event until
	// End, as a Moteur that waits for its next message; unset, it ends after
	// it.
	StayOpen bool

	mu   sync.Mutex
	runs []*Run
}

func (e *Engine) ID() contracts.EngineId {
	if e.EngineID == "" {
		return contracts.EngineIdClaudeCode
	}
	return e.EngineID
}

func (e *Engine) Capabilities(ctx context.Context) (contracts.EngineCapabilities, error) {
	if e.Caps != nil {
		caps := *e.Caps
		caps.Engine = e.ID()
		return caps, nil
	}
	caps := contracts.EngineCapabilities{
		Engine:       e.ID(),
		Installed:    true,
		KnownVersion: true,
		Account:      contracts.EngineCapabilitiesAccount{Kind: contracts.EngineCapabilitiesAccountKindSubscription, State: contracts.EngineCapabilitiesAccountStateConnected},
		Models:       []contracts.EngineCapabilitiesModelsElem{},
		Features:     contracts.EngineCapabilitiesFeatures{Interrupt: true, Resume: true, Questions: true, Permissions: true},
	}
	if e.APIKey != nil {
		key, err := e.APIKey(ctx)
		if err != nil {
			return caps, err
		}
		caps.Account = contracts.EngineCapabilitiesAccount{Kind: contracts.EngineCapabilitiesAccountKindApiKey, State: contracts.EngineCapabilitiesAccountStateConnected}
		if key == "" {
			caps.Account = contracts.EngineCapabilitiesAccount{Kind: contracts.EngineCapabilitiesAccountKindNone, State: contracts.EngineCapabilitiesAccountStateLoginRequired}
		}
	}
	connected := caps.Account.State == contracts.EngineCapabilitiesAccountStateConnected
	for _, m := range e.Models {
		m.Usable, m.Reason = connected, nil
		if !connected {
			reason := contracts.EngineCapabilitiesModelsElemReasonLoginRequired
			m.Reason = &reason
		}
		caps.Models = append(caps.Models, m)
	}
	return caps, nil
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
		end:       make(chan struct{}),
		now:       now,
		stayOpen:  e.StayOpen,
	}
	e.mu.Lock()
	e.runs = append(e.runs, r)
	e.mu.Unlock()
	r.together = e.Together
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
	together  bool
	stayOpen  bool

	events    chan contracts.EngineEvent
	interrupt chan struct{}
	answers   chan answerRequest
	done      chan struct{}
	end       chan struct{} // closed by End
	endOnce   sync.Once
	err       error

	mu       sync.Mutex
	ended    bool
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
	pending := map[string]bool{}
	for i, event := range events {
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
		if id := requestID(event); id != "" {
			pending[id] = true
		}
		if r.together && i+1 < len(events) && requestID(events[i+1]) != "" {
			continue
		}
		for len(pending) > 0 {
			select {
			case <-ctx.Done():
				r.err = ctx.Err()
				return
			case <-r.interrupt:
				interrupted()
				return
			case req := <-r.answers:
				if !pending[req.id] {
					req.reply <- engine.ErrNoSuchRequest
					continue
				}
				r.mu.Lock()
				r.answered = append(r.answered, RecordedAnswer{RequestID: req.id, Answer: req.answer})
				r.mu.Unlock()
				req.reply <- nil
				delete(pending, req.id)
				select {
				case r.events <- engine.Stamp(engine.AnswerEvent(req.id, req.answer), seq+1, r.now()):
					seq++
				case <-ctx.Done():
					r.err = ctx.Err()
					return
				}
			}
		}
	}
	for r.stayOpen {
		select {
		case <-r.end:
			r.stayOpen = false
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

// End lets a StayOpen run end after its last event; it records the call.
func (r *Run) End(context.Context) error {
	select {
	case <-r.done:
		return engine.ErrRunEnded
	default:
	}
	r.mu.Lock()
	r.ended = true
	r.mu.Unlock()
	r.endOnce.Do(func() { close(r.end) })
	return nil
}

// Ended says whether End was called.
func (r *Run) Ended() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.ended
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
