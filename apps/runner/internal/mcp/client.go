package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Timeout bounds a whole exchange with a server: start, initialize, every page of tools/list.
const Timeout = 30 * time.Second

// protocolVersion is the MCP revision the client asks for.
const protocolVersion = "2025-06-18"

// stderrTail is how much of a stdio server's stderr an error keeps.
const stderrTail = 4 << 10

// Tool is a tool a server lists.
type Tool struct {
	Name string `json:"name"`
}

// transport sends a JSON-RPC message and, for a request, gives its answer.
type transport interface {
	request(ctx context.Context, id int, method string, params any) (json.RawMessage, error)
	notify(ctx context.Context, method string, params any) error
	close()
}

type rpcAnswer struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func message(id int, method string, params any) ([]byte, error) {
	m := map[string]any{"jsonrpc": "2.0", "method": method}
	if id != 0 {
		m["id"] = id
	}
	if params != nil {
		m["params"] = params
	}
	return json.Marshal(m)
}

// answerTo reads one JSON-RPC message: its result when it answers id, ok
// false when it is something else (a notification, a request of the server).
func answerTo(id int, data []byte) (json.RawMessage, bool, error) {
	var a rpcAnswer
	if err := json.Unmarshal(data, &a); err != nil {
		return nil, false, nil
	}
	if a.Method != "" || string(a.ID) != fmt.Sprint(id) {
		return nil, false, nil
	}
	if a.Error != nil {
		return nil, true, fmt.Errorf("erreur MCP %d : %s", a.Error.Code, a.Error.Message)
	}
	return a.Result, true, nil
}

// ListTools starts or reaches the server, initializes the session and lists
// every tool (following nextCursor), in Timeout at most; a stdio server is
// killed at the end, its process group with it. An error never holds the
// server's secrets.
func ListTools(ctx context.Context, server Server) ([]Tool, error) {
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()
	var (
		t   transport
		err error
	)
	switch server.Transport {
	case TransportStdio:
		var s *stdioTransport
		if s, err = startStdio(server); err == nil {
			t = s
			// A write the server no longer reads blocks whatever ctx says:
			// at the deadline its group is killed and its pipes closed, which ends it.
			stop := context.AfterFunc(ctx, s.kill)
			defer stop()
		}
	case TransportHTTP:
		t = &httpTransport{url: server.URL, headers: server.Headers, client: &http.Client{}}
	default:
		err = fmt.Errorf("transport inconnu « %s »", server.Transport)
	}
	if err != nil {
		return nil, redact(err, server)
	}
	defer t.close()
	tools, err := listTools(ctx, t)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil {
			err = fmt.Errorf("pas de réponse en %s", Timeout)
		}
		if s, ok := t.(*stdioTransport); ok {
			err = s.withStderr(err)
		}
		return nil, redact(err, server)
	}
	return tools, nil
}

func listTools(ctx context.Context, t transport) ([]Tool, error) {
	if _, err := t.request(ctx, 1, "initialize", map[string]any{
		"protocolVersion": protocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": "crewdeck-runner", "version": "1"},
	}); err != nil {
		return nil, err
	}
	if err := t.notify(ctx, "notifications/initialized", nil); err != nil {
		return nil, err
	}
	tools := []Tool{}
	cursor := ""
	for id := 2; ; id++ {
		params := map[string]any{}
		if cursor != "" {
			params["cursor"] = cursor
		}
		result, err := t.request(ctx, id, "tools/list", params)
		if err != nil {
			return nil, err
		}
		var page struct {
			Tools      []Tool `json:"tools"`
			NextCursor string `json:"nextCursor"`
		}
		if err := json.Unmarshal(result, &page); err != nil {
			return nil, fmt.Errorf("réponse illisible à tools/list : %w", err)
		}
		tools = append(tools, page.Tools...)
		if page.NextCursor == "" || page.NextCursor == cursor {
			return tools, nil
		}
		cursor = page.NextCursor
	}
}

// redact replaces each of the server's secrets in the error by ***.
func redact(err error, server Server) error {
	text := err.Error()
	for _, secret := range server.Secrets() {
		if secret != "" {
			text = strings.ReplaceAll(text, secret, "***")
		}
	}
	return errors.New(text)
}

// tail keeps the last bytes written to it.
type tail struct {
	mu   sync.Mutex
	data []byte
}

func (t *tail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.data = append(t.data, p...)
	if len(t.data) > stderrTail {
		t.data = t.data[len(t.data)-stderrTail:]
	}
	return len(p), nil
}

func (t *tail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return strings.TrimSpace(string(t.data))
}

type stdioTransport struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	lines  chan []byte
	read   chan struct{} // closed once stdout ends
	stderr *tail
	killed sync.Once
}

