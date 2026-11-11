// Command fake-engine stands in for a Moteur's binary in the tests (ADR
// 0004): it writes the lines of the recorded stream FAKE_ENGINE_STREAM to
// stdout, as the Moteur emitted them, and plays the directive lines
// {"fake":"…"} of the stream instead of writing them:
//
//   - await-stdin: waits for a line on stdin (a message, an answer to a
//     question or a permission, an interrupt: wherever the real Moteur
//     waited);
//   - claude-permission: asks the permission tool of Claude Code, as Claude
//     does (claude.go), its `arguments` those of the recorded `tools/call`;
//   - claude-hook: runs the `PreToolUse` hooks of Claude Code's settings on
//     the recorded `input`, as Claude does (claude.go).
//
// Each line read on stdin is appended to FAKE_ENGINE_STDIN_LOG, and what a
// side channel answered (the permission tool's text, a hook's stdout) to
// FAKE_ENGINE_REPLY_LOG, when they are set. FAKE_ENGINE_ARGV_LOG gets one
// line per run, {"args":[…],"env":{…}}, `env` holding the variables named in
// FAKE_ENGINE_LOG_ENV (comma separated) that are set. With `--version` among
// its arguments it prints FAKE_ENGINE_VERSION and exits 0. Otherwise it
// exits with FAKE_ENGINE_EXIT (default 0), whatever its arguments.
//
// Built by the tests only (enginetest.FakeBinary), never shipped.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"slices"
	"strconv"
	"strings"
)

func main() {
	if err := logArgv(os.Args[1:]); err != nil {
		fail(err)
	}
	if slices.Contains(os.Args[1:], "--version") {
		fmt.Println(os.Getenv("FAKE_ENGINE_VERSION"))
		return
	}
	if err := run(os.Args[1:], os.Stdin, os.Stdout); err != nil {
		fail(err)
	}
	code := 0
	if raw := os.Getenv("FAKE_ENGINE_EXIT"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			fail(fmt.Errorf("FAKE_ENGINE_EXIT %q: %v", raw, err))
		}
		code = parsed
	}
	os.Exit(code)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "fake-engine:", err)
	os.Exit(2)
}

func logArgv(args []string) error {
	path := os.Getenv("FAKE_ENGINE_ARGV_LOG")
	if path == "" {
		return nil
	}
	env := map[string]string{}
	for _, name := range strings.Split(os.Getenv("FAKE_ENGINE_LOG_ENV"), ",") {
		if value, ok := os.LookupEnv(name); ok && name != "" {
			env[name] = value
		}
	}
	line, err := json.Marshal(map[string]any{"args": args, "env": env})
	if err != nil {
		return err
	}
	return appendLine(path, string(line))
}

func appendLine(path, line string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = io.WriteString(file, strings.TrimRight(line, "\n")+"\n")
	return err
}

func run(args []string, stdin io.Reader, stdout io.Writer) error {
	path := os.Getenv("FAKE_ENGINE_STREAM")
	if path == "" {
		return fmt.Errorf("FAKE_ENGINE_STREAM is not set")
	}
	stream, err := os.Open(path)
	if err != nil {
		return err
	}
	defer stream.Close()

	var log io.Writer = io.Discard
	if logPath := os.Getenv("FAKE_ENGINE_STDIN_LOG"); logPath != "" {
		file, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		defer file.Close()
		log = file
	}
	reply := func(line string) error {
		if replyPath := os.Getenv("FAKE_ENGINE_REPLY_LOG"); replyPath != "" {
			return appendLine(replyPath, line)
		}
		return nil
	}
	claude := &claudeChannels{args: args}
	defer claude.close()

	input := bufio.NewReader(stdin)
	lines := bufio.NewScanner(stream)
	lines.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for n := 1; lines.Scan(); n++ {
		line := lines.Bytes()
		d, err := directiveOf(line)
		if err != nil {
			return fmt.Errorf("%s:%d: %w", path, n, err)
		}
		switch d.Fake {
		case "":
			if _, err := fmt.Fprintf(stdout, "%s\n", line); err != nil {
				return err
			}
		case "await-stdin":
			got, err := input.ReadString('\n')
			if err != nil {
				return fmt.Errorf("%s:%d: awaiting stdin: %w", path, n, err)
			}
			if _, err := io.WriteString(log, got); err != nil {
				return err
			}
		case "claude-permission":
			answer, err := claude.permission(d.Arguments)
			if err != nil {
				return fmt.Errorf("%s:%d: %w", path, n, err)
			}
			if err := reply(answer); err != nil {
				return err
			}
		case "claude-hook":
			outputs, err := claude.preToolUse(d.Input)
			if err != nil {
				return fmt.Errorf("%s:%d: %w", path, n, err)
			}
			for _, output := range outputs {
				if err := reply(output); err != nil {
					return err
				}
			}
		}
	}
	return lines.Err()
}

// directive is a line {"fake":"…", …}; Fake is "" for a line of the Moteur's
// own (which never has a key "fake").
type directive struct {
	Fake      string          `json:"fake"`
	Arguments json.RawMessage `json:"arguments"`
	Input     json.RawMessage `json:"input"`
}

func directiveOf(line []byte) (directive, error) {
	var d directive
	if json.Unmarshal(line, &d) != nil || d.Fake == "" {
		return directive{}, nil
	}
	switch d.Fake {
	case "await-stdin", "claude-permission", "claude-hook":
		return d, nil
	}
	return directive{}, fmt.Errorf("unknown directive %q", d.Fake)
}
