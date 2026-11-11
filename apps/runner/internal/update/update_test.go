package update

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// release serves a version's binary for linux-amd64, its .sha256 (sum, when
// set, in place of the right one) and /runner/latest.
type release struct {
	version string
	binary  []byte
	sum     string
	hits    atomic.Int32
}

func (r *release) serve(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/runner/latest":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"version":"` + r.version + `"}`))
		case "/runner/" + r.version + "/linux-amd64":
			r.hits.Add(1)
			w.Write(r.binary)
		case "/runner/" + r.version + "/linux-amd64.sha256":
			sum := r.sum
			if sum == "" {
				digest := sha256.Sum256(r.binary)
				sum = hex.EncodeToString(digest[:])
			}
			w.Write([]byte(sum + "  linux-amd64\n"))
		default:
			http.NotFound(w, req)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

type fixture struct {
	updater *Updater
	binary  string
	log     *bytes.Buffer
	now     time.Time
}

func newFixture(t *testing.T, server string) *fixture {
	t.Helper()
	dir := t.TempDir()
	binary := filepath.Join(dir, "bin", "crewdeck-runner")
	if err := os.MkdirAll(filepath.Dir(binary), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(binary, []byte("old build"), 0o755); err != nil {
		t.Fatal(err)
	}
	f := &fixture{binary: binary, log: &bytes.Buffer{}, now: time.Date(2026, 11, 11, 9, 0, 0, 0, time.UTC)}
	f.updater = &Updater{
		Server: server,
		Binary: binary,
		OS:     "linux",
		Arch:   "amd64",
		Dir:    filepath.Join(dir, "crewdeck"),
		Now:    func() time.Time { return f.now },
		Logger: slog.New(slog.NewJSONHandler(f.log, nil)),
	}
	return f
}

func (f *fixture) installed(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(f.binary)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestLatestIsTheVersionTheServerServes(t *testing.T) {
	srv := (&release{version: "abc1234"}).serve(t)
	got, err := newFixture(t, srv.URL).updater.Latest(context.Background())
	if err != nil || got != "abc1234" {
		t.Fatalf("latest = %q, %v", got, err)
	}
}

func TestApplyDownloadsVerifiesAndReplacesTheBinary(t *testing.T) {
	rel := &release{version: "v2", binary: []byte("new build")}
	f := newFixture(t, rel.serve(t).URL)

	if err := f.updater.Apply(context.Background(), "v2"); err != nil {
		t.Fatal(err)
	}
	if got := f.installed(t); got != "new build" {
		t.Fatalf("the binary is %q", got)
	}
	info, _ := os.Stat(f.binary)
	if info.Mode().Perm() != 0o755 {
		t.Fatalf("mode %v", info.Mode())
	}
	entries, _ := os.ReadDir(filepath.Dir(f.binary))
	if len(entries) != 1 {
		t.Fatalf("left beside the binary: %v", entries)
	}
	if !strings.Contains(f.log.String(), `"msg":"update.installed"`) {
		t.Fatalf("log:\n%s", f.log)
	}
}

func TestABadChecksumKeepsTheOldBinary(t *testing.T) {
	rel := &release{version: "v2", binary: []byte("tampered build"), sum: strings.Repeat("0", 64)}
	f := newFixture(t, rel.serve(t).URL)

	err := f.updater.Apply(context.Background(), "v2")
	if !errors.Is(err, ErrChecksumMismatch) {
		t.Fatalf("err = %v", err)
	}
	if got := f.installed(t); got != "old build" {
		t.Fatalf("the binary is %q", got)
	}
	entries, _ := os.ReadDir(filepath.Dir(f.binary))
	if len(entries) != 1 {
		t.Fatalf("left beside the binary: %v", entries)
	}
	if !strings.Contains(f.log.String(), `"msg":"update.checksum-mismatch"`) {
		t.Fatalf("log:\n%s", f.log)
	}
}

func TestAtMostOneAttemptEveryTenMinutes(t *testing.T) {
	rel := &release{version: "v2", binary: []byte("tampered"), sum: strings.Repeat("0", 64)}
	f := newFixture(t, rel.serve(t).URL)

	if err := f.updater.Apply(context.Background(), "v2"); !errors.Is(err, ErrChecksumMismatch) {
		t.Fatalf("first attempt: %v", err)
	}
	f.now = f.now.Add(9 * time.Minute)
	var soon *TooSoonError
	if err := f.updater.Apply(context.Background(), "v2"); !errors.As(err, &soon) || !soon.Next.Equal(f.now.Add(time.Minute)) {
		t.Fatalf("second attempt: %v", err)
	}
	if rel.hits.Load() != 1 {
		t.Fatalf("downloads: %d", rel.hits.Load())
	}
	// The window holds across a restart of the Runner: a new Updater on the same folder.
	again := *f.updater
	if err := again.Apply(context.Background(), "v2"); !errors.As(err, &soon) {
		t.Fatalf("after a restart: %v", err)
	}
	f.now = f.now.Add(time.Minute)
	if err := f.updater.Apply(context.Background(), "v2"); !errors.Is(err, ErrChecksumMismatch) {
		t.Fatalf("ten minutes later: %v", err)
	}
	// Install, the Pilote's own `crewdeck-runner update`, does not wait.
	rel.sum = ""
	rel.binary = []byte("new build")
	if err := f.updater.Install(context.Background(), "v2"); err != nil || f.installed(t) != "new build" {
		t.Fatalf("install: %v, binary %q", err, f.installed(t))
	}
}

func TestUpdatesComeOnlyOverHTTPSOrFromThisMachine(t *testing.T) {
	f := newFixture(t, "http://crewdeck.example")
	if err := f.updater.Install(context.Background(), "v2"); err == nil || !strings.Contains(err.Error(), "https") {
		t.Fatalf("err = %v", err)
	}
	if f.installed(t) != "old build" {
		t.Fatal("the binary changed")
	}
}

func TestAVersionThatIsNotOneIsRefusedBeforeAnyDownload(t *testing.T) {
	rel := &release{version: "v2", binary: []byte("x")}
	f := newFixture(t, rel.serve(t).URL)
	for _, v := range []string{"", "../etc", "v2/linux-amd64"} {
		if err := f.updater.Install(context.Background(), v); err == nil {
			t.Errorf("version %q accepted", v)
		}
	}
	if rel.hits.Load() != 0 {
		t.Fatalf("downloads: %d", rel.hits.Load())
	}
}

func TestAMissingBuildKeepsTheOldBinary(t *testing.T) {
	f := newFixture(t, (&release{version: "v2"}).serve(t).URL)
	if err := f.updater.Install(context.Background(), "v3"); err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("err = %v", err)
	}
	if f.installed(t) != "old build" {
		t.Fatal("the binary changed")
	}
}

func TestRedirectionsAreNotFollowed(t *testing.T) {
	other := &release{version: "v2", binary: []byte("build of elsewhere")}
	elsewhere := other.serve(t)
	linked := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		http.Redirect(w, req, elsewhere.URL+req.URL.Path, http.StatusFound)
	}))
	t.Cleanup(linked.Close)
	f := newFixture(t, linked.URL)

	if err := f.updater.Install(context.Background(), "v2"); err == nil {
		t.Fatal("an update through a redirection was installed")
	}
	if _, err := f.updater.Latest(context.Background()); err == nil {
		t.Fatal("the latest version was read through a redirection")
	}
	if f.installed(t) != "old build" || other.hits.Load() != 0 {
		t.Fatalf("binary %q, downloads elsewhere %d", f.installed(t), other.hits.Load())
	}
}

