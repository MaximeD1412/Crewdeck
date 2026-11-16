package session

import (
	"reflect"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// seqOf is the seq of a normalised event, 0 for none.
func seqOf(event contracts.EngineEvent) int {
	value := reflect.ValueOf(event.Value())
	if !value.IsValid() || value.IsNil() {
		return 0
	}
	return int(value.Elem().FieldByName("Seq").Int())
}

// atOf is the instant of a normalised event.
func atOf(event contracts.EngineEvent) time.Time {
	value := reflect.ValueOf(event.Value())
	if !value.IsValid() || value.IsNil() {
		return time.Time{}
	}
	at, _ := value.Elem().FieldByName("At").Interface().(time.Time)
	return at
}
