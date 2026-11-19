package local

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

// The Watcher's rhythms (ADR 0012, « Following the folder »).
const (
	DefaultDebounce  = 200 * time.Millisecond
	DefaultScanEvery = 60 * time.Second
	DefaultPollEvery = 2 * time.Second
)

// windowsDrive is a folder of a Windows drive seen from WSL: no inotify there (risk OPS-9).
var windowsDrive = regexp.MustCompile(`^/mnt/[a-zA-Z]/`)

// WatchConfig is how a Watcher follows its Projet.
type WatchConfig struct {
	// Send carries a report to the server (protocol.ErrNotConnected while offline).
	Send func(context.Context, contracts.RunnerLocalChanged) error
	// OnRefsMoved is called, after the debounce, when a branch's ref of the
	// folder moved (HEAD, refs/heads/, packed-refs): for the documentation
	// index and the changes merged by hand (SOURCE-5). Optional.
	OnRefsMoved func(projectID string)
	// Poll forces polling; a folder under /mnt/<letter>/ is always polled.
	Poll   bool
	Logger *slog.Logger
	// Zero is the default.
	Debounce, ScanEvery, PollEvery time.Duration
}

// Watcher follows a Local Projet's folder (SOURCE-3): fsnotify on
// `tickets/` and on the git refs, events debounced then a report; a scan at
// start and every ScanEvery for what fsnotify missed; a scan every
// PollEvery instead of fsnotify for a folder polled. Each write of the
// Runner itself (OnChange) is reported too, and Full asks for a report of
// every item (on each accepted connection).
type Watcher struct {
	p    *Project
	cfg  WatchConfig
	kick chan struct{}
	full chan struct{}
}

// Watch is p's Watcher; Run starts it.
func Watch(p *Project, cfg WatchConfig) *Watcher {
	if cfg.Debounce <= 0 {
		cfg.Debounce = DefaultDebounce
	}
	if cfg.ScanEvery <= 0 {
		cfg.ScanEvery = DefaultScanEvery
	}
	if cfg.PollEvery <= 0 {
		cfg.PollEvery = DefaultPollEvery
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.New(slog.DiscardHandler)
	}
	cfg.Poll = cfg.Poll || Polled(p.folder)
	w := &Watcher{p: p, cfg: cfg, kick: make(chan struct{}, 1), full: make(chan struct{}, 1)}
	p.OnChange(func(source.Changed) { signal(w.kick) })
	return w
}

// Polled says whether a folder is polled rather than watched: one of a
// Windows drive under WSL, where inotify sees nothing.
func Polled(folder string) bool { return windowsDrive.MatchString(filepath.ToSlash(folder) + "/") }

// Full asks for one report of every item, as soon as the Watcher runs.
func (w *Watcher) Full() { signal(w.full) }

func signal(c chan struct{}) {
	select {
	case c <- struct{}{}:
	default:
	}
}

// Run follows the folder until ctx ends.
func (w *Watcher) Run(ctx context.Context) {
	log := w.cfg.Logger.With("projectId", w.p.id)
	var events <-chan fsnotify.Event
	var errs <-chan error
	var fsw *fsnotify.Watcher
	if !w.cfg.Poll {
		var err error
		fsw, err = fsnotify.NewWatcher()
		if err != nil {
			log.Warn("local.watch.unavailable", "error", err)
			w.cfg.Poll = true
		} else {
			defer fsw.Close()
			events, errs = fsw.Events, fsw.Errors
		}
	}
	g := gitDirs(w.p.folder)
	if fsw != nil {
		w.add(fsw, w.p.folder)
		w.add(fsw, filepath.Join(w.p.folder, TicketsDir))
		w.add(fsw, g.dir)
		if g.common != g.dir {
			w.add(fsw, g.common)
		}
		w.addTree(fsw, filepath.Join(g.common, "refs", "heads"))
	}
	refs := g.fingerprint()

	scan := time.NewTicker(w.cfg.ScanEvery)
	defer scan.Stop()
	var poll <-chan time.Time
	if w.cfg.Poll {
		t := time.NewTicker(w.cfg.PollEvery)
		defer t.Stop()
		poll = t.C
	}
	debounce := time.NewTimer(time.Hour)
	debounce.Stop()
	pending, refsMoved := false, false
	wait := func() {
		if !pending {
			pending = true
			debounce.Reset(w.cfg.Debounce)
		}
	}

	// The scan at start, every item when a full report is asked already.
	full := false
	select {
	case <-w.full:
		full = true
	default:
	}
	w.report(ctx, log, full)
	for {
		select {
		case <-ctx.Done():
			return
		case <-w.full:
			w.report(ctx, log, true)
		case <-w.kick:
			wait()
		case <-scan.C:
			w.report(ctx, log, false)
		case <-poll:
			if now := g.fingerprint(); now != refs {
				refs = now
				w.refsMoved()
			}
			w.report(ctx, log, false)
		case err := <-errs:
			log.Warn("local.watch.error", "error", err)
		case e := <-events:
			switch kind := w.classify(g, e); kind {
			case eventTickets:
				if e.Has(fsnotify.Create) && filepath.Clean(e.Name) == filepath.Join(w.p.folder, TicketsDir) {
					w.add(fsw, e.Name)
				}
				wait()
			case eventRefs:
				if e.Has(fsnotify.Create) {
					if info, err := os.Stat(e.Name); err == nil && info.IsDir() {
						w.addTree(fsw, e.Name)
					}
				}
				refsMoved = true
				wait()
			}
		case <-debounce.C:
			pending = false
			if refsMoved {
				refsMoved = false
				refs = g.fingerprint()
				w.refsMoved()
			}
			w.report(ctx, log, false)
		}
	}
}

