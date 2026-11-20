package localsock_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
)

func serve(t *testing.T, s *localsock.Server) string {
	t.Helper()
	socket := filepath.Join(t.TempDir(), localsock.SocketName)
	ctx, cancel := context.WithCancel(context.Background())
	served := make(chan error, 1)
	go func() { served <- s.Serve(ctx, socket) }()
	t.Cleanup(func() {
		cancel()
		if err := <-served; err != nil {
			t.Errorf("Serve after its context: %v", err)
		}
	})
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(socket); err == nil {
			return socket
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("no socket")
	return ""
}

type unavailable struct{}

func (unavailable) Error() string { return "the folder is gone" }
func (unavailable) Code() string  { return "unavailable" }

func TestLocalSockLocalOpsAnswerByOpWithinTheirTimeout(t *testing.T) {
	s := &localsock.Server{DefaultOp: "accounts.refresh", Timeout: 50 * time.Millisecond}
	s.Handle("accounts.refresh", func(context.Context, json.RawMessage) (any, error) {
		return map[string]any{"engines": []string{"codex"}}, nil
	})
	s.Handle("mirror.fetch", func(_ context.Context, request json.RawMessage) (any, error) {
		var r struct {
			Repository string `json:"repository"`
			Number     int    `json:"number"`
		}
		_ = json.Unmarshal(request, &r)
		if r.Number == 0 {
			return nil, unavailable{}
		}
		return map[string]any{"repository": r.Repository, "number": r.Number}, nil
	})
	s.Handle("mirror.sync", func(ctx context.Context, _ json.RawMessage) (any, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	})
	socket := serve(t, s)
	if info, err := os.Stat(socket); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("socket %v, %v: want mode 600", info, err)
	}
	ctx := context.Background()

	var fetched struct {
		OK         bool   `json:"ok"`
		Repository string `json:"repository"`
		Number     int    `json:"number"`
	}
	if err := localsock.Call(ctx, socket, "mirror.fetch", map[string]any{"repository": "acme/atelier", "number": 38}, &fetched); err != nil {
		t.Fatal(err)
	}
	if !fetched.OK || fetched.Repository != "acme/atelier" || fetched.Number != 38 {
		t.Fatalf("reply %+v", fetched)
	}
	var failed *localsock.Failed
	if err := localsock.Call(ctx, socket, "mirror.fetch", map[string]any{"repository": "acme/atelier"}, nil); !errors.As(err, &failed) || failed.Code != "unavailable" {
		t.Fatalf("a coded error: %v", err)
	}
	if err := localsock.Call(ctx, socket, "mirror.sync", nil, nil); !errors.As(err, &failed) || failed.Code != localsock.CodeTimeout {
		t.Fatalf("a slow op: %v", err)
	}
	if err := localsock.Call(ctx, socket, "mirror.nothing", nil, nil); !errors.As(err, &failed) || failed.Code != localsock.CodeUnknownOp {
		t.Fatalf("an unknown op: %v", err)
	}
	// A request without op, as login sent it before the socket had ops.
	line, err := localsock.RawCall(ctx, socket, []byte(`{"refresh":true}`))
	if err != nil || string(line) != `{"engines":["codex"],"ok":true}`+"\n" {
		t.Fatalf("the default op: %s, %v", line, err)
	}
}

func TestLocalSockCallWithoutARunnerIsErrNoRunner(t *testing.T) {
	socket := filepath.Join(t.TempDir(), localsock.SocketName)
	if err := localsock.Call(context.Background(), socket, "mirror.state", nil, nil); !errors.Is(err, localsock.ErrNoRunner) {
		t.Fatalf("Call = %v", err)
	}
	if err := os.WriteFile(socket, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := localsock.Call(context.Background(), socket, "mirror.state", nil, nil); !errors.Is(err, localsock.ErrNoRunner) {
		t.Fatalf("Call on a stale socket = %v", err)
	}
}

type refused struct{ rules []string }

func (refused) Error() string  { return "the report fails its Contrat" }
func (refused) Code() string   { return "contract-failed" }
func (r refused) Details() any { return map[string]any{"failedRuleIds": r.rules} }

// A Detailed error's reply holds its details beside its code, which Call
// gives back in Failed.
func TestADetailedErrorsReplyGivesItsDetailsToTheCaller(t *testing.T) {
	s := &localsock.Server{}
	s.Handle("step.report", func(context.Context, json.RawMessage) (any, error) {
		return nil, refused{rules: []string{"idea-analysis.report.schema"}}
	})
	s.Handle("step.start", func(context.Context, json.RawMessage) (any, error) {
		return nil, unavailable{}
	})
	socket := serve(t, s)

	err := localsock.Call(context.Background(), socket, "step.report", nil, nil)
	var failed *localsock.Failed
	if !errors.As(err, &failed) || failed.Code != "contract-failed" || string(failed.Details) != `{"failedRuleIds":["idea-analysis.report.schema"]}` {
		t.Fatalf("%v (%+v), want contract-failed with its rules", err, failed)
	}
	err = localsock.Call(context.Background(), socket, "step.start", nil, nil)
	if !errors.As(err, &failed) || failed.Code != "unavailable" || failed.Details != nil {
		t.Fatalf("%v (%+v), want unavailable without details", err, failed)
	}
}
