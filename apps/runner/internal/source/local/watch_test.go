package local_test

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
)

// server is a fake server: the reports it got, as it would decode them.
type server struct {
	mu       sync.Mutex
	messages []contracts.RunnerLocalChanged
	got      chan contracts.RunnerLocalChanged
}

func newServer() *server { return &server{got: make(chan contracts.RunnerLocalChanged, 100)} }

func (s *server) send(_ context.Context, m contracts.RunnerLocalChanged) error {
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	var back contracts.RunnerLocalChanged
	if err := json.Unmarshal(data, &back); err != nil {
		return err
	}
	s.mu.Lock()
	s.messages = append(s.messages, back)
	s.mu.Unlock()
	s.got <- back
	return nil
}

func (s *server) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.messages)
}

// next waits for a report matching ok, within d.
func (s *server) next(t *testing.T, d time.Duration, ok func(contracts.RunnerLocalChanged) bool) contracts.RunnerLocalChanged {
	t.Helper()
	deadline := time.After(d)
	for {
		select {
		case m := <-s.got:
			if ok(m) {
				return m
			}
		case <-deadline:
			t.Fatalf("no such report within %v (%d sent)", d, s.count())
			return contracts.RunnerLocalChanged{}
		}
	}
}

// quiet waits until no report came for d.
func (s *server) quiet(d time.Duration) {
	for {
		select {
		case <-s.got:
		case <-time.After(d):
			return
		}
	}
}

func holds(number int) func(contracts.RunnerLocalChanged) bool {
	return func(m contracts.RunnerLocalChanged) bool {
		for _, item := range m.Items {
			if item.Ticket != nil && item.Ticket.Number == number {
				return true
			}
		}
		return false
	}
}

func watch(t *testing.T, p *local.Project, cfg local.WatchConfig) *local.Watcher {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	w := local.Watch(p, cfg)
	done := make(chan struct{})
	go func() {
		defer close(done)
		w.Run(ctx)
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})
	return w
}

func TestWatchSendsATicketWrittenByHandWithinASecond(t *testing.T) {
	dir := folder(t, map[string]string{"tickets/7-courses.md": "---\nnumber: 7\ntitle: Courses\n---\n"})
	s := newServer()
	watch(t, open(t, dir).Project, local.WatchConfig{Send: s.send})
	s.next(t, 2*time.Second, holds(7)) // the scan at start
	s.quiet(300 * time.Millisecond)

	start := time.Now()
	write(t, dir, "tickets/12-x.md", "---\nnumber: 12\ntitle: Écrit à la main\n---\n")
	s.next(t, time.Second, holds(12))
	t.Logf("reported in %v", time.Since(start))
}

func TestWatchFollowsATicketsFolderCreatedAfterItStarted(t *testing.T) {
	dir := folder(t, map[string]string{"README.md": "Le projet\n"})
	s := newServer()
	watch(t, open(t, dir).Project, local.WatchConfig{Send: s.send})
	s.quiet(300 * time.Millisecond)
	write(t, dir, "tickets/12-x.md", "---\nnumber: 12\ntitle: Le premier\n---\n")
	s.next(t, time.Second, holds(12))
	write(t, dir, "tickets/13-y.md", "---\nnumber: 13\ntitle: Le second\n---\n")
	s.next(t, time.Second, holds(13))
}

func TestPollSendsATicketWrittenByHandWithinTwoSecondsAndAHalf(t *testing.T) {
	dir := folder(t, map[string]string{"tickets/7-courses.md": "---\nnumber: 7\ntitle: Courses\n---\n"})
	s := newServer()
	watch(t, open(t, dir).Project, local.WatchConfig{Send: s.send, Poll: true})
	s.next(t, 2*time.Second, holds(7))
	s.quiet(300 * time.Millisecond)

	write(t, dir, "tickets/12-x.md", "---\nnumber: 12\ntitle: Écrit à la main\n---\n")
	s.next(t, 2500*time.Millisecond, holds(12))
}

