package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/service"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

const (
	secret   = "M2PXA7QK9VZ3T8W4R6N1B5C0DE"
	code     = "7KQ4-" + secret
	linkID   = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01"
	runnerID = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02"
)

// fakeLink is the server's side of the link: it records every request and
// answers the polls from a script.
type fakeLink struct {
	mu       sync.Mutex
	requests []string
	link     func(w http.ResponseWriter, body []byte)
	polls    []string
}

func (f *fakeLink) handler(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.requests = append(f.requests, r.Method+" "+r.URL.String()+" "+string(body))
		f.mu.Unlock()
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/runner/link":
			if f.link != nil {
				f.link(w, body)
				return
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = io.WriteString(w, `{"linkId":"`+linkID+`","browserPairing":{}}`)
		case r.Method == http.MethodPost && r.URL.Path == "/api/runner/link/"+linkID+"/pairing":
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodGet && r.URL.Path == "/api/runner/link/"+linkID:
			f.mu.Lock()
			answer := `{"state":"pending"}`
			if len(f.polls) > 0 {
				answer, f.polls = f.polls[0], f.polls[1:]
			}
			f.mu.Unlock()
			_, _ = io.WriteString(w, answer)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL)
			http.NotFound(w, r)
		}
	})
}

func refusing(status int, errorCode string) func(http.ResponseWriter, []byte) {
	return func(w http.ResponseWriter, _ []byte) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, `{"status":`+itoa(status)+`,"code":"`+errorCode+`","message":"refusé"}`)
	}
}

func itoa(n int) string {
	data, _ := json.Marshal(n)
	return string(data)
}

const linkedAnswer = `{"state":"linked","runnerId":"` + runnerID + `","token":"rnr_token","pairing":{}}`

type harness struct {
	linker    *linker
	out       *bytes.Buffer
	home      string
	installed int
}

func newHarness(t *testing.T, server string, found ...string) *harness {
	h := &harness{out: &bytes.Buffer{}, home: t.TempDir()}
	h.linker = &linker{
		server: server,
		http:   &http.Client{Timeout: time.Second},
		tries:  3,
		retry:  time.Millisecond,
		poll:   time.Millisecond,
		window: time.Minute,
		lookPath: func(name string) (string, error) {
			for _, f := range found {
				if f == name {
					return "/usr/bin/" + name, nil
				}
			}
			return "", errors.New("not found")
		},
		describe: func() (protocol.Machine, error) {
			return protocol.Machine{RunnerVersion: "0.4.2", Machine: "atelier-pc", OS: contracts.RunnerHelloOsLinux, Arch: contracts.RunnerHelloArchAmd64, WSL: true}, nil
		},
		store: state.Store{Dir: h.home},
		install: func(context.Context) (service.Outcome, error) {
			h.installed++
			return service.Outcome{Started: true}, nil
		},
		out: h.out,
	}
	return h
}

func TestLinkSendsTheShortIdAndTheMachineThenSavesTheTokenOnceThePageConfirmed(t *testing.T) {
	fake := &fakeLink{polls: []string{`{"state":"pending"}`, `{"state":"pending"}`, linkedAnswer}}
	srv := httptest.NewServer(fake.handler(t))
	t.Cleanup(srv.Close)
	h := newHarness(t, srv.URL, "claude")

	if err := h.linker.link(context.Background(), strings.ToLower(code)); err != nil {
		t.Fatalf("link: %v", err)
	}

	var sent contracts.RunnerLinkRequest
	if err := json.Unmarshal([]byte(strings.SplitN(fake.requests[0], " ", 3)[2]), &sent); err != nil {
		t.Fatal(err)
	}
	want := contracts.RunnerLinkRequest{ShortId: "7KQ4", Machine: "atelier-pc", Os: "linux", Arch: "amd64", Wsl: true, RunnerVersion: "0.4.2", Engines: []string{"claude"}}
	if sent.ShortId != want.ShortId || sent.Machine != want.Machine || sent.Os != want.Os || sent.Arch != want.Arch || !sent.Wsl || sent.RunnerVersion != want.RunnerVersion || strings.Join(sent.Engines, ",") != "claude" {
		t.Fatalf("sent %+v", sent)
	}
	if fake.requests[1] != "POST /api/runner/link/"+linkID+"/pairing "+`{"pairing":{}}` {
		t.Fatalf("pairing request %q", fake.requests[1])
	}
	if len(fake.requests) != 5 {
		t.Fatalf("%d requests: %v", len(fake.requests), fake.requests)
	}
	for _, request := range fake.requests {
		if strings.Contains(strings.ToUpper(request), secret) {
			t.Fatalf("the secret reached the server: %s", request)
		}
	}

	saved, err := h.linker.store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if saved != (state.State{Server: srv.URL, RunnerID: runnerID, Token: "rnr_token"}) {
		t.Fatalf("runner.json %+v", saved)
	}
	info, err := os.Stat(h.linker.store.Path())
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("runner.json mode %v (%v)", info.Mode().Perm(), err)
	}
	if h.installed != 1 {
		t.Fatalf("service installed %d times", h.installed)
	}
	if !strings.Contains(h.out.String(), "Runner relié à ton compte.") {
		t.Fatalf("out %q", h.out.String())
	}
}

