// Command fake-engine stands in for a Moteur's binary in the tests (ADR
// 0004): it writes the lines of the recorded stream FAKE_ENGINE_STREAM to
// stdout, as the Moteur emitted them, and at each line {"fake":"await-stdin"}
// waits for a line on stdin instead (a message, an answer to a question or a
// permission, an interrupt: wherever the real Moteur waited). Each line read
// is appended to FAKE_ENGINE_STDIN_LOG when it is set. It exits with
// FAKE_ENGINE_EXIT (default 0), whatever its arguments.
//
// Built by the tests only (enginetest.FakeBinary), never shipped.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
)

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "fake-engine:", err)
		os.Exit(2)
	}
	code := 0
	if raw := os.Getenv("FAKE_ENGINE_EXIT"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			fmt.Fprintf(os.Stderr, "fake-engine: FAKE_ENGINE_EXIT %q: %v\n", raw, err)
			os.Exit(2)
		}
		code = parsed
	}
	os.Exit(code)
}

func run(stdin io.Reader, stdout io.Writer) error {
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

	input := bufio.NewReader(stdin)
	lines := bufio.NewScanner(stream)
	lines.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for n := 1; lines.Scan(); n++ {
		line := lines.Bytes()
		directive, err := directiveOf(line)
		if err != nil {
			return fmt.Errorf("%s:%d: %w", path, n, err)
		}
		if directive == "" {
			if _, err := fmt.Fprintf(stdout, "%s\n", line); err != nil {
				return err
			}
			continue
		}
		got, err := input.ReadString('\n')
		if err != nil {
			return fmt.Errorf("%s:%d: awaiting stdin: %w", path, n, err)
		}
		if _, err := io.WriteString(log, got); err != nil {
			return err
		}
	}
	return lines.Err()
}

// directiveOf gives the directive of a line {"fake":"…"}, "" for a line of
// the Moteur's own (which never has a key "fake").
func directiveOf(line []byte) (string, error) {
	var directive struct {
		Fake string `json:"fake"`
	}
	if json.Unmarshal(line, &directive) != nil || directive.Fake == "" {
		return "", nil
	}
	if directive.Fake != "await-stdin" {
		return "", fmt.Errorf("unknown directive %q", directive.Fake)
	}
	return directive.Fake, nil
}
