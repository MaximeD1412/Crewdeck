package session_test

import (
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/fake"
)

const answerInputID = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d05"

func colours(id string) contracts.EngineEvent {
	detail := "Le vert du logo"
	return contracts.EngineEvent{Question: &contracts.EngineEventQuestion{RequestId: id, Title: "Quelle couleur ?", Options: []contracts.EngineEventQuestionOptionsElem{{Label: "Bleu"}, {Label: "Vert", Detail: &detail}}}}
}

func permissionRequest(id string) contracts.EngineEvent {
	return contracts.EngineEvent{PermissionRequest: &contracts.EngineEventPermissionRequest{RequestId: id, Tool: "Bash", Command: "git push origin feat/12-panier"}}
}

// request is the next session.waiting or session.answered the manager sends.
func (r *relayed) request(t *testing.T) any {
	t.Helper()
	select {
	case m := <-r.reports.requests:
		return m
	case <-time.After(10 * time.Second):
		t.Fatal("no session.waiting nor session.answered sent")
		return nil
	}
}

func (r *relayed) noRequest(t *testing.T) {
	t.Helper()
	select {
	case m := <-r.reports.requests:
		t.Fatalf("sent %+v", m)
	case <-time.After(200 * time.Millisecond):
	}
}

func (r *relayed) waiting(t *testing.T, requestID string, kind contracts.RunnerSessionWaitingKind, seq int) {
	t.Helper()
	w, ok := r.request(t).(contracts.RunnerSessionWaiting)
	if !ok || w.SessionId != firstID || w.RequestId != requestID || w.Kind != kind || w.Seq != seq {
		t.Fatalf("got %+v, want the session.waiting of %s (%s, seq %d)", w, requestID, kind, seq)
	}
}

func (r *relayed) answered(t *testing.T, requestID string) {
	t.Helper()
	a, ok := r.request(t).(contracts.RunnerSessionAnswered)
	if !ok || a.SessionId != firstID || a.RequestId != requestID {
		t.Fatalf("got %+v, want the session.answered of %s", a, requestID)
	}
}

// liveEvent is the next live event relayed, opened.
func (r *relayed) liveEvent(t *testing.T, key []byte) map[string]any {
	t.Helper()
	for {
		if frame, ok := r.frame(t).(contracts.RunnerRelay); ok {
			return openFrame(t, key, frame)
		}
	}
}

