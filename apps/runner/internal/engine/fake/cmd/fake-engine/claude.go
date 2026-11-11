package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
)

// claudeChannels plays the side channels of Claude Code as the spike recorded
// them (docs/spikes/engines.md, scenarios 2 and 3), from the flags the
// adapter gave: the MCP server of `--mcp-config` behind
// `--permission-prompt-tool mcp__<server>__<tool>`, and the `PreToolUse`
// hooks of `--settings`.
type claudeChannels struct {
	args []string

	mcp    *exec.Cmd
	in     io.WriteCloser
	out    *bufio.Scanner
	tool   string
	nextID int
}

func (c *claudeChannels) flag(name string) (string, error) {
	for i, arg := range c.args {
		if arg == name && i+1 < len(c.args) {
			return c.args[i+1], nil
		}
	}
	return "", fmt.Errorf("no %s among the arguments %q", name, c.args)
}

// permission calls the permission tool with the recorded arguments and gives
// the text of its result, the JSON Claude reads (`{"behavior":…}`).
func (c *claudeChannels) permission(arguments json.RawMessage) (string, error) {
	if c.mcp == nil {
		if err := c.connect(); err != nil {
			return "", err
		}
	}
	var args struct {
		ToolUseID string `json:"tool_use_id"`
	}
	if err := json.Unmarshal(arguments, &args); err != nil {
		return "", fmt.Errorf("claude-permission arguments: %w", err)
	}
	id := c.nextID
	c.nextID++
	if err := c.send(map[string]any{"jsonrpc": "2.0", "id": id, "method": "tools/call", "params": map[string]any{
		"name":      c.tool,
		"arguments": arguments,
		"_meta":     map[string]any{"claudecode/toolUseId": args.ToolUseID, "progressToken": id},
	}}); err != nil {
		return "", err
	}
	response, err := c.response(id)
	if err != nil {
		return "", err
	}
	var result struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(response, &result); err != nil || len(result.Content) != 1 || result.Content[0].Type != "text" {
		return "", fmt.Errorf("tools/call result %s: want one text content", response)
	}
	return result.Content[0].Text, nil
}

