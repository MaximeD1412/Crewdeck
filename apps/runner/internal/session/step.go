package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
)

// The Étape of a Session (RUNNER-12): what its official Skill says to the
// Runner with `crewdeck-runner etape`, over runner.sock, the Session named
// by SessionEnv, which its shims and its Moteur's environment set.
//
//   - start: step.started goes to the server, the Étape's context comes back;
//   - report: the figures go as they are, the content sealed under the vault
//     key with the additional data "step.report:<stepRunId>";
//   - ask: a normalised `question` in the Session's stream, waiting as a
//     Moteur's (SESSION-3); the Pilote's answer comes back through `answer`,
//     never to the Moteur.
//
// Once the Session ended ok, its Contrat is checked on its worktree and its
// change of code, and step.verdict goes before its end (sendVerdict).

// The runner.sock ops of `crewdeck-runner etape`.
const (
	OpStepStart  = "step.start"
	OpStepReport = "step.report"
	OpStepAsk    = "step.ask"
	OpStepAnswer = "step.answer"
)

// SessionEnv names the Session in its Moteur's environment, for `etape`.
const SessionEnv = "CREWDECK_SESSION_ID"

// StepReportFiguresMax is the longest report's figures, as JSON
// (STEP_REPORT_FIGURES_MAX).
const StepReportFiguresMax = 16_384

// StepReportContentMax is the longest report's content: its sealed item's
// ciphertext, a nonce and a tag around it, is 64 KiB at most.
const StepReportContentMax = 65_536 - 12 - 16

// stepAskPoll is how long one `answer` waits, below runner.sock's Timeout.
const stepAskPoll = 25 * time.Second

// verdictBound is how long the Contrat's check lasts at most.
const verdictBound = 2 * time.Minute

// StepRequest names the Session of an `etape` call.
type StepRequest struct {
	SessionID string `json:"sessionId"`
}

// StepContext is what `etape start` prints: the Étape the Session runs.
type StepContext struct {
	StepRunID  string                                       `json:"stepRunId"`
	StepKind   contracts.RunnerSessionStartStepStepKind     `json:"stepKind"`
	Skill      string                                       `json:"skill"`
	ContractID *string                                      `json:"contractId"`
	ProjectID  string                                       `json:"projectId"`
	Origin     contracts.Origin                             `json:"origin"`
	Branch     string                                       `json:"branch"`
	Base       string                                       `json:"base"`
	Inputs     []contracts.RunnerSessionStartStepInputsElem `json:"inputs"`
}

// StepReportRequest is `etape report`'s: the figures the server reads, the
// content it never does.
type StepReportRequest struct {
	SessionID string          `json:"sessionId"`
	Figures   json.RawMessage `json:"figures"`
	Content   *string         `json:"content,omitempty"`
}

// StepQuestion is a Skill's question to the Pilote.
type StepQuestion struct {
	Title    string                                     `json:"title"`
	Options  []contracts.EngineEventQuestionOptionsElem `json:"options"`
	Multiple bool                                       `json:"multiple"`
}

// StepAskRequest is `etape ask`'s.
type StepAskRequest struct {
	SessionID string       `json:"sessionId"`
	Question  StepQuestion `json:"question"`
}

// StepAskReply names the question asked, for `answer`.
type StepAskReply struct {
	RequestID string `json:"requestId"`
}

// StepAnswerRequest waits for the answer to the question.
type StepAnswerRequest struct {
	SessionID string `json:"sessionId"`
	RequestID string `json:"requestId"`
}

// StepAnswer is the Pilote's answer: their text, or the options they chose.
type StepAnswer struct {
	Text    *string  `json:"text,omitempty"`
	Options []string `json:"options,omitempty"`
}

// StepAnswerReply is the answer, Answered false while it has not come.
type StepAnswerReply struct {
	Answered bool        `json:"answered"`
	Answer   *StepAnswer `json:"answer,omitempty"`
}

// runLog is the log of the running run, which its Moteur's events and the
// Étape's own (a question, its answer) share: each of the Étape's takes the
// next seq, and the Moteur's that follow it one more (offset).
type runLog struct {
	mu     sync.Mutex
	log    *sessionLog
	key    []byte
	offset int
	closed bool
}

