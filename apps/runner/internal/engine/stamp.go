package engine

import (
	"reflect"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// Stamp gives a copy of the event, of whatever kind, with its seq and the
// instant the Runner read it: what a Run sets on each event it emits. Every
// kind has both fields (the `engineEvent` of events.ts); the event given is
// left as it was.
func Stamp(event contracts.EngineEvent, seq int, at time.Time) contracts.EngineEvent {
	value := reflect.ValueOf(event.Value())
	if !value.IsValid() {
		return event
	}
	stamped := reflect.New(value.Elem().Type())
	stamped.Elem().Set(value.Elem())
	stamped.Elem().FieldByName("Seq").SetInt(int64(seq))
	stamped.Elem().FieldByName("At").Set(reflect.ValueOf(at.UTC()))

	var out contracts.EngineEvent
	union := reflect.ValueOf(&out).Elem()
	for i := range union.NumField() {
		if union.Field(i).Type() == stamped.Type() {
			union.Field(i).Set(stamped)
		}
	}
	return out
}

// AnswerEvent is the `answer` a Run emits once it handed the Pilote's answer
// to its request: the options chosen, the text or the decision, for the
// Session's log to say what was answered.
func AnswerEvent(requestID string, answer Answer) contracts.EngineEvent {
	event := &contracts.EngineEventAnswer{Kind: contracts.EngineEventKindAnswer, RequestId: requestID}
	switch {
	case answer.Allow != nil:
		decision := contracts.EngineEventAnswerDecisionDeny
		if *answer.Allow {
			decision = contracts.EngineEventAnswerDecisionAllow
			if answer.ForSession {
				decision = contracts.EngineEventAnswerDecisionAllowSession
			}
		}
		event.Decision = &decision
	case len(answer.Options) > 0:
		event.Options = append([]string(nil), answer.Options...)
	default:
		text := answer.Text
		event.Text = &text
	}
	return contracts.EngineEvent{Answer: event}
}
