// Package update is the Runner's self-update (ADR 0004, RUNNER-8): a Runner
// the server no longer speaks to (`hello.rejected` `update-required`), or
// `crewdeck-runner update`, downloads `GET /runner/<version>/<os>-<arch>`
// and its `.sha256` from the server it is linked to, over HTTPS and without
// following any redirection, verifies the SHA-256, writes the new build next
// to the binary and renames it over it, atomically. A bad checksum keeps the old binary. The automatic
// attempts are at most one every ten minutes, across restarts.
package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// Every is the least time between two automatic attempts.
const Every = 10 * time.Minute

// stampFile, in Dir, holds the instant of the last automatic attempt.
const stampFile = "update.json"

// ErrChecksumMismatch: the build downloaded is not the one its .sha256 names.
var ErrChecksumMismatch = errors.New("update: the checksum of the build does not match")

// TooSoonError: an automatic attempt came less than Every after the last one.
type TooSoonError struct {
	Next time.Time
}

func (e *TooSoonError) Error() string {
	return fmt.Sprintf("update: the last attempt was less than %s ago, next at %s", Every, e.Next.Format(time.RFC3339))
}

// version is a version as the server names its builds (CREWDECK_COMMIT).
var version = regexp.MustCompile(`^[0-9A-Za-z._-]{1,64}$`)

// Updater updates the binary at Binary from Server.
type Updater struct {
	// Server is the server the Runner is linked to: the only source of its builds.
	Server string
	// Binary is the running binary's path, replaced by the new build.
	Binary string
	// OS and Arch name the build (runtime.GOOS, runtime.GOARCH).
	OS, Arch string
	// Dir is the Runner's folder (~/.crewdeck), where the last attempt is kept.
	Dir string
	// HTTP defaults to a client with a timeout of 5 min.
	HTTP *http.Client
	// Now defaults to time.Now.
	Now    func() time.Time
	Logger *slog.Logger

	// attempted is the last automatic attempt of this process, kept even
	// when it could not be written in Dir.
	attempted time.Time
}

func (u *Updater) now() time.Time {
	if u.Now == nil {
		return time.Now()
	}
	return u.Now()
}

