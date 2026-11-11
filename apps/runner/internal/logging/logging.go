// Package logging is the Runner's log (ADR 0004, RUNNER-8): JSON lines on
// stderr, which the service's journal (or launchd's log file) keeps, levels
// info and above unless CREWDECK_LOG=debug. It never holds a Session's
// content: a Moteur's event is logged by its kind and seq only, and the
// attributes that could carry a text, a message or a key are redacted
// whatever their value.
package logging

import (
	"io"
	"log/slog"
	"os"
	"reflect"
	"strings"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// LevelEnv set to `debug` adds the debug lines.
const LevelEnv = "CREWDECK_LOG"

// Redacted replaces the value of an attribute that may hold content.
const Redacted = "[redacted]"

// contentKeys are the attributes whose value is never written: what the
// Pilote, an agent or a Moteur wrote, and the credentials.
var contentKeys = map[string]bool{
	"text": true, "content": true, "prompt": true, "message": true, "messages": true,
	"input": true, "output": true, "raw": true, "body": true, "answer": true,
	"title": true, "detail": true, "target": true, "options": true, "diff": true,
	"key": true, "apikey": true, "token": true, "secret": true, "password": true,
}

// New is the Runner's logger, writing to w.
func New(w io.Writer) *slog.Logger {
	level := slog.LevelInfo
	if strings.EqualFold(os.Getenv(LevelEnv), "debug") {
		level = slog.LevelDebug
	}
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: level, ReplaceAttr: redact}))
}

func redact(_ []string, a slog.Attr) slog.Attr {
	if contentKeys[strings.ToLower(a.Key)] {
		return slog.String(a.Key, Redacted)
	}
	if a.Value.Kind() != slog.KindAny {
		return a
	}
	switch v := a.Value.Any().(type) {
	case contracts.EngineEvent:
		return slog.Group(a.Key, eventAttrs(v)...)
	case *contracts.EngineEvent:
		if v != nil {
			return slog.Group(a.Key, eventAttrs(*v)...)
		}
	}
	// Any other struct or map may hold content: only its type is written.
	switch reflect.Indirect(reflect.ValueOf(a.Value.Any())).Kind() {
	case reflect.Struct, reflect.Map, reflect.Slice, reflect.Array:
		if _, isError := a.Value.Any().(error); !isError {
			return slog.String(a.Key, Redacted)
		}
	}
	return a
}

func eventAttrs(event contracts.EngineEvent) []any {
	attrs := []any{slog.String("kind", event.Kind())}
	if value := reflect.ValueOf(event.Value()); value.IsValid() && !value.IsNil() {
		attrs = append(attrs, slog.Int64("seq", value.Elem().FieldByName("Seq").Int()))
	}
	return attrs
}

// Event logs a Moteur's event, at debug: its kind and seq, nothing of what it says.
func Event(logger *slog.Logger, event contracts.EngineEvent) {
	logger.Debug("engine event", eventAttrs(event)...)
}