// connect starts the MCP server and goes through the handshake Claude Code
// does: initialize, notifications/initialized, tools/list.
func (c *claudeChannels) connect() error {
	promptTool, err := c.flag("--permission-prompt-tool")
	if err != nil {
		return err
	}
	parts := strings.SplitN(promptTool, "__", 3)
	if len(parts) != 3 || parts[0] != "mcp" {
		return fmt.Errorf("--permission-prompt-tool %q: want mcp__<server>__<tool>", promptTool)
	}
	server, tool := parts[1], parts[2]
	configPath, err := c.flag("--mcp-config")
	if err != nil {
		return err
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}
	var config struct {
		MCPServers map[string]struct {
			Type    string            `json:"type"`
			Command string            `json:"command"`
			Args    []string          `json:"args"`
			Env     map[string]string `json:"env"`
		} `json:"mcpServers"`
	}
	if err := json.Unmarshal(data, &config); err != nil {
		return fmt.Errorf("--mcp-config %s: %w", configPath, err)
	}
	s, ok := config.MCPServers[server]
	if !ok || s.Command == "" || (s.Type != "" && s.Type != "stdio") {
		return fmt.Errorf("--mcp-config %s: no stdio server %q", configPath, server)
	}
	c.mcp = exec.Command(s.Command, s.Args...)
	c.mcp.Env = os.Environ()
	for k, v := range s.Env {
		c.mcp.Env = append(c.mcp.Env, k+"="+v)
	}
	c.mcp.Stderr = os.Stderr
	if c.in, err = c.mcp.StdinPipe(); err != nil {
		return err
	}
	stdout, err := c.mcp.StdoutPipe()
	if err != nil {
		return err
	}
	if err := c.mcp.Start(); err != nil {
		return fmt.Errorf("start the MCP server %q: %w", server, err)
	}
	c.out = bufio.NewScanner(stdout)
	c.out.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	c.tool = tool

	if err := c.send(map[string]any{"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": map[string]any{
		"protocolVersion": "2025-11-25",
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": "claude-code", "version": "fake"},
	}}); err != nil {
		return err
	}
	if _, err := c.response(0); err != nil {
		return err
	}
	if err := c.send(map[string]any{"jsonrpc": "2.0", "method": "notifications/initialized"}); err != nil {
		return err
	}
	if err := c.send(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}); err != nil {
		return err
	}
	listed, err := c.response(1)
	if err != nil {
		return err
	}
	var tools struct {
		Tools []struct {
			Name string `json:"name"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(listed, &tools); err != nil {
		return fmt.Errorf("tools/list result %s: %w", listed, err)
	}
	for _, t := range tools.Tools {
		if t.Name == tool {
			c.nextID = 2
			return nil
		}
	}
	return fmt.Errorf("the MCP server %q has no tool %q: %s", server, tool, listed)
}

func (c *claudeChannels) send(message any) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	_, err = c.in.Write(append(data, '\n'))
	return err
}

// response reads the server's messages up to the response of id, skipping
// its notifications (the progress of a call that waits).
func (c *claudeChannels) response(id int) (json.RawMessage, error) {
	for c.out.Scan() {
		var message struct {
			ID     *int            `json:"id"`
			Method string          `json:"method"`
			Result json.RawMessage `json:"result"`
			Error  json.RawMessage `json:"error"`
		}
		if err := json.Unmarshal(c.out.Bytes(), &message); err != nil {
			return nil, fmt.Errorf("MCP server wrote %q: %w", c.out.Bytes(), err)
		}
		if message.Method != "" || message.ID == nil || *message.ID != id {
			continue
		}
		if message.Error != nil {
			return nil, fmt.Errorf("MCP error on %d: %s", id, message.Error)
		}
		return message.Result, nil
	}
	if err := c.out.Err(); err != nil {
		return nil, err
	}
	return nil, fmt.Errorf("the MCP server closed its stdout before answering %d", id)
}

// preToolUse runs the `PreToolUse` hooks of --settings whose matcher takes
// the input's tool, its input on stdin, and gives each one's stdout.
func (c *claudeChannels) preToolUse(input json.RawMessage) ([]string, error) {
	settingsPath, err := c.flag("--settings")
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		return nil, err
	}
	var settings struct {
		Hooks struct {
			PreToolUse []struct {
				Matcher string `json:"matcher"`
				Hooks   []struct {
					Type    string `json:"type"`
					Command string `json:"command"`
				} `json:"hooks"`
			} `json:"PreToolUse"`
		} `json:"hooks"`
	}
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, fmt.Errorf("--settings %s: %w", settingsPath, err)
	}
	var call struct {
		ToolName string `json:"tool_name"`
	}
	if err := json.Unmarshal(input, &call); err != nil {
		return nil, fmt.Errorf("claude-hook input: %w", err)
	}
	var outputs []string
	for _, group := range settings.Hooks.PreToolUse {
		if !matches(group.Matcher, call.ToolName) {
			continue
		}
		for _, hook := range group.Hooks {
			if hook.Type != "command" {
				continue
			}
			cmd := exec.Command("sh", "-c", hook.Command)
			cmd.Stdin = bytes.NewReader(input)
			var stderr bytes.Buffer
			cmd.Stderr = &stderr
			out, err := cmd.Output()
			if err != nil {
				return nil, fmt.Errorf("hook %q: %w: %s", hook.Command, err, stderr.String())
			}
			outputs = append(outputs, strings.TrimSpace(string(out)))
		}
	}
	if len(outputs) == 0 {
		return nil, fmt.Errorf("--settings %s: no PreToolUse hook for %q", settingsPath, call.ToolName)
	}
	return outputs, nil
}

// matches is Claude Code's matcher: empty or `*` for every tool, else a
// regular expression of the tool's whole name.
func matches(matcher, tool string) bool {
	if matcher == "" || matcher == "*" {
		return true
	}
	re, err := regexp.Compile("^(?:" + matcher + ")$")
	return err == nil && re.MatchString(tool)
}

func (c *claudeChannels) close() {
	if c.mcp == nil {
		return
	}
	c.in.Close() // as Claude's exit does: the server ends on its stdin's end
	c.mcp.Wait()
}