func TestAnAttemptWithoutAVersionWaitsTenMinutesWhenTheServerFails(t *testing.T) {
	unavailable := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(unavailable.Close)
	f := newFixture(t, unavailable.URL)

	if err := f.updater.Apply(context.Background(), ""); err == nil || !strings.Contains(err.Error(), "503") {
		t.Fatalf("attempt without a version: %v", err)
	}
	if next := f.updater.NextAttempt(); !next.Equal(f.now.Add(Every)) {
		t.Fatalf("next attempt at %v, want %v", next, f.now.Add(Every))
	}
	var soon *TooSoonError
	if err := f.updater.Apply(context.Background(), ""); !errors.As(err, &soon) {
		t.Fatalf("second attempt: %v", err)
	}
}

func TestAnAttemptThatCannotBeKeptStillWaitsTenMinutes(t *testing.T) {
	rel := &release{version: "v2", binary: []byte("tampered"), sum: strings.Repeat("0", 64)}
	f := newFixture(t, rel.serve(t).URL)
	// Dir is a file: the instant of the attempt cannot be written.
	if err := os.WriteFile(f.updater.Dir, []byte("not a folder"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := f.updater.Apply(context.Background(), "v2"); !errors.Is(err, ErrChecksumMismatch) {
		t.Fatalf("attempt: %v", err)
	}
	if next := f.updater.NextAttempt(); !next.Equal(f.now.Add(Every)) {
		t.Fatalf("next attempt at %v, want %v", next, f.now.Add(Every))
	}
	var soon *TooSoonError
	if err := f.updater.Apply(context.Background(), "v2"); !errors.As(err, &soon) {
		t.Fatalf("second attempt: %v", err)
	}
}