func (r *relayed) answers(t *testing.T, want int) []fake.RecordedAnswer {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		answers := r.engine.Runs()[0].Answers()
		if len(answers) >= want || time.Now().After(deadline) {
			return answers
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestAnswerAQuestionByItsOptionsReachesTheMoteurOnceAndIsLogged(t *testing.T) {
	r := newRelayed(t, message("une question"), colours("q1"), message("Vert, donc"))
	m := r.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	key := r.openKeys(t, r.frame(t).(contracts.RunnerSessionKeys), r.holders[0])
	r.waiting(t, "q1", contracts.RunnerSessionWaitingKindQuestion, 2)

	m.Input(sealInput(t, key, firstID, inputID, map[string]any{"kind": "answer", "requestId": "q1", "optionIndexes": []int{1}}))
	r.answered(t, "q1")
	answers := r.answers(t, 1)
	if len(answers) != 1 || answers[0].RequestID != "q1" || len(answers[0].Answer.Options) != 1 || answers[0].Answer.Options[0] != "Vert" {
		t.Fatalf("answers %+v, want the label of option 1", answers)
	}
	for _, kind := range []string{"message", "question"} {
		if event := r.liveEvent(t, key); event["kind"] != kind {
			t.Fatalf("event %v, want %s", event, kind)
		}
	}
	if event := r.liveEvent(t, key); event["kind"] != "answer" || event["requestId"] != "q1" || event["seq"] != float64(3) {
		t.Fatalf("event %v, want the answer logged as seq 3", event)
	}

	// Answered again, from another tab: nothing reaches the Moteur.
	m.Input(sealInput(t, key, firstID, answerInputID, map[string]any{"kind": "answer", "requestId": "q1", "optionIndexes": []int{0}}))
	r.noRequest(t)
	if answers := r.engine.Runs()[0].Answers(); len(answers) != 1 {
		t.Fatalf("answers %+v, want the first one only", answers)
	}
}

func TestAnswerAQuestionWithATextOfTheirOwn(t *testing.T) {
	r := newRelayed(t, colours("q1"), message("D’accord"))
	m := r.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	key := r.openKeys(t, r.frame(t).(contracts.RunnerSessionKeys), r.holders[0])
	r.waiting(t, "q1", contracts.RunnerSessionWaitingKindQuestion, 1)

	m.Input(sealInput(t, key, firstID, inputID, map[string]any{"kind": "answer", "requestId": "q1", "text": "Les deux"}))
	r.answered(t, "q1")
	if answers := r.answers(t, 1); len(answers) != 1 || answers[0].Answer.Text != "Les deux" || answers[0].Answer.Options != nil {
		t.Fatalf("answers %+v, want the text", answers)
	}
}

func TestAnswerOutsideTheQuestionIsDropped(t *testing.T) {
	r := newRelayed(t, colours("q1"), message("D’accord"))
	m := r.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	key := r.openKeys(t, r.frame(t).(contracts.RunnerSessionKeys), r.holders[0])
	r.waiting(t, "q1", contracts.RunnerSessionWaitingKindQuestion, 1)

	m.Input(sealInput(t, key, firstID, inputID, map[string]any{"kind": "answer", "requestId": "q1", "optionIndexes": []int{2}}))
	m.Input(sealInput(t, key, firstID, answerInputID, map[string]any{"kind": "answer", "requestId": "q1", "optionIndexes": []int{0, 1}}))
	m.Input(sealInput(t, key, firstID, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d06", map[string]any{"kind": "permission", "requestId": "q1", "decision": "allow"}))
	r.noRequest(t)
	if answers := r.engine.Runs()[0].Answers(); len(answers) != 0 {
		t.Fatalf("answers %+v, want none", answers)
	}
}

func TestAnswerAPermissionByEachDecisionReachesTheMoteur(t *testing.T) {
	r := newRelayed(t, permissionRequest("p1"), permissionRequest("p2"), permissionRequest("p3"), message("fini"))
	m := r.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	key := r.openKeys(t, r.frame(t).(contracts.RunnerSessionKeys), r.holders[0])

	ids := []string{answerInputID, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d06", "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d07"}
	for i, decision := range []string{"allow", "allow-session", "deny"} {
		id := []string{"p1", "p2", "p3"}[i]
		r.waiting(t, id, contracts.RunnerSessionWaitingKindPermission, 2*i+1)
		m.Input(sealInput(t, key, firstID, ids[i], map[string]any{"kind": "permission", "requestId": id, "decision": decision}))
		r.answered(t, id)
	}
	answers := r.answers(t, 3)
	if len(answers) != 3 {
		t.Fatalf("answers %+v", answers)
	}
	for i, want := range []struct{ allow, forSession bool }{{true, false}, {true, true}, {false, false}} {
		a := answers[i].Answer
		if a.Allow == nil || *a.Allow != want.allow || a.ForSession != want.forSession {
			t.Fatalf("answer %d %+v, want allow %v for the session %v", i, a, want.allow, want.forSession)
		}
	}
}

func TestASessionStaysWaitingWhileAnotherRequestWaits(t *testing.T) {
	r := newRelayed(t, permissionRequest("p1"), permissionRequest("p2"), message("fini"))
	r.engine.Together = true
	m := r.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	key := r.openKeys(t, r.frame(t).(contracts.RunnerSessionKeys), r.holders[0])
	r.waiting(t, "p1", contracts.RunnerSessionWaitingKindPermission, 1)
	r.waiting(t, "p2", contracts.RunnerSessionWaitingKindPermission, 2)

	m.Input(sealInput(t, key, firstID, answerInputID, map[string]any{"kind": "permission", "requestId": "p1", "decision": "allow"}))
	r.answered(t, "p1")
	r.noRequest(t)
	states := r.reports.states(firstID)
	if last := states[len(states)-1]; last != contracts.RunnerSessionStateStateWaiting {
		t.Fatalf("states %v, want waiting while p2 waits", states)
	}
	for _, state := range states[2:] {
		if state == contracts.RunnerSessionStateStateActive {
			t.Fatalf("states %v, active while p2 waits", states)
		}
	}

	m.Input(sealInput(t, key, firstID, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d06", map[string]any{"kind": "permission", "requestId": "p2", "decision": "deny"}))
	r.answered(t, "p2")
	r.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)
	if answers := r.answers(t, 2); len(answers) != 2 {
		t.Fatalf("answers %+v", answers)
	}
}
