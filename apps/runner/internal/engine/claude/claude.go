// Package claude is the adapter of Claude Code (ADR 0004, RUNNER-5): the
// unmodified `claude` binary driven with `-p --input-format stream-json
// --output-format stream-json`, as the spike recorded it
// (docs/spikes/engines.md). The Pilote's leave reaches it through the
// permission tool of an MCP server the Runner serves to the Session
// (permission/), the answers to its `AskUserQuestion` through a `PreToolUse`
// hook (hook/): both are `crewdeck-runner` commands Claude runs, which talk to
// the adapter over the Session's control socket (control/).
package claude

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/claude/control"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/claude/hook"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/claude/permission"
)

// RecordedVersions are the versions of Claude Code the adapter was tested
// on: the spike's (2.1.319), and the patches after it.
var RecordedVersions = engine.KnownVersions{">=2.1.319 <2.2"}

// fallbackModels are the aliases the spike found the binary takes, for a
// binary that lists no model.
var fallbackModels = []contracts.EngineCapabilitiesModelsElem{
	{Id: "default", Label: "Default"},
	{Id: "opus", Label: "Opus"},
	{Id: "sonnet", Label: "Sonnet"},
	{Id: "haiku", Label: "Haiku"},
	{Id: "fable", Label: "Fable"},
}

const (
	// toolCallWait bounds how long a request waits for the tool call it is
	// about to appear on stdout, so that the call comes first.
	toolCallWait = 2 * time.Second
	// probeTimeout bounds the Capabilities' probe of the binary.
	probeTimeout = 30 * time.Second
	// hookTimeout is the hook's timeout in the settings: a question waits
	// as long as the Pilote needs, a day at most for Claude Code.
	hookTimeout = 24 * 60 * 60
	// defaultRefusal is what Claude receives of a refusal with no text.
	defaultRefusal = "Refusé par le Pilote."
)

// Engine is the adapter of Claude Code. Its zero value runs `claude` from
// PATH, the Runner itself for the side channels, with no API key.
type Engine struct {
	// BinaryPath is the `claude` executable; empty, `claude` on PATH. A
	// StartOptions.BinaryPath wins.
	BinaryPath string
	// RunnerPath is `crewdeck-runner`, which Claude runs as its permission
	// tool and its hook; empty, the running executable.
	RunnerPath string
	// KnownVersions are the versions Capabilities knows; nil,
	// RecordedVersions.
	KnownVersions engine.KnownVersions
	// APIKey gives the Compte IA's API key, "" for the Pilote's own sign-in
	// (RUNNER-7 stores it). It reaches `claude` only as ANTHROPIC_API_KEY in
	// its environment.
	APIKey func(context.Context) (string, error)
	// Env is added to the environment of every `claude` the adapter runs.
	Env []string

	mu      sync.Mutex
	refused map[string]bool
}

var _ engine.Engine = (*Engine)(nil)

// ID is `claude-code`.
func (e *Engine) ID() contracts.EngineId { return contracts.EngineIdClaudeCode }

func (e *Engine) binary(opts engine.StartOptions) string {
	switch {
	case opts.BinaryPath != "":
		return opts.BinaryPath
	case e.BinaryPath != "":
		return e.BinaryPath
	}
	return "claude"
}

func (e *Engine) apiKey(ctx context.Context) (string, error) {
	if e.APIKey == nil {
		return "", nil
	}
	return e.APIKey(ctx)
}

// environment is the Runner's environment without its own API key, the
// adapter's and the Session's variables, and the Compte IA's key if any.
func (e *Engine) environment(key string, extra []string) []string {
	var env []string
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, "ANTHROPIC_API_KEY=") {
			env = append(env, kv)
		}
	}
	env = append(env, e.Env...)
	env = append(env, extra...)
	if key != "" {
		env = append(env, "ANTHROPIC_API_KEY="+key)
	}
	return env
}