// ask is a question of the Étape that waits; its fields are s.mu's.
type ask struct {
	done    chan struct{}
	settled bool
	answer  *engine.Answer
}

// logEvent writes the run's event in the log, relays it and tracks it: a
// Moteur's with the run's offset, the Étape's (injected, its seq 1) after the
// last one; false when it was not written.
func (m *Manager) logEvent(s *live, out *runLog, event contracts.EngineEvent, injected bool) bool {
	out.mu.Lock()
	defer out.mu.Unlock()
	if out.closed {
		return false
	}
	offset := out.offset
	if injected {
		offset = out.log.lastSeq
	}
	stamped, err := out.log.append(event, offset)
	if err != nil {
		m.cfg.Logger.Warn("session.log", "sessionId", s.sessionID(), "error", errorKind(err))
		return false
	}
	if injected {
		out.offset++
	}
	m.relayLive(out.key, s.sessionID(), stamped)
	m.track(s, stamped)
	return true
}

// openRun gives the run of s its log and no question yet.
func (m *Manager) openRun(s *live, log *sessionLog, key []byte) *runLog {
	out := &runLog{log: log, key: key, offset: log.lastSeq}
	s.mu.Lock()
	s.out, s.asks = out, map[string]*ask{}
	s.mu.Unlock()
	return out
}

// closeRun ends the run's log: the Étape's questions still waiting are
// withdrawn, their `answer` says `ended`.
func (m *Manager) closeRun(s *live, out *runLog) {
	out.mu.Lock()
	out.closed = true
	out.mu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.asks {
		if !a.settled {
			a.settled = true
			close(a.done)
		}
	}
	s.out, s.asks = nil, nil
}

func (s *live) sessionID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rec.SessionID
}

