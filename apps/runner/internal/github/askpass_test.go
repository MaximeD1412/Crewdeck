package github_test

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
)

// serveTokens serves runner.sock in home, giving "ghs_live" for the Session s-1 only.
func serveTokens(t *testing.T, home string) string {
	t.Helper()
	socket := filepath.Join(home, localsock.SocketName)
	sock := &localsock.Server{}
	sock.Handle(github.OpSessionToken, func(_ context.Context, raw json.RawMessage) (any, error) {
		var request github.SessionTokenRequest
		if err := json.Unmarshal(raw, &request); err != nil || request.SessionID != "s-1" {
			return nil, &localsock.Failed{Code: "not-found"}
		}
		return github.SessionTokenReply{Token: "ghs_live"}, nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = sock.Serve(ctx, socket)
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})
	for i := 0; i < 200; i++ {
		if _, err := github.SessionTokenOf(context.Background(), socket, "s-1"); err == nil {
			return socket
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("runner.sock does not answer")
	return ""
}

func TestTheAskpassAnswersXAccessTokenThenTheSessionsCurrentToken(t *testing.T) {
	socket := serveTokens(t, t.TempDir())
	ctx := context.Background()

	if user, err := github.Askpass(ctx, socket, "s-1", "Username for 'https://github.com': "); err != nil || user != "x-access-token" {
		t.Fatalf("user name %q, %v", user, err)
	}
	if password, err := github.Askpass(ctx, socket, "s-1", "Password for 'https://x-access-token@github.com': "); err != nil || password != "ghs_live" {
		t.Fatalf("password %q, %v", password, err)
	}
	if _, err := github.Askpass(ctx, socket, "s-2", "Password for 'https://github.com': "); err == nil {
		t.Fatal("a Session the Runner does not run got a token")
	}
}

func TestTheAskpassIsRecognisedByItsVariableAndGitsPrompt(t *testing.T) {
	t.Setenv(github.AskpassSessionEnv, "s-1")
	if !github.IsAskpass([]string{"Password for 'https://github.com': "}) {
		t.Fatal("git's prompt not taken for the askpass")
	}
	if github.IsAskpass([]string{"gh", "--", "pr", "list"}) || github.IsAskpass([]string{"status"}) {
		t.Fatal("a command taken for the askpass")
	}
	t.Setenv(github.AskpassSessionEnv, "")
	if github.IsAskpass([]string{"Password for 'https://github.com': "}) {
		t.Fatal("the askpass without its Session")
	}
}

func TestGitEnvGivesGitTheAskpassAndNoHelperOfTheMachine(t *testing.T) {
	env := strings.Join(github.GitEnv("/opt/crewdeck-runner", "/home/x/.crewdeck", "s-1"), "\n")
	for _, want := range []string{"GIT_ASKPASS=/opt/crewdeck-runner", "CREWDECK_ASKPASS_SESSION=s-1", "GIT_TERMINAL_PROMPT=0", "CREWDECK_HOME=/home/x/.crewdeck", "GIT_CONFIG_KEY_0=credential.helper", "GIT_CONFIG_VALUE_0="} {
		if !strings.Contains(env+"\n", want+"\n") {
			t.Errorf("env %q lacks %q", env, want)
		}
	}
}