func (e *Engine) refuse(model string) {
	if model == "" {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.refused == nil {
		e.refused = map[string]bool{}
	}
	e.refused[model] = true
}

func (e *Engine) isRefused(model string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.refused[model]
}

// streamFlags are the flags of every run: stream-json both ways.
var streamFlags = []string{"-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"}

// Start runs `claude` on a new Session, its first message InitialPrompt.
func (e *Engine) Start(ctx context.Context, opts engine.StartOptions) (engine.Run, error) {
	return e.start(ctx, opts, "")
}

// Resume runs `claude --resume <EngineSessionID>`.
func (e *Engine) Resume(ctx context.Context, opts engine.ResumeOptions) (engine.Run, error) {
	if opts.EngineSessionID == "" {
		return nil, errors.New("claude: resume needs the Session's engineSessionId")
	}
	return e.start(ctx, opts.StartOptions, opts.EngineSessionID)
}

func (e *Engine) start(ctx context.Context, opts engine.StartOptions, resume string) (engine.Run, error) {
	key, err := e.apiKey(ctx)
	if err != nil {
		return nil, fmt.Errorf("claude: the Compte IA's key: %w", err)
	}
	session, err := openSession(opts.SessionDir)
	if err != nil {
		return nil, err
	}
	runner := e.RunnerPath
	if runner == "" {
		if runner, err = os.Executable(); err != nil {
			session.remove()
			return nil, fmt.Errorf("claude: the Runner's executable: %w", err)
		}
	}
	listener, err := session.listen()
	if err != nil {
		session.remove()
		return nil, err
	}
	mcpConfig, settings, err := session.writeConfig(runner)
	if err != nil {
		listener.Close()
		session.remove()
		return nil, err
	}

	args := append([]string(nil), streamFlags...)
	args = append(args, "--include-partial-messages", "--setting-sources", "project", "--strict-mcp-config")
	if opts.Model != "" {
		args = append(args, "--model", opts.Model)
	}
	mode := "auto"
	if opts.PermissionMode == engine.PermissionBypass {
		mode = "bypassPermissions"
	}
	args = append(args, "--permission-mode", mode)
	if opts.SkillsDir != "" {
		args = append(args, "--plugin-dir", opts.SkillsDir)
	}
	args = append(args, "--mcp-config", mcpConfig, "--permission-prompt-tool", permission.PromptTool, "--settings", settings)
	if resume != "" {
		args = append(args, "--resume", resume)
	}

	cmd := exec.Command(e.binary(opts), args...)
	cmd.Dir = opts.Dir
	cmd.Env = e.environment(key, opts.Env)
	stderr := &tail{max: 4096}
	cmd.Stderr = stderr
	cmd.WaitDelay = 5 * time.Second
	stdin, err := cmd.StdinPipe()
	if err != nil {
		listener.Close()
		session.remove()
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		listener.Close()
		session.remove()
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		listener.Close()
		session.remove()
		return nil, fmt.Errorf("claude: start %s: %w", cmd.Path, err)
	}

	r := &run{
		ctx:       ctx,
		cmd:       cmd,
		stdin:     stdin,
		stderr:    stderr,
		session:   session,
		listener:  listener,
		events:    make(chan contracts.EngineEvent, 64),
		done:      make(chan struct{}),
		closing:   make(chan struct{}),
		pending:   map[string]*pending{},
		toolCalls: map[string]chan struct{}{},
	}
	r.parser.refusedModel = func() { e.refuse(opts.Model) }
	if opts.InitialPrompt != "" {
		if err := r.writeUser(opts.InitialPrompt); err != nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			listener.Close()
			session.remove()
			return nil, fmt.Errorf("claude: the initial prompt: %w", err)
		}
	}
	go r.serve()
	go r.read(stdout)
	return r, nil
}

// sessionFiles is the Session's folder: its control socket, and Claude's
// configuration under claude/.
type sessionFiles struct {
	dir   string
	id    string
	owned bool // a temporary folder, removed at the end of the run
}