// ServeSteps has runner.sock answer `crewdeck-runner etape`: `not-found` for
// a Session the Runner does not know, `no-step` for one without an Étape,
// `not-running` for one whose Moteur does not run.
func (m *Manager) ServeSteps(sock *localsock.Server) {
	sock.Handle(OpStepStart, func(ctx context.Context, raw json.RawMessage) (any, error) {
		var request StepRequest
		if err := json.Unmarshal(raw, &request); err != nil {
			return nil, codedError("bad-request")
		}
		_, rec, err := m.stepSession(request.SessionID)
		if err != nil {
			return nil, err
		}
		step := rec.Step
		if err := m.sendStep(ctx, rec.SessionID, protocol.NewStepStarted(step.StepRunId)); err != nil {
			return nil, err
		}
		var contractID *string
		if id, ok := step.ContractId.(string); ok {
			contractID = &id
		}
		inputs := step.Inputs
		if inputs == nil {
			inputs = []contracts.RunnerSessionStartStepInputsElem{}
		}
		return StepContext{
			StepRunID: step.StepRunId, StepKind: step.StepKind, Skill: step.Skill, ContractID: contractID,
			ProjectID: rec.ProjectID, Origin: rec.Origin, Branch: rec.Branch, Base: rec.Base, Inputs: inputs,
		}, nil
	})
	sock.Handle(OpStepReport, func(ctx context.Context, raw json.RawMessage) (any, error) {
		var request StepReportRequest
		if err := json.Unmarshal(raw, &request); err != nil {
			return nil, codedError("bad-request")
		}
		var figures map[string]any
		if err := json.Unmarshal(request.Figures, &figures); err != nil || figures == nil {
			return nil, codedError("bad-request")
		}
		if n, err := jsonLength(figures); err != nil || n > StepReportFiguresMax {
			return nil, codedError("too-long")
		}
		if request.Content != nil && len(*request.Content) > StepReportContentMax {
			return nil, codedError("too-long")
		}
		_, rec, err := m.stepSession(request.SessionID)
		if err != nil {
			return nil, err
		}
		stepRunID := rec.Step.StepRunId
		var sealed *contracts.RunnerStepReportSealed
		if request.Content != nil && *request.Content != "" {
			if m.cfg.Seal == nil {
				return nil, codedError("unavailable")
			}
			item, err := m.cfg.Seal([]byte(*request.Content), []byte(StepReportAAD(stepRunID)))
			if err != nil {
				m.cfg.Logger.Warn("session.step", "sessionId", rec.SessionID, "step", "seal", "error", errorKind(err))
				return nil, codedError("unavailable")
			}
			sealed = &contracts.RunnerStepReportSealed{Key: base64.RawURLEncoding.EncodeToString(item.Key), Ciphertext: base64.RawURLEncoding.EncodeToString(item.Ciphertext)}
		}
		return nil, m.sendStep(ctx, rec.SessionID, protocol.NewStepReport(stepRunID, figures, sealed))
	})
	sock.Handle(OpStepAsk, func(_ context.Context, raw json.RawMessage) (any, error) {
		var request StepAskRequest
		if err := json.Unmarshal(raw, &request); err != nil {
			return nil, codedError("bad-request")
		}
		event, err := questionEvent(request.Question)
		if err != nil {
			return nil, err
		}
		s, _, err := m.stepSession(request.SessionID)
		if err != nil {
			return nil, err
		}
		requestID := event.Question.RequestId
		s.mu.Lock()
		out := s.out
		if out == nil {
			s.mu.Unlock()
			return nil, codedError("not-running")
		}
		s.asks[requestID] = &ask{done: make(chan struct{})}
		s.mu.Unlock()
		if !m.logEvent(s, out, event, true) {
			s.mu.Lock()
			if s.asks != nil {
				delete(s.asks, requestID)
			}
			s.mu.Unlock()
			return nil, codedError("unavailable")
		}
		m.setState(s, contracts.RunnerSessionStateStateWaiting)
		return StepAskReply{RequestID: requestID}, nil
	})
	sock.Handle(OpStepAnswer, func(ctx context.Context, raw json.RawMessage) (any, error) {
		var request StepAnswerRequest
		if err := json.Unmarshal(raw, &request); err != nil || request.RequestID == "" {
			return nil, codedError("bad-request")
		}
		m.mu.Lock()
		s := m.sessions[request.SessionID]
		m.mu.Unlock()
		if s == nil {
			return nil, codedError("not-found")
		}
		s.mu.Lock()
		if s.asks == nil {
			s.mu.Unlock()
			return nil, codedError("ended")
		}
		a := s.asks[request.RequestID]
		s.mu.Unlock()
		if a == nil {
			return nil, codedError("not-found")
		}
		poll := m.cfg.AskPoll
		if poll == 0 {
			poll = stepAskPoll
		}
		timer := time.NewTimer(poll)
		defer timer.Stop()
		select {
		case <-a.done:
		case <-timer.C:
			return StepAnswerReply{}, nil
		case <-ctx.Done():
			return StepAnswerReply{}, nil
		}
		s.mu.Lock()
		answer := a.answer
		s.mu.Unlock()
		if answer == nil {
			return nil, codedError("ended")
		}
		reply := &StepAnswer{Options: answer.Options}
		if len(answer.Options) == 0 {
			text := answer.Text
			reply.Text = &text
		}
		return StepAnswerReply{Answered: true, Answer: reply}, nil
	})
}

// StepReportAAD is the additional data a report's content is sealed under
// (stepReportAad): its StepRun's.
func StepReportAAD(stepRunID string) string { return "step.report:" + stepRunID }

// stepSession is the running Session of an Étape, and its record.
func (m *Manager) stepSession(id string) (*live, record, error) {
	m.mu.Lock()
	s := m.sessions[id]
	m.mu.Unlock()
	if s == nil {
		return nil, record{}, codedError("not-found")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case s.rec.Step == nil:
		return nil, record{}, codedError("no-step")
	case !s.alive || s.run == nil:
		return nil, record{}, codedError("not-running")
	}
	return s, s.rec, nil
}

// sendStep sends an Étape's message to the server: `offline` when the
// Runner is not connected (the Skill tries again), `unavailable` when the
// send failed.
func (m *Manager) sendStep(ctx context.Context, sessionID string, message any) error {
	if m.cfg.Send == nil {
		return codedError("offline")
	}
	err := m.cfg.Send(ctx, message)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, protocol.ErrNotConnected):
		return codedError("offline")
	}
	m.cfg.Logger.Warn("session.step", "sessionId", sessionID, "step", "send", "error", errorKind(err))
	return codedError("unavailable")
}

// jsonLength is the length of v as JSON.stringify writes it, in UTF-16
// code units.
func jsonLength(v any) (int, error) {
	var out strings.Builder
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(v); err != nil {
		return 0, err
	}
	return len(utf16.Encode([]rune(strings.TrimSuffix(out.String(), "\n")))), nil
}