func TestEveryFailureSaysItsReasonInFrenchAndTheCommandAgain(t *testing.T) {
	cases := []struct {
		name  string
		fake  *fakeLink
		found []string
		want  string
	}{
		{"unknown", &fakeLink{link: refusing(404, "runner.link-code-unknown")}, []string{"claude"}, "n’existe pas"},
		{"expired", &fakeLink{link: refusing(422, "runner.link-code-expired")}, []string{"claude"}, "a expiré"},
		{"already-used", &fakeLink{link: refusing(422, "runner.link-code-used")}, []string{"codex"}, "a déjà servi"},
		{"no-engine", &fakeLink{link: refusing(422, "runner.no-engine")}, nil, "Aucun Moteur trouvé"},
		{"expired while waiting", &fakeLink{polls: []string{`{"state":"failed","reason":"expired"}`}}, []string{"claude"}, "a expiré"},
		{"used by another machine", &fakeLink{polls: []string{`{"state":"failed","reason":"already-used"}`}}, []string{"claude"}, "a déjà servi"},
		{"token already handed", &fakeLink{polls: []string{`{"state":"linked","runnerId":"` + runnerID + `","pairing":{}}`}}, []string{"claude"}, "déjà été remis"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv := httptest.NewServer(c.fake.handler(t))
			t.Cleanup(srv.Close)
			h := newHarness(t, srv.URL, c.found...)

			err := h.linker.link(context.Background(), code)
			if err == nil {
				t.Fatal("link succeeded")
			}
			for _, part := range []string{"La liaison a échoué.", c.want, "curl -fsSL " + srv.URL + "/runner/install.sh | sh -s -- --link <nouveau code>"} {
				if !strings.Contains(err.Error(), part) {
					t.Errorf("message %q lacks %q", err, part)
				}
			}
			if _, err := h.linker.store.Load(); !errors.Is(err, state.ErrNotLinked) {
				t.Errorf("runner.json written: %v", err)
			}
			if h.installed != 0 {
				t.Error("service installed")
			}
		})
	}
}

func TestNoEngineSendsAnEmptyListForTheServerToFailTheCode(t *testing.T) {
	var sent contracts.RunnerLinkRequest
	fake := &fakeLink{link: func(w http.ResponseWriter, body []byte) {
		_ = json.Unmarshal(body, &sent)
		refusing(422, "runner.no-engine")(w, body)
	}}
	srv := httptest.NewServer(fake.handler(t))
	t.Cleanup(srv.Close)

	_ = newHarness(t, srv.URL).linker.link(context.Background(), code)
	if sent.Engines == nil || len(sent.Engines) != 0 {
		t.Fatalf("engines %#v", sent.Engines)
	}
}

func TestAMalformedCodeIsUnknownWithoutAskingTheServer(t *testing.T) {
	fake := &fakeLink{}
	srv := httptest.NewServer(fake.handler(t))
	t.Cleanup(srv.Close)

	err := newHarness(t, srv.URL, "claude").linker.link(context.Background(), "7KQ4-M2PX")
	if err == nil || !strings.Contains(err.Error(), "n’existe pas") || len(fake.requests) != 0 {
		t.Fatalf("err %v, requests %v", err, fake.requests)
	}
}