func openSession(dir string) (*sessionFiles, error) {
	s := &sessionFiles{dir: dir}
	if dir == "" {
		// Until RUNNER-9 passes the Session's folder: a short temporary path,
		// the socket's under the 108 bytes of a unix address.
		created, err := os.MkdirTemp("", "crewdeck-session-")
		if err != nil {
			return nil, fmt.Errorf("claude: the Session's folder: %w", err)
		}
		s.dir, s.owned = created, true
	}
	if err := os.MkdirAll(filepath.Join(s.dir, "claude"), 0o700); err != nil {
		return nil, fmt.Errorf("claude: the Session's folder: %w", err)
	}
	if err := os.Chmod(s.dir, 0o700); err != nil {
		return nil, fmt.Errorf("claude: the Session's folder: %w", err)
	}
	s.id = filepath.Base(s.dir)
	return s, nil
}

func (s *sessionFiles) socket() string { return control.SocketPath(s.dir) }

func (s *sessionFiles) remove() {
	if s.owned {
		os.RemoveAll(s.dir)
	}
}

// listen opens the control socket, mode 600.
func (s *sessionFiles) listen() (net.Listener, error) {
	socket := s.socket()
	_ = os.Remove(socket) // a socket a killed Runner left
	listener, err := net.Listen("unix", socket)
	if err != nil {
		return nil, fmt.Errorf("claude: the control socket: %w", err)
	}
	if err := os.Chmod(socket, 0o600); err != nil {
		listener.Close()
		return nil, fmt.Errorf("claude: the control socket: %w", err)
	}
	return listener, nil
}

// writeConfig writes the Session's `--mcp-config` (the permission tool) and
// `--settings` (the hook of AskUserQuestion), and gives their paths.
func (s *sessionFiles) writeConfig(runner string) (mcpConfig, settings string, err error) {
	sessionArgs := []string{"--session", s.id, "--control", s.socket()}
	mcp := map[string]any{"mcpServers": map[string]any{
		permission.ServerName: map[string]any{
			"type":    "stdio",
			"command": runner,
			"args":    append([]string{"mcp", "permission"}, sessionArgs...),
		},
	}}
	hookCommand := shellQuote(append([]string{runner, "hook", "pre-tool-use"}, sessionArgs...))
	config := map[string]any{"hooks": map[string]any{
		"PreToolUse": []any{map[string]any{
			"matcher": hook.Tool,
			"hooks":   []any{map[string]any{"type": "command", "command": hookCommand, "timeout": hookTimeout}},
		}},
	}}
	mcpConfig = filepath.Join(s.dir, "claude", "mcp.json")
	settings = filepath.Join(s.dir, "claude", "settings.json")
	for path, content := range map[string]any{mcpConfig: mcp, settings: config} {
		data, err := json.MarshalIndent(content, "", "  ")
		if err != nil {
			return "", "", err
		}
		if err := os.WriteFile(path, append(data, '\n'), 0o600); err != nil {
			return "", "", fmt.Errorf("claude: %w", err)
		}
	}
	return mcpConfig, settings, nil
}

// shellQuote joins the words as a shell reads them back, each in single
// quotes.
func shellQuote(words []string) string {
	quoted := make([]string, len(words))
	for i, w := range words {
		quoted[i] = "'" + strings.ReplaceAll(w, "'", `'\''`) + "'"
	}
	return strings.Join(quoted, " ")
}

// run is one `claude` process.
type run struct {
	ctx      context.Context
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	stderr   *tail
	session  *sessionFiles
	listener net.Listener
	parser   parser

	stdinMu    sync.Mutex
	interrupts int

	emitMu sync.Mutex
	seq    int
	events chan contracts.EngineEvent

	mu           sync.Mutex
	ended        bool
	interrupting bool
	pending      map[string]*pending
	toolCalls    map[string]chan struct{} // closed once the tool call is emitted

	handlers sync.WaitGroup
	closing  chan struct{} // closed when the process ended: requests are released
	done     chan struct{}
	err      error
}