// questionEvent is the Skill's question as a normalised `question`, its
// requestId the Étape's own: `bad-request` for one outside its schema.
func questionEvent(q StepQuestion) (contracts.EngineEvent, error) {
	if strings.TrimSpace(q.Title) == "" {
		return contracts.EngineEvent{}, codedError("bad-request")
	}
	options := q.Options
	if options == nil {
		options = []contracts.EngineEventQuestionOptionsElem{}
	}
	for _, o := range options {
		if strings.TrimSpace(o.Label) == "" {
			return contracts.EngineEvent{}, codedError("bad-request")
		}
	}
	if q.Multiple && len(options) == 0 {
		return contracts.EngineEvent{}, codedError("bad-request")
	}
	id := make([]byte, 8)
	if _, err := rand.Read(id); err != nil {
		return contracts.EngineEvent{}, codedError("unavailable")
	}
	event := contracts.EngineEvent{Question: &contracts.EngineEventQuestion{
		Kind: contracts.EngineEventKindQuestion, Seq: 1, At: time.Now().UTC(),
		RequestId: "etape-" + hex.EncodeToString(id), Title: q.Title, Options: options, Multiple: q.Multiple,
	}}
	// Through its schema: what the tabs will read of it.
	data, err := json.Marshal(event)
	if err == nil {
		var checked contracts.EngineEvent
		err = json.Unmarshal(data, &checked)
	}
	if err != nil {
		return contracts.EngineEvent{}, codedError("bad-request")
	}
	return event, nil
}

// answerAsk hands the Pilote's answer to the Étape's question it answers,
// false when the request is no question of the Étape (the Moteur's own).
// The answer is logged, and session.answered sent, before `answer` gives it.
func (m *Manager) answerAsk(s *live, requestID string, answer engine.Answer) bool {
	s.mu.Lock()
	a := s.asks[requestID]
	out := s.out
	if a == nil {
		s.mu.Unlock()
		return false
	}
	if a.settled {
		s.mu.Unlock()
		return true
	}
	a.settled, a.answer = true, &answer
	s.mu.Unlock()
	if out != nil {
		m.logEvent(s, out, engine.Stamp(engine.AnswerEvent(requestID, answer), 1, time.Now()), true)
	}
	close(a.done)
	state := contracts.RunnerSessionStateStateActive
	s.mu.Lock()
	if len(s.pending) > 0 {
		state = contracts.RunnerSessionStateStateWaiting
	}
	running := s.run != nil
	s.mu.Unlock()
	if running {
		m.setState(s, state)
	}
	return true
}

// sendVerdict checks the Contrat of the Session's Étape on its worktree and
// its change of code, and sends step.verdict; a Contrat this Runner does not
// embed, a change not read or a check that failed send none, only its code
// logged. gitEnv lets a check reach the worktree's origin (the Session's
// token for a GitHub clone).
func (m *Manager) sendVerdict(w Worktree, rec record, gitEnv []string) {
	if rec.Step == nil {
		return
	}
	id, ok := rec.Step.ContractId.(string)
	if !ok || id == "" {
		return
	}
	warn := func(code string) {
		m.cfg.Logger.Warn("session.verdict", "sessionId", rec.SessionID, "contractId", id, "error", code)
	}
	c, err := contrat.Get(id)
	if err != nil {
		warn("unknown-contrat")
		return
	}
	ctx, cancel := context.WithTimeout(m.ctx, verdictBound)
	defer cancel()
	var pr *contrat.PullRequest
	// A Contrat with no `pr` rule (the Inventaire's) never reads the change:
	// a Miroir that cannot reach GitHub does not leave it without a verdict.
	if m.cfg.ChangeOf != nil && c.ReadsChange() {
		if pr, err = m.cfg.ChangeOf(ctx, rec.ProjectID, rec.Branch); err != nil {
			warn("change-unread")
			return
		}
	}
	verdict, err := contrat.Check(ctx, c, contrat.Target{Dir: w.Dir, IntegrationBranch: rec.Base, PR: pr, GitEnv: gitEnv})
	if err != nil {
		warn("check-failed")
		return
	}
	m.sendMessage(rec.SessionID, protocol.NewStepVerdict(rec.Step.StepRunId, verdict))
}
