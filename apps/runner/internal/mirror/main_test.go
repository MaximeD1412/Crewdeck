package mirror

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/logging"
)

// logs is the Runner's log during every test of the package, at debug.
var (
	logs       syncBuffer
	testLogger *slog.Logger
)

type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// TestMain checks, once every test ran, that the log holds no title nor body
// of the fixtures (SEC-10), whichever tests ran.
func TestMain(m *testing.M) {
	os.Setenv(logging.LevelEnv, "debug")
	testLogger = logging.New(&logs)
	code := m.Run()
	if code == 0 {
		if err := leaks(logs.String()); err != nil {
			fmt.Fprintln(os.Stderr, err)
			code = 1
		}
	}
	os.Exit(code)
}

// contentFields are the fixtures' fields that hold what someone wrote.
var contentFields = map[string]bool{"title": true, "body": true, "message": true, "description": true}

// leaks says which of the fixtures' contents the log holds.
func leaks(log string) error {
	paths, _ := filepath.Glob("testdata/*/*.json")
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var fixture any
		if err := json.Unmarshal(data, &fixture); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		var leaked []string
		walk(fixture, func(key, value string) {
			if contentFields[key] && len(value) > 3 && strings.Contains(log, value) {
				leaked = append(leaked, value)
			}
		})
		if len(leaked) > 0 {
			return fmt.Errorf("the log holds the content of %s: %q", path, leaked)
		}
	}
	return nil
}

func walk(v any, visit func(key, value string)) {
	switch v := v.(type) {
	case map[string]any:
		for key, child := range v {
			if s, ok := child.(string); ok {
				visit(key, s)
			}
			walk(child, visit)
		}
	case []any:
		for _, child := range v {
			walk(child, visit)
		}
	}
}

func TestTheMirrorsLogNamesWhatItDidButNoneOfItsContent(t *testing.T) {
	var own syncBuffer
	fake := newFake(t, "testdata/graphql")
	m, _ := newMirror(t, fake)
	m.Logger = logging.New(&own)
	m.GitHub.Logger = m.Logger
	if _, err := m.Reconcile(context.Background(), "acme/atelier"); err != nil {
		t.Fatal(err)
	}
	log := own.String()
	for _, line := range []string{`"msg":"mirror reconcile"`, `"msg":"mirror object"`, `"msg":"github graphql"`} {
		if !strings.Contains(log, line) {
			t.Errorf("the log lacks %s:\n%s", line, log)
		}
	}
	if err := leaks(log); err != nil {
		t.Error(err)
	}
	if strings.Contains(log, "ghs_") {
		t.Error("the log holds the installation token")
	}
}
