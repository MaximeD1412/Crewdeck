package github

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

// AskpassSessionEnv names the Session whose token git's askpass, and the
// Session's gh shim, ask the Runner for (RUNNER-10).
const AskpassSessionEnv = "CREWDECK_ASKPASS_SESSION"

// OpSessionToken is runner.sock's op that gives a running Session's current
// token: kept in the Runner's memory only, renewed there.
const OpSessionToken = "session.github-token"

// SessionTokenRequest is OpSessionToken's request.
type SessionTokenRequest struct {
	SessionID string `json:"sessionId"`
}

// SessionTokenReply is OpSessionToken's reply.
type SessionTokenReply struct {
	Token string `json:"token"`
}

// AskpassUser is the user name of an installation token over HTTPS.
const AskpassUser = "x-access-token"

// GitEnv is what every git command of a Session runs with, the Runner's and
// the Moteur's: the Runner itself as git's askpass, for the Session, and no
// credential helper of the machine's (never the Pilote's own credentials),
// so that no credential is ever in a remote URL nor in a file.
func GitEnv(runner, home, sessionID string) []string {
	return append([]string{
		"GIT_ASKPASS=" + runner,
		AskpassSessionEnv + "=" + sessionID,
		state.HomeEnv + "=" + home,
	}, NoMachineCredentials()...)
}

// NoMachineCredentials is the part of GitEnv that keeps git from the
// machine's credentials: no credential helper, no prompt.
func NoMachineCredentials() []string {
	return []string{
		"GIT_TERMINAL_PROMPT=0",
		"GIT_CONFIG_COUNT=1",
		"GIT_CONFIG_KEY_0=credential.helper",
		"GIT_CONFIG_VALUE_0=",
	}
}

// IsAskpass says whether the Runner was started as git's askpass: the
// Session named, and git's one argument, its prompt.
func IsAskpass(args []string) bool {
	if os.Getenv(AskpassSessionEnv) == "" || len(args) != 1 {
		return false
	}
	return strings.HasPrefix(args[0], "Username") || strings.HasPrefix(args[0], "Password")
}

// Askpass is the answer to git's prompt: AskpassUser for the user name, the
// Session's current token for the password.
func Askpass(ctx context.Context, socket, sessionID, prompt string) (string, error) {
	if strings.HasPrefix(prompt, "Username") {
		return AskpassUser, nil
	}
	return SessionTokenOf(ctx, socket, sessionID)
}

// SessionTokenOf asks the running Runner for the Session's current token.
func SessionTokenOf(ctx context.Context, socket, sessionID string) (string, error) {
	var reply SessionTokenReply
	if err := localsock.Call(ctx, socket, OpSessionToken, SessionTokenRequest{SessionID: sessionID}, &reply); err != nil {
		return "", err
	}
	if reply.Token == "" {
		return "", errors.New("github: no token for the Session")
	}
	return reply.Token, nil
}

// RunAskpass is the Runner started as git's askpass: it prints the answer
// to prompt, and exits 1 without one (git then fails, prompting nothing).
func RunAskpass(prompt string, stdout, stderr io.Writer) int {
	home, err := state.Default()
	if err == nil {
		var answer string
		ctx, cancel := context.WithTimeout(context.Background(), localsock.Timeout)
		defer cancel()
		if answer, err = Askpass(ctx, filepath.Join(home.Dir, localsock.SocketName), os.Getenv(AskpassSessionEnv), prompt); err == nil {
			fmt.Fprintln(stdout, answer)
			return 0
		}
	}
	fmt.Fprintln(stderr, "crewdeck-runner: pas de jeton GitHub pour cette Session.")
	return 1
}
