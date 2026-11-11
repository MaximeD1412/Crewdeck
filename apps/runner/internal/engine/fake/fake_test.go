package fake_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/fake"
)

func message(text string) contracts.EngineEvent {
	return contracts.EngineEvent{Message: &contracts.EngineEventMessage{From: "agent", Text: text, Final: true}}
}

func question(id string) contracts.EngineEvent {
	return contracts.EngineEvent{Question: &contracts.EngineEventQuestion{
		RequestId: id, Title: "Quelle couleur ?", Options: []contracts.EngineEventQuestionOptionsElem{{Label: "Bleu"}, {Label: "Rouge"}},
	}}
}

func ok() contracts.EngineEvent {
	return contracts.EngineEvent{Result: &contracts.EngineEventResult{Status: contracts.EngineEventResultStatusOk}}
}

func next(t *testing.T, run engine.Run) (contracts.EngineEvent, bool) {
	t.Helper()
	select {
	case event, open := <-run.Events():
		return event, open
	case <-time.After(5 * time.Second):
		t.Fatal("no event after 5 s")
		return contracts.EngineEvent{}, false
	}
}

func drain(t *testing.T, run engine.Run) []contracts.EngineEvent {
	t.Helper()
	var events []contracts.EngineEvent
	for {
		event, open := next(t, run)
		if !open {
			return events
		}
		events = append(events, event)
	}
}

var _ engine.Engine = (*fake.Engine)(nil)

func TestTheFakeEngineEmitsItsEventsInOrderNumberedFromOneThenEnds(t *testing.T) {
	e := &fake.Engine{Events: []contracts.EngineEvent{message("Bonjour"), message("Fini"), ok()}}
	run, err := e.Start(context.Background(), engine.StartOptions{InitialPrompt: "Dis bonjour"})
	if err != nil {
		t.Fatal(err)
	}
	events := drain(t, run)
	if len(events) != 3 || events[0].Message.Text != "Bonjour" || events[1].Message.Text != "Fini" || events[2].Kind() != contracts.EngineEventKindResult {
		t.Fatalf("events %+v", events)
	}
	for i, event := range events {
		if seq := seqOf(event); seq != i+1 {
			t.Errorf("event %d: seq %d", i, seq)
		}
	}
	if err := run.Wait(); err != nil {
		t.Fatal(err)
	}
	if err := run.Send(context.Background(), "encore"); !errors.Is(err, engine.ErrRunEnded) {
		t.Fatalf("Send after the end: %v", err)
	}
	if runs := e.Runs(); len(runs) != 1 || runs[0].Options().InitialPrompt != "Dis bonjour" {
		t.Fatalf("runs %+v", runs)
	}
}