func TestAServerThatDoesNotAnswerIsUnreachableAfterThreeTries(t *testing.T) {
	var tries int
	var mu sync.Mutex
	block := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		tries++
		mu.Unlock()
		select {
		case <-block:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(func() { close(block); srv.Close() })
	h := newHarness(t, srv.URL, "claude")
	h.linker.http.Timeout = 20 * time.Millisecond

	err := h.linker.link(context.Background(), code)
	if err == nil || !strings.Contains(err.Error(), "ne répond pas (3 essais de 10 s)") {
		t.Fatalf("err %v", err)
	}
	// The code may still be good: the command keeps it.
	if !strings.Contains(err.Error(), "--link "+code) {
		t.Fatalf("message %q lacks the code", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if tries != 3 {
		t.Fatalf("%d tries", tries)
	}
}

func TestAServerThatRefusesConnectionsIsUnreachable(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	srv.Close()

	err := newHarness(t, srv.URL, "claude").linker.link(context.Background(), code)
	if err == nil || !strings.Contains(err.Error(), "ne répond pas") {
		t.Fatalf("err %v", err)
	}
}

func TestAServiceThatDoesNotStartLeavesTheRunnerLinkedAndSaysToRunItInTheForeground(t *testing.T) {
	srv := httptest.NewServer((&fakeLink{polls: []string{linkedAnswer}}).handler(t))
	t.Cleanup(srv.Close)
	h := newHarness(t, srv.URL, "claude")
	h.linker.install = func(context.Context) (service.Outcome, error) {
		return service.Outcome{}, errors.New("systemctl --user enable --now crewdeck-runner.service: Failed to connect to bus")
	}

	err := h.linker.link(context.Background(), code)
	if err == nil || !strings.Contains(err.Error(), "crewdeck-runner run") {
		t.Fatalf("err %v", err)
	}
	if _, err := h.linker.store.Load(); err != nil {
		t.Fatalf("runner.json: %v", err)
	}
	if !strings.Contains(h.out.String(), "Runner relié à ton compte.") {
		t.Fatalf("out %q", h.out.String())
	}
}

func TestTheServiceHelpIsPrintedWhenSystemdIsOff(t *testing.T) {
	srv := httptest.NewServer((&fakeLink{polls: []string{linkedAnswer}}).handler(t))
	t.Cleanup(srv.Close)
	h := newHarness(t, srv.URL, "claude")
	h.linker.install = func(context.Context) (service.Outcome, error) {
		return service.Outcome{Help: service.WSLHelp}, nil
	}

	if err := h.linker.link(context.Background(), code); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(h.out.String(), "systemd=true") {
		t.Fatalf("out %q", h.out.String())
	}
}

func TestTheLinkCommandTakesItsServerFromTheFlag(t *testing.T) {
	srv := httptest.NewServer((&fakeLink{polls: []string{linkedAnswer}}).handler(t))
	t.Cleanup(srv.Close)
	home := t.TempDir()
	t.Setenv(state.HomeEnv, home)
	// The Moteurs: one fake claude on PATH.
	bin := t.TempDir()
	if err := os.WriteFile(bin+"/claude", []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)

	var out bytes.Buffer
	root := newRootCommand()
	root.SetOut(&out)
	root.SetArgs([]string{"link", code, "--server", srv.URL + "/", "--no-service"})
	if err := root.Execute(); err != nil {
		t.Fatalf("link: %v", err)
	}
	saved, err := (state.Store{Dir: home}).Load()
	if err != nil || saved.Server != srv.URL {
		t.Fatalf("runner.json %+v (%v)", saved, err)
	}
	if !strings.Contains(out.String(), "Runner relié à ton compte.") || !strings.Contains(out.String(), "crewdeck-runner run") {
		t.Fatalf("out %q", out.String())
	}
}

func TestTheLinkCommandAsksForAServerWhenItKnowsNone(t *testing.T) {
	t.Setenv(state.HomeEnv, t.TempDir())
	root := newRootCommand()
	root.SetArgs([]string{"link", code})
	if err := root.Execute(); err == nil || !strings.Contains(err.Error(), "--server") {
		t.Fatalf("err %v", err)
	}
}