func (w *Watcher) refsMoved() {
	if w.cfg.OnRefsMoved != nil {
		w.cfg.OnRefsMoved(w.p.id)
	}
}

// report sends what changed; what a failed send carried goes again with the next one.
func (w *Watcher) report(ctx context.Context, log *slog.Logger, full bool) {
	// The scan of this report notifies what it found (OnChange): the report
	// that follows finds it reported, and sends nothing.
	_, err := w.p.Report(ctx, full, w.cfg.Send)
	switch {
	case err == nil, ctx.Err() != nil:
	case errors.Is(err, protocol.ErrNotConnected), errors.Is(err, ErrNoVault):
		log.Debug("local.report.later", "reason", err)
	default:
		log.Warn("local.report.failed", "error", err)
	}
}

func (w *Watcher) add(fsw *fsnotify.Watcher, dir string) {
	if fsw == nil {
		return
	}
	if err := fsw.Add(dir); err != nil && !errors.Is(err, fs.ErrNotExist) {
		w.cfg.Logger.Warn("local.watch.add", "projectId", w.p.id, "error", err)
	}
}

func (w *Watcher) addTree(fsw *fsnotify.Watcher, root string) {
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err == nil && d.IsDir() {
			w.add(fsw, path)
		}
		return nil
	})
}

type eventKind int

const (
	eventNone eventKind = iota
	eventTickets
	eventRefs
)

func (w *Watcher) classify(g gitDir, e fsnotify.Event) eventKind {
	name := filepath.Clean(e.Name)
	base := filepath.Base(name)
	if strings.HasSuffix(base, ".lock") || e.Op == fsnotify.Chmod {
		return eventNone
	}
	tickets := filepath.Join(w.p.folder, TicketsDir)
	switch dir := filepath.Dir(name); {
	case name == tickets || dir == tickets:
		return eventTickets
	case (dir == g.dir || dir == g.common) && (base == "HEAD" || base == "packed-refs"):
		return eventRefs
	case strings.HasPrefix(name, filepath.Join(g.common, "refs", "heads")+string(filepath.Separator)):
		return eventRefs
	}
	return eventNone
}

// gitDir is the folder's git directory and the one its refs are in (a
// worktree's `.git` is a file naming its own, its refs in the common one).
type gitDir struct{ dir, common string }

func gitDirs(folder string) gitDir {
	dir := filepath.Join(folder, ".git")
	if data, err := os.ReadFile(dir); err == nil {
		if path, ok := strings.CutPrefix(strings.TrimSpace(string(data)), "gitdir:"); ok {
			dir = absolute(folder, strings.TrimSpace(path))
		}
	}
	g := gitDir{dir: dir, common: dir}
	if data, err := os.ReadFile(filepath.Join(dir, "commondir")); err == nil {
		g.common = absolute(dir, strings.TrimSpace(string(data)))
	}
	return g
}

func absolute(base, path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Join(base, path)
}

// fingerprint is the refs' files as they are: their names, sizes and
// modification times, for a folder polled.
func (g gitDir) fingerprint() string {
	var parts []string
	stat := func(path string) {
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			parts = append(parts, path+"\x00"+strconv.FormatInt(info.Size(), 10)+"\x00"+strconv.FormatInt(info.ModTime().UnixNano(), 10))
		}
	}
	stat(filepath.Join(g.dir, "HEAD"))
	stat(filepath.Join(g.common, "packed-refs"))
	_ = filepath.WalkDir(filepath.Join(g.common, "refs", "heads"), func(path string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && !strings.HasSuffix(path, ".lock") {
			stat(path)
		}
		return nil
	})
	sort.Strings(parts)
	return strings.Join(parts, "\n")
}