func TestTheFakeEngineHonoursInterruptWithAnInterruptedResult(t *testing.T) {
	e := &fake.Engine{Events: []contracts.EngineEvent{message("Je commence"), message("Jamais émis"), ok()}}
	run, err := e.Start(context.Background(), engine.StartOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if first, _ := next(t, run); first.Message == nil || first.Message.Text != "Je commence" {
		t.Fatalf("first event %+v", first)
	}
	if err := run.Interrupt(context.Background()); err != nil {
		t.Fatal(err)
	}
	rest := drain(t, run)
	if len(rest) != 1 || rest[0].Result == nil || rest[0].Result.Status != contracts.EngineEventResultStatusInterrupted || rest[0].Result.Seq != 2 {
		t.Fatalf("after the interrupt %+v", rest)
	}
	if err := run.Wait(); err != nil {
		t.Fatal(err)
	}
	if err := run.Interrupt(context.Background()); !errors.Is(err, engine.ErrRunEnded) {
		t.Fatalf("Interrupt after the end: %v", err)
	}
}

func TestTheFakeEngineWaitsForTheAnswerToAQuestionAndRecordsIt(t *testing.T) {
	e := &fake.Engine{Events: []contracts.EngineEvent{question("q-1"), message("Bleu, donc"), ok()}}
	run, err := e.Start(context.Background(), engine.StartOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if asked, _ := next(t, run); asked.Question == nil {
		t.Fatalf("first event %+v", asked)
	}
	select {
	case event := <-run.Events():
		t.Fatalf("emitted %+v before the answer", event)
	case <-time.After(50 * time.Millisecond):
	}
	if err := run.Answer(context.Background(), "q-other", engine.Answer{Options: []string{"Bleu"}}); !errors.Is(err, engine.ErrNoSuchRequest) {
		t.Fatalf("Answer to another request: %v", err)
	}
	if err := run.Answer(context.Background(), "q-1", engine.Answer{Options: []string{"Bleu"}}); err != nil {
		t.Fatal(err)
	}
	if rest := drain(t, run); len(rest) != 2 || rest[0].Message.Text != "Bleu, donc" {
		t.Fatalf("after the answer %+v", rest)
	}
	answers := e.Runs()[0].Answers()
	if len(answers) != 1 || answers[0].RequestID != "q-1" || answers[0].Answer.Options[0] != "Bleu" {
		t.Fatalf("answers %+v", answers)
	}
}

func TestAnInterruptReleasesAPendingRequest(t *testing.T) {
	allow := contracts.EngineEvent{PermissionRequest: &contracts.EngineEventPermissionRequest{RequestId: "p-1", Tool: "Bash", Command: "touch a"}}
	e := &fake.Engine{Events: []contracts.EngineEvent{allow, ok()}}
	run, _ := e.Start(context.Background(), engine.StartOptions{})
	next(t, run)
	if err := run.Interrupt(context.Background()); err != nil {
		t.Fatal(err)
	}
	if rest := drain(t, run); len(rest) != 1 || rest[0].Result.Status != contracts.EngineEventResultStatusInterrupted {
		t.Fatalf("after the interrupt %+v", rest)
	}
}

func TestTheFakeEngineRecordsWhatItIsSentAndTheSessionItResumes(t *testing.T) {
	e := &fake.Engine{EngineID: contracts.EngineIdCodex, Events: []contracts.EngineEvent{question("q-1"), ok()}}
	run, err := e.Resume(context.Background(), engine.ResumeOptions{EngineSessionID: "s-1"})
	if err != nil {
		t.Fatal(err)
	}
	next(t, run)
	if err := run.Send(context.Background(), "Reprends où tu en étais"); err != nil {
		t.Fatal(err)
	}
	_ = run.Answer(context.Background(), "q-1", engine.Answer{Text: "vert"})
	drain(t, run)
	got := e.Runs()[0]
	if got.EngineSessionID() != "s-1" || len(got.Sent()) != 1 || got.Sent()[0] != "Reprends où tu en étais" {
		t.Fatalf("run %+v", got)
	}
	caps, _ := e.Capabilities(context.Background())
	if e.ID() != contracts.EngineIdCodex || caps.Engine != contracts.EngineIdCodex {
		t.Fatalf("id %s, capabilities %+v", e.ID(), caps)
	}
}

func TestTheFakeEngineEndsWithItsError(t *testing.T) {
	boom := errors.New("exit status 1")
	e := &fake.Engine{Events: []contracts.EngineEvent{message("…")}, Err: boom}
	run, _ := e.Start(context.Background(), engine.StartOptions{})
	drain(t, run)
	if err := run.Wait(); !errors.Is(err, boom) {
		t.Fatalf("Wait() = %v", err)
	}
}

func seqOf(event contracts.EngineEvent) int {
	switch {
	case event.Message != nil:
		return event.Message.Seq
	case event.Result != nil:
		return event.Result.Seq
	}
	return -1
}

func TestCancellingTheContextOfStartEndsARunWaitingForAnAnswer(t *testing.T) {
	e := &fake.Engine{Events: []contracts.EngineEvent{question("q-1"), message("Bleu"), ok()}}
	ctx, cancel := context.WithCancel(context.Background())
	run, _ := e.Start(ctx, engine.StartOptions{})
	next(t, run)
	cancel()
	if rest := drain(t, run); len(rest) != 0 {
		t.Fatalf("after the cancel %+v", rest)
	}
	if err := run.Wait(); !errors.Is(err, context.Canceled) {
		t.Fatalf("Wait %v, want context.Canceled", err)
	}
	if err := run.Answer(context.Background(), "q-1", engine.Answer{Options: []string{"Bleu"}}); !errors.Is(err, engine.ErrRunEnded) {
		t.Fatalf("Answer after the cancel %v, want ErrRunEnded", err)
	}
}

func TestCancellingTheContextOfResumeEndsARunWhoseEventsAreNotRead(t *testing.T) {
	e := &fake.Engine{Events: []contracts.EngineEvent{message("Bonjour"), ok()}}
	ctx, cancel := context.WithCancel(context.Background())
	run, _ := e.Resume(ctx, engine.ResumeOptions{EngineSessionID: "s-1"})
	cancel()
	done := make(chan error, 1)
	go func() { done <- run.Wait() }()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Wait %v, want context.Canceled", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Wait still blocked 5 s after the cancel")
	}
}