func startStdio(server Server) (*stdioTransport, error) {
	cmd := exec.Command(server.Command, server.Args...)
	cmd.Env = os.Environ()
	for k, v := range server.Env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	t := &stdioTransport{cmd: cmd, lines: make(chan []byte, 16), read: make(chan struct{}), stderr: &tail{}}
	cmd.Stderr = t.stderr
	var err error
	if t.stdin, err = cmd.StdinPipe(); err != nil {
		return nil, err
	}
	if t.stdout, err = cmd.StdoutPipe(); err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("la commande n’a pas démarré : %w", err)
	}
	go func() {
		defer close(t.read)
		lines := bufio.NewScanner(t.stdout)
		lines.Buffer(make([]byte, 0, 64<<10), 16<<20)
		for lines.Scan() {
			t.lines <- append([]byte(nil), lines.Bytes()...)
		}
	}()
	return t, nil
}

func (t *stdioTransport) send(data []byte) error {
	if _, err := t.stdin.Write(append(data, '\n')); err != nil {
		return errors.New("le serveur s’est arrêté avant de répondre")
	}
	return nil
}

func (t *stdioTransport) request(ctx context.Context, id int, method string, params any) (json.RawMessage, error) {
	data, err := message(id, method, params)
	if err != nil {
		return nil, err
	}
	if err := t.send(data); err != nil {
		return nil, err
	}
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case line := <-t.lines:
			if result, ok, err := answerTo(id, line); ok || err != nil {
				return result, err
			}
		case <-t.read:
			// What was read before the end is still in lines.
			select {
			case line := <-t.lines:
				if result, ok, err := answerTo(id, line); ok || err != nil {
					return result, err
				}
				continue
			default:
			}
			return nil, errors.New("le serveur s’est arrêté avant de répondre")
		}
	}
}

func (t *stdioTransport) notify(_ context.Context, method string, params any) error {
	data, err := message(0, method, params)
	if err != nil {
		return err
	}
	return t.send(data)
}

// withStderr adds what the server wrote on its stderr to the error.
func (t *stdioTransport) withStderr(err error) error {
	if stderr := t.stderr.String(); stderr != "" {
		return fmt.Errorf("%w : %s", err, stderr)
	}
	return err
}

// kill kills the server's process group and closes its pipes: a write or a
// read on them, blocked, returns. It may run beside a request.
func (t *stdioTransport) kill() {
	t.killed.Do(func() {
		_ = t.stdin.Close()
		if t.cmd.Process != nil {
			_ = syscall.Kill(-t.cmd.Process.Pid, syscall.SIGKILL)
		}
		_ = t.stdout.Close()
	})
}

// close kills the server's process group, then waits for it.
func (t *stdioTransport) close() {
	t.kill()
	go func() {
		for range t.lines {
		}
	}()
	<-t.read
	close(t.lines)
	_ = t.cmd.Wait()
}

type httpTransport struct {
	url     string
	headers map[string]string
	client  *http.Client
	session string
}

func (t *httpTransport) post(ctx context.Context, data []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.url, bytes.NewReader(data))
	if err != nil {
		return nil, errors.New("adresse du serveur invalide")
	}
	for k, v := range t.headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", protocolVersion)
	if t.session != "" {
		req.Header.Set("Mcp-Session-Id", t.session)
	}
	resp, err := t.client.Do(req)
	if err != nil {
		// The URL is left out of the error: it may hold a token.
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			err = urlErr.Err
		}
		return nil, fmt.Errorf("serveur injoignable : %w", err)
	}
	if session := resp.Header.Get("Mcp-Session-Id"); session != "" {
		t.session = session
	}
	if resp.StatusCode >= 300 {
		resp.Body.Close()
		return nil, fmt.Errorf("le serveur a répondu %s", resp.Status)
	}
	return resp, nil
}

func (t *httpTransport) request(ctx context.Context, id int, method string, params any) (json.RawMessage, error) {
	data, err := message(id, method, params)
	if err != nil {
		return nil, err
	}
	resp, err := t.post(ctx, data)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		return readEvents(id, resp.Body)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, err
	}
	result, ok, err := answerTo(id, body)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("pas de réponse à %s", method)
	}
	return result, nil
}

// readEvents reads a text/event-stream to the JSON-RPC answer to id.
func readEvents(id int, body io.Reader) (json.RawMessage, error) {
	lines := bufio.NewScanner(body)
	lines.Buffer(make([]byte, 0, 64<<10), 16<<20)
	var data []string
	for {
		more := lines.Scan()
		line := lines.Text()
		if !more || line == "" {
			if len(data) > 0 {
				if result, ok, err := answerTo(id, []byte(strings.Join(data, "\n"))); ok || err != nil {
					return result, err
				}
				data = nil
			}
			if !more {
				return nil, errors.New("le flux du serveur s’est terminé sans réponse")
			}
			continue
		}
		if value, ok := strings.CutPrefix(line, "data:"); ok {
			data = append(data, strings.TrimPrefix(value, " "))
		}
	}
}

func (t *httpTransport) notify(ctx context.Context, method string, params any) error {
	data, err := message(0, method, params)
	if err != nil {
		return err
	}
	resp, err := t.post(ctx, data)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func (t *httpTransport) close() { t.client.CloseIdleConnections() }
