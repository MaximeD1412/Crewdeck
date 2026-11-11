// Package control is the one channel between Claude Code's side of a Session
// and its adapter (RUNNER-5): the permission tool (`crewdeck-runner mcp
// permission`) and the question hook (`crewdeck-runner hook pre-tool-use`),
// which Claude runs, each send a Request over the Session's control socket
// (`~/.crewdeck/sessions/<id>/control.sock`, mode 600) and wait, without
// timeout, for the Reply the adapter writes once the Pilote answered. One
// connection per request, one JSON line each way.
package control

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"path/filepath"

	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

// SocketName is the control socket's file in the Session's folder.
const SocketName = "control.sock"

// Kind says what a Request asks.
type Kind string

const (
	// Permission asks whether a tool call may run.
	Permission Kind = "permission"
	// Question asks the questions of an `AskUserQuestion`.
	Question Kind = "question"
)

// Request is what Claude's side asks: the tool, its call's id and its input
// as Claude gave them.
type Request struct {
	Kind      Kind            `json:"kind"`
	ToolName  string          `json:"toolName"`
	ToolUseID string          `json:"toolUseId,omitempty"`
	Input     json.RawMessage `json:"input"`
}

// Reply is the Pilote's answer: Allow and, refused, Message for a
// permission; Answers, each question's text to its answer, for a question.
type Reply struct {
	Allow   bool              `json:"allow"`
	Message string            `json:"message,omitempty"`
	Answers map[string]string `json:"answers,omitempty"`
}

// SocketPath is the control socket of a Session's folder.
func SocketPath(sessionDir string) string {
	return filepath.Join(sessionDir, SocketName)
}

// DefaultSocket is the control socket of the Session id in the Runner's state
// folder (`$CREWDECK_HOME`, else `~/.crewdeck`).
func DefaultSocket(sessionID string) (string, error) {
	store, err := state.Default()
	if err != nil {
		return "", err
	}
	return SocketPath(filepath.Join(store.Dir, "sessions", sessionID)), nil
}

// Ask sends the request over the socket and waits for its reply, as long as
// it takes, or until ctx ends (the connection then closes, which withdraws
// the request on the adapter's side).
func Ask(ctx context.Context, socket string, request Request) (Reply, error) {
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "unix", socket)
	if err != nil {
		return Reply{}, fmt.Errorf("control: %w", err)
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()

	line, err := json.Marshal(request)
	if err != nil {
		return Reply{}, err
	}
	if _, err := conn.Write(append(line, '\n')); err != nil {
		return Reply{}, fmt.Errorf("control: %w", err)
	}
	answer, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil {
		if ctx.Err() != nil {
			return Reply{}, ctx.Err()
		}
		return Reply{}, fmt.Errorf("control: the adapter closed the request: %w", err)
	}
	var reply Reply
	if err := json.Unmarshal(answer, &reply); err != nil {
		return Reply{}, fmt.Errorf("control: reply %q: %w", answer, err)
	}
	return reply, nil
}