func TestPollIsHowAFolderOfAWindowsDriveIsFollowed(t *testing.T) {
	if !local.Polled("/mnt/c/Users/pilote/projet") || !local.Polled("/mnt/d") || local.Polled("/home/pilote/projet") || local.Polled("/mnt/wsl/projet") {
		t.Error("polled folders")
	}
}

func TestWatchSendsOneReportForTwoEditsWithinADebounce(t *testing.T) {
	dir := folder(t, map[string]string{"tickets/12-x.md": "---\nnumber: 12\ntitle: Un\n---\n"})
	s := newServer()
	watch(t, open(t, dir).Project, local.WatchConfig{Send: s.send})
	s.next(t, 2*time.Second, holds(12))
	s.quiet(300 * time.Millisecond)
	before := s.count()

	write(t, dir, "tickets/12-x.md", "---\nnumber: 12\ntitle: Deux\n---\n")
	time.Sleep(50 * time.Millisecond)
	write(t, dir, "tickets/12-x.md", "---\nnumber: 12\ntitle: Trois\n---\n")
	s.quiet(600 * time.Millisecond)
	if got := s.count() - before; got != 1 {
		t.Fatalf("%d reports for two edits within 100 ms", got)
	}
}

func TestWatchSendsNothingWhenAScanFindsNothingNew(t *testing.T) {
	dir := folder(t, map[string]string{"tickets/12-x.md": "---\nnumber: 12\ntitle: Un\n---\n"})
	s := newServer()
	watch(t, open(t, dir).Project, local.WatchConfig{Send: s.send, ScanEvery: 50 * time.Millisecond})
	s.next(t, 2*time.Second, holds(12))
	s.quiet(200 * time.Millisecond)
	before := s.count()
	time.Sleep(500 * time.Millisecond) // ten scans
	if got := s.count() - before; got != 0 {
		t.Fatalf("%d reports of scans that found nothing new", got)
	}
}

func TestWatchSendsEveryItemOnFull(t *testing.T) {
	dir := folder(t, map[string]string{"tickets/12-x.md": "---\nnumber: 12\ntitle: Un\n---\n"})
	s := newServer()
	w := watch(t, open(t, dir).Project, local.WatchConfig{Send: s.send})
	s.next(t, 2*time.Second, holds(12))
	w.Full() // the server accepted a connection
	m := s.next(t, time.Second, func(m contracts.RunnerLocalChanged) bool { return m.Full })
	if !holds(12)(m) {
		t.Errorf("full report %+v", m.Items)
	}
}

func TestWatchReportsTheRunnersOwnWrites(t *testing.T) {
	dir := folder(t, map[string]string{"tickets/12-x.md": "---\nnumber: 12\ntitle: Un\n---\n"})
	p := open(t, dir)
	s := newServer()
	watch(t, p.Project, local.WatchConfig{Send: s.send, Poll: true, PollEvery: time.Hour})
	s.next(t, 2*time.Second, holds(12))
	if _, err := p.SetTicketState(context.Background(), 12, source.TicketClosed, source.ReasonCompleted); err != nil {
		t.Fatal(err)
	}
	m := s.next(t, time.Second, holds(12))
	for _, item := range m.Items {
		if item.Ticket != nil && (item.Ticket.State != "closed" || item.Ticket.StateReason != "completed") {
			t.Errorf("ticket %+v", item.Ticket)
		}
	}
}

func TestWatchSaysWhenARefMoved(t *testing.T) {
	for _, poll := range []bool{false, true} {
		dir := folder(t, map[string]string{"README.md": "Le projet\n"})
		moved := make(chan string, 10)
		watch(t, open(t, dir).Project, local.WatchConfig{Send: newServer().send, Poll: poll, PollEvery: 200 * time.Millisecond, OnRefsMoved: func(id string) { moved <- id }})
		time.Sleep(300 * time.Millisecond)
		write(t, dir, "src/a.go", "package a\n")
		git(t, dir, "add", "-A")
		git(t, dir, "commit", "--quiet", "-m", "Un commit à la main")
		select {
		case id := <-moved:
			if id != projectID {
				t.Errorf("poll %v: moved %q", poll, id)
			}
		case <-time.After(2 * time.Second):
			t.Errorf("poll %v: no word of the ref that moved", poll)
		}
	}
}