// client follows no redirection: the builds, their checksums and the
// latest version come from the linked server itself, never from elsewhere.
func (u *Updater) client() *http.Client {
	client := http.Client{Timeout: 5 * time.Minute}
	if u.HTTP != nil {
		client = *u.HTTP
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &client
}

func (u *Updater) logger() *slog.Logger {
	if u.Logger == nil {
		return slog.Default()
	}
	return u.Logger
}

// Latest is the version the server serves (`GET /runner/latest`).
func (u *Updater) Latest(ctx context.Context) (string, error) {
	body, err := u.get(ctx, "/runner/latest", 1<<10)
	if err != nil {
		return "", err
	}
	defer body.Close()
	var latest contracts.RunnerLatest
	if err := json.NewDecoder(body).Decode(&latest); err != nil {
		return "", fmt.Errorf("update: decode /runner/latest: %w", err)
	}
	return latest.Version, nil
}

// Apply is an automatic update to `to` (the server's latest version when
// empty): a *TooSoonError less than Every after the last attempt, else
// Install. The attempt counts from its start, whatever fails after it,
// the version's lookup included.
func (u *Updater) Apply(ctx context.Context, to string) error {
	if next, ok := u.nextAttempt(); ok && u.now().Before(next) {
		return &TooSoonError{Next: next}
	}
	u.attempted = u.now().UTC()
	if err := u.stamp(); err != nil {
		// This process still waits; another one may try sooner.
		u.logger().Warn("update.stamp-failed", "error", err.Error())
	}
	if to == "" {
		latest, err := u.Latest(ctx)
		if err != nil {
			return err
		}
		to = latest
	}
	return u.Install(ctx, to)
}

// NextAttempt is the instant an automatic attempt may be made again.
func (u *Updater) NextAttempt() time.Time {
	next, _ := u.nextAttempt()
	return next
}

type stamp struct {
	AttemptedAt time.Time `json:"attemptedAt"`
}

func (u *Updater) nextAttempt() (time.Time, bool) {
	last := u.attempted
	if data, err := os.ReadFile(filepath.Join(u.Dir, stampFile)); err == nil {
		var kept stamp
		if json.Unmarshal(data, &kept) == nil && kept.AttemptedAt.After(last) {
			last = kept.AttemptedAt
		}
	}
	if last.IsZero() {
		return time.Time{}, false
	}
	return last.Add(Every), true
}

func (u *Updater) stamp() error {
	data, err := json.Marshal(stamp{AttemptedAt: u.attempted})
	if err != nil {
		return err
	}
	if err := os.MkdirAll(u.Dir, 0o700); err != nil {
		return fmt.Errorf("update: create %s: %w", u.Dir, err)
	}
	if err := os.WriteFile(filepath.Join(u.Dir, stampFile), data, 0o600); err != nil {
		return fmt.Errorf("update: write %s: %w", stampFile, err)
	}
	return nil
}

// Install downloads the build `to`, verifies it and puts it in place of
// Binary; the old binary stays on any failure. The Runner restarts on it
// afterwards (the caller's part).
func (u *Updater) Install(ctx context.Context, to string) error {
	if !version.MatchString(to) {
		return fmt.Errorf("update: %q is not a version", to)
	}
	if err := u.secure(); err != nil {
		return err
	}
	platform := u.OS + "-" + u.Arch
	want, err := u.checksum(ctx, "/runner/"+to+"/"+platform+".sha256")
	if err != nil {
		return err
	}
	tmp, got, err := u.download(ctx, "/runner/"+to+"/"+platform)
	if err != nil {
		return err
	}
	defer os.Remove(tmp) // gone once renamed
	if got != want {
		u.logger().Error("update.checksum-mismatch", "version", to, "platform", platform, "expected", want, "got", got)
		return ErrChecksumMismatch
	}
	if err := os.Rename(tmp, u.Binary); err != nil {
		return fmt.Errorf("update: replace %s: %w", u.Binary, err)
	}
	u.logger().Info("update.installed", "version", to, "platform", platform)
	return nil
}

// secure: the builds come over HTTPS, or from this machine (development, tests).
func (u *Updater) secure() error {
	server, err := url.Parse(u.Server)
	if err != nil {
		return fmt.Errorf("update: server %q: %w", u.Server, err)
	}
	if server.Scheme == "https" {
		return nil
	}
	if ip := net.ParseIP(server.Hostname()); server.Scheme == "http" && (server.Hostname() == "localhost" || (ip != nil && ip.IsLoopback())) {
		return nil
	}
	return fmt.Errorf("update: the server %s is not https: no update", u.Server)
}

func (u *Updater) checksum(ctx context.Context, path string) (string, error) {
	body, err := u.get(ctx, path, 1<<10)
	if err != nil {
		return "", err
	}
	defer body.Close()
	data, err := io.ReadAll(body)
	if err != nil {
		return "", fmt.Errorf("update: read %s: %w", path, err)
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 || len(fields[0]) != sha256.Size*2 {
		return "", fmt.Errorf("update: %s holds no SHA-256", path)
	}
	return strings.ToLower(fields[0]), nil
}

// download writes the build to a file next to Binary (the same file
// system, for the rename), mode 755, and gives its path and its SHA-256.
func (u *Updater) download(ctx context.Context, path string) (string, string, error) {
	body, err := u.get(ctx, path, 1<<30)
	if err != nil {
		return "", "", err
	}
	defer body.Close()
	tmp, err := os.CreateTemp(filepath.Dir(u.Binary), "."+filepath.Base(u.Binary)+".update-*")
	if err != nil {
		return "", "", fmt.Errorf("update: write next to %s: %w", u.Binary, err)
	}
	sum := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(tmp, sum), body)
	closeErr := tmp.Close()
	if err := errors.Join(copyErr, closeErr, os.Chmod(tmp.Name(), 0o755)); err != nil {
		os.Remove(tmp.Name())
		return "", "", fmt.Errorf("update: download %s: %w", path, err)
	}
	return tmp.Name(), hex.EncodeToString(sum.Sum(nil)), nil
}

type limited struct {
	io.Reader
	io.Closer
}

func (u *Updater) get(ctx context.Context, path string, limit int64) (io.ReadCloser, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(u.Server, "/")+path, nil)
	if err != nil {
		return nil, fmt.Errorf("update: %w", err)
	}
	response, err := u.client().Do(request)
	if err != nil {
		return nil, fmt.Errorf("update: GET %s: %w", path, err)
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, fmt.Errorf("update: GET %s: %d", path, response.StatusCode)
	}
	return limited{io.LimitReader(response.Body, limit), response.Body}, nil
}