// pending is a request waiting for the Pilote.
type pending struct {
	kind   control.Kind
	answer chan engine.Answer
}

func (r *run) Events() <-chan contracts.EngineEvent { return r.events }

func (r *run) Wait() error {
	<-r.done
	return r.err
}

func (r *run) isEnded() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.ended
}

// Send writes the text as a stream-json user message.
func (r *run) Send(ctx context.Context, text string) error {
	if r.isEnded() {
		return engine.ErrRunEnded
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := r.writeUser(text); err != nil {
		if r.isEnded() {
			return engine.ErrRunEnded
		}
		return fmt.Errorf("claude: send: %w", err)
	}
	return nil
}

func (r *run) writeUser(text string) error {
	return r.write(map[string]any{"type": "user", "message": map[string]any{"role": "user", "content": text}})
}

func (r *run) write(message any) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	r.stdinMu.Lock()
	defer r.stdinMu.Unlock()
	_, err = r.stdin.Write(append(data, '\n'))
	return err
}

// Interrupt sends the control request the spike validated; Claude ends the
// turn with a result the parser reads as interrupted. When stdin is gone, a
// SIGINT.
func (r *run) Interrupt(ctx context.Context) error {
	if r.isEnded() {
		return engine.ErrRunEnded
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	r.mu.Lock()
	r.interrupting = true
	r.interrupts++
	id := fmt.Sprintf("crewdeck-interrupt-%d", r.interrupts)
	r.mu.Unlock()
	if err := r.write(map[string]any{"type": "control_request", "request_id": id, "request": map[string]any{"subtype": "interrupt"}}); err != nil {
		if signalErr := r.cmd.Process.Signal(syscall.SIGINT); signalErr != nil {
			if r.isEnded() {
				return engine.ErrRunEnded
			}
			return fmt.Errorf("claude: interrupt: %w", err)
		}
	}
	return nil
}

// Answer gives the Pilote's answer to the request waiting as requestID.
func (r *run) Answer(ctx context.Context, requestID string, answer engine.Answer) error {
	r.mu.Lock()
	if r.ended {
		r.mu.Unlock()
		return engine.ErrRunEnded
	}
	p, ok := r.pending[requestID]
	if ok && p.kind == control.Permission && answer.Allow == nil {
		r.mu.Unlock()
		return errors.New("claude: a permission request is answered with Allow")
	}
	if ok {
		delete(r.pending, requestID)
	}
	r.mu.Unlock()
	if !ok {
		return engine.ErrNoSuchRequest
	}
	select {
	case p.answer <- answer:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// emit stamps and sends an event; false once the run's context ended.
func (r *run) emit(event contracts.EngineEvent) bool {
	r.emitMu.Lock()
	defer r.emitMu.Unlock()
	r.seq++
	stamped := engine.Stamp(event, r.seq, time.Now())
	select {
	case r.events <- stamped:
		return true
	case <-r.ctx.Done():
		return false
	}
}

// toolCall is the channel closed once the tool call id is emitted.
func (r *run) toolCall(id string) chan struct{} {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.toolCalls[id]
	if !ok {
		c = make(chan struct{})
		r.toolCalls[id] = c
	}
	return c
}

// read parses stdout until the process ends, then ends the run.
func (r *run) read(stdout io.Reader) {
	stop := context.AfterFunc(r.ctx, func() {
		r.stdinMu.Lock()
		r.stdin.Close()
		r.stdinMu.Unlock()
		_ = r.cmd.Process.Kill()
	})
	defer stop()

	lines := bufio.NewReader(stdout)
	for {
		raw, err := lines.ReadBytes('\n')
		if len(strings.TrimSpace(string(raw))) > 0 {
			r.mu.Lock()
			interrupted := r.interrupting
			r.mu.Unlock()
			for _, event := range r.parser.parse(raw, interrupted) {
				if !r.emit(event) {
					break
				}
				if event.ToolCall != nil {
					c := r.toolCall(event.ToolCall.CallId)
					r.mu.Lock()
					select {
					case <-c:
					default:
						close(c)
					}
					r.mu.Unlock()
				}
				if event.Result != nil {
					r.mu.Lock()
					r.interrupting = false
					r.mu.Unlock()
				}
			}
		}
		if err != nil {
			break
		}
	}

	waitErr := r.cmd.Wait()
	r.mu.Lock()
	r.ended = true
	r.mu.Unlock()
	r.listener.Close()
	close(r.closing)
	r.handlers.Wait()

	switch {
	case r.ctx.Err() != nil:
		r.err = r.ctx.Err()
	case waitErr != nil:
		r.err = fmt.Errorf("claude: %w", waitErr)
		message := "Claude Code s’est arrêté sur une erreur."
		if text := strings.TrimSpace(r.stderr.String()); text != "" {
			message += " " + text
		}
		r.emit(contracts.EngineEvent{Error: &contracts.EngineEventError{Kind: contracts.EngineEventKindError, Code: "exit", Message: message}})
	}
	r.session.remove()
	close(r.events)
	close(r.done)
}

// serve answers the control socket: one request per connection, from the
// permission tool or the hook.
func (r *run) serve() {
	for {
		conn, err := r.listener.Accept()
		if err != nil {
			return
		}
		r.handlers.Add(1)
		go func() {
			defer r.handlers.Done()
			defer conn.Close()
			r.handle(conn)
		}()
	}
}

func (r *run) handle(conn net.Conn) {
	in := bufio.NewReader(conn)
	line, err := in.ReadBytes('\n')
	if err != nil {
		return
	}
	var req control.Request
	if err := json.Unmarshal(line, &req); err != nil {
		return
	}
	// The connection's end, while the request waits: Claude gave it up.
	gone := make(chan struct{})
	go func() {
		_, _ = in.ReadByte()
		close(gone)
	}()
	raw := json.RawMessage(append([]byte(nil), line...))

	if req.ToolUseID != "" {
		select {
		case <-r.toolCall(req.ToolUseID):
		case <-time.After(toolCallWait):
		case <-gone:
			return
		case <-r.closing:
			return
		}
	}

	var reply control.Reply
	switch req.Kind {
	case control.Permission:
		id := req.ToolUseID
		if id == "" {
			id = fmt.Sprintf("permission-%d", time.Now().UnixNano())
		}
		event := contracts.EngineEvent{PermissionRequest: &contracts.EngineEventPermissionRequest{
			Kind: contracts.EngineEventKindPermissionRequest, RequestId: id, Tool: req.ToolName, Command: commandOf(req.Input), Raw: raw,
		}}
		answer, ok := r.ask(id, control.Permission, event, gone)
		if !ok {
			return
		}
		reply.Allow = answer.Allow != nil && *answer.Allow
		if !reply.Allow {
			reply.Message = answer.Text
			if reply.Message == "" {
				reply.Message = defaultRefusal
			}
		}
	case control.Question:
		var input struct {
			Questions []struct {
				Question string `json:"question"`
				Header   string `json:"header"`
				Options  []struct {
					Label       string `json:"label"`
					Description string `json:"description"`
				} `json:"options"`
				MultiSelect bool `json:"multiSelect"`
			} `json:"questions"`
		}
		if err := json.Unmarshal(req.Input, &input); err != nil {
			return
		}
		reply.Allow = true
		reply.Answers = map[string]string{}
		for i, q := range input.Questions {
			id := req.ToolUseID
			if id == "" {
				id = fmt.Sprintf("question-%d", time.Now().UnixNano())
			}
			if i > 0 {
				id = fmt.Sprintf("%s#%d", id, i+1)
			}
			question := &contracts.EngineEventQuestion{Kind: contracts.EngineEventKindQuestion, RequestId: id, Title: q.Question, Multiple: q.MultiSelect, Options: []contracts.EngineEventQuestionOptionsElem{}, Raw: raw}
			for _, o := range q.Options {
				option := contracts.EngineEventQuestionOptionsElem{Label: o.Label}
				if o.Description != "" {
					detail := o.Description
					option.Detail = &detail
				}
				question.Options = append(question.Options, option)
			}
			answer, ok := r.ask(id, control.Question, contracts.EngineEvent{Question: question}, gone)
			if !ok {
				return
			}
			text := answer.Text
			if len(answer.Options) > 0 {
				text = strings.Join(answer.Options, ", ")
			}
			reply.Answers[q.Question] = text
		}
	default:
		return
	}
	data, err := json.Marshal(reply)
	if err != nil {
		return
	}
	_, _ = conn.Write(append(data, '\n'))
}

// ask emits the request's event and waits, without timeout, for its answer;
// false when the request is withdrawn (Claude gave it up, the run ended).
func (r *run) ask(id string, kind control.Kind, event contracts.EngineEvent, gone <-chan struct{}) (engine.Answer, bool) {
	p := &pending{kind: kind, answer: make(chan engine.Answer, 1)}
	r.mu.Lock()
	if r.ended {
		r.mu.Unlock()
		return engine.Answer{}, false
	}
	r.pending[id] = p
	r.mu.Unlock()
	withdraw := func() {
		r.mu.Lock()
		if r.pending[id] == p {
			delete(r.pending, id)
		}
		r.mu.Unlock()
	}
	if !r.emit(event) {
		withdraw()
		return engine.Answer{}, false
	}
	select {
	case answer := <-p.answer:
		return answer, true
	case <-gone:
	case <-r.closing:
	case <-r.ctx.Done():
	}
	withdraw()
	return engine.Answer{}, false
}

// tail keeps the last bytes written to it: the end of the binary's stderr.
type tail struct {
	mu   sync.Mutex
	max  int
	data []byte
}

func (t *tail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.data = append(t.data, p...)
	if len(t.data) > t.max {
		t.data = t.data[len(t.data)-t.max:]
	}
	return len(p), nil
}

func (t *tail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.data)
}

// Capabilities runs `claude --version`, then the binary once to read its
// answer to `initialize` (the Compte IA, the models), as the spike's scenario
// 7 did; the models a run saw refused are not in the plan.
func (e *Engine) Capabilities(ctx context.Context) (contracts.EngineCapabilities, error) {
	caps := contracts.EngineCapabilities{
		Engine:   contracts.EngineIdClaudeCode,
		Account:  contracts.EngineCapabilitiesAccount{Kind: contracts.EngineCapabilitiesAccountKindNone, State: contracts.EngineCapabilitiesAccountStateLoginRequired},
		Models:   []contracts.EngineCapabilitiesModelsElem{},
		Features: contracts.EngineCapabilitiesFeatures{Interrupt: true, Resume: true, Questions: true, Permissions: true},
	}
	key, err := e.apiKey(ctx)
	if err != nil {
		return caps, fmt.Errorf("claude: the Compte IA's key: %w", err)
	}
	binary := e.binary(engine.StartOptions{})
	env := e.environment(key, nil)

	cmd := exec.CommandContext(ctx, binary, "--version")
	cmd.Env = env
	output, err := cmd.Output()
	if errors.Is(err, exec.ErrNotFound) || errors.Is(err, os.ErrNotExist) {
		return caps, nil
	}
	if err != nil {
		return caps, fmt.Errorf("claude: %s --version: %w", binary, err)
	}
	caps.Installed = true
	if v, ok := engine.ParseVersion(string(output)); ok {
		caps.Version = &v
		known := e.KnownVersions
		if known == nil {
			known = RecordedVersions
		}
		caps.KnownVersion = known.Contains(v)
	}

	init, err := e.initialize(ctx, binary, env)
	if err != nil {
		return caps, err
	}
	switch {
	case key != "":
		caps.Account = contracts.EngineCapabilitiesAccount{Kind: contracts.EngineCapabilitiesAccountKindApiKey, State: contracts.EngineCapabilitiesAccountStateConnected}
	case init.Account.TokenSource == "none":
	case init.Account.SubscriptionType != "" || init.Account.TokenSource != "":
		caps.Account = contracts.EngineCapabilitiesAccount{Kind: contracts.EngineCapabilitiesAccountKindSubscription, State: contracts.EngineCapabilitiesAccountStateConnected}
	}

	models := fallbackModels
	if len(init.Models) > 0 {
		models = nil
		for _, m := range init.Models {
			label := m.DisplayName
			if label == "" {
				label = m.Value
			}
			models = append(models, contracts.EngineCapabilitiesModelsElem{Id: m.Value, Label: label})
		}
	}
	e.mu.Lock()
	for id := range e.refused {
		if !slices.ContainsFunc(models, func(m contracts.EngineCapabilitiesModelsElem) bool { return m.Id == id }) {
			models = append(models, contracts.EngineCapabilitiesModelsElem{Id: id, Label: id})
		}
	}
	e.mu.Unlock()
	connected := caps.Account.State == contracts.EngineCapabilitiesAccountStateConnected
	for _, m := range models {
		switch {
		case !connected:
			m.Reason = reason(contracts.EngineCapabilitiesModelsElemReasonLoginRequired)
		case e.isRefused(m.Id):
			m.Reason = reason(contracts.EngineCapabilitiesModelsElemReasonNotInPlan)
		default:
			m.Usable = true
		}
		caps.Models = append(caps.Models, m)
	}
	return caps, nil
}

func reason(r contracts.EngineCapabilitiesModelsElemReason) *contracts.EngineCapabilitiesModelsElemReason {
	return &r
}

// initializeResponse is what Capabilities reads of Claude's answer to
// `initialize`.
type initializeResponse struct {
	Account struct {
		SubscriptionType string `json:"subscriptionType"`
		TokenSource      string `json:"tokenSource"`
	} `json:"account"`
	Models []struct {
		Value       string `json:"value"`
		DisplayName string `json:"displayName"`
	} `json:"models"`
}

// initialize runs the binary in stream-json, sends `initialize` and reads
// its control_response; the binary is stopped before any message.
func (e *Engine) initialize(ctx context.Context, binary string, env []string) (initializeResponse, error) {
	var out initializeResponse
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, streamFlags...)
	cmd.Dir = os.TempDir()
	cmd.Env = env
	cmd.WaitDelay = 5 * time.Second
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return out, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return out, err
	}
	if err := cmd.Start(); err != nil {
		return out, fmt.Errorf("claude: start %s: %w", binary, err)
	}
	defer func() {
		stdin.Close()
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()
	request := `{"type":"control_request","request_id":"crewdeck-initialize","request":{"subtype":"initialize"}}` + "\n"
	if _, err := io.WriteString(stdin, request); err != nil {
		return out, fmt.Errorf("claude: initialize: %w", err)
	}
	lines := bufio.NewScanner(stdout)
	lines.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for lines.Scan() {
		var line struct {
			Type     string `json:"type"`
			Response struct {
				Subtype  string             `json:"subtype"`
				Error    string             `json:"error"`
				Response initializeResponse `json:"response"`
			} `json:"response"`
		}
		if json.Unmarshal(lines.Bytes(), &line) != nil || line.Type != "control_response" {
			continue
		}
		if line.Response.Subtype != "success" {
			return out, fmt.Errorf("claude: initialize: %s", line.Response.Error)
		}
		return line.Response.Response, nil
	}
	if ctx.Err() != nil {
		return out, fmt.Errorf("claude: initialize: %w", ctx.Err())
	}
	return out, errors.New("claude: initialize: the binary ended without answering")
}
