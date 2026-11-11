package claude

import (
	"encoding/json"
	"math"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// parser turns the lines of `--output-format stream-json` into normalised
// events, following the mapping of docs/spikes/engines.md (scenario 1). It
// is used by one goroutine, the one reading stdout; its events have no seq
// nor at yet, and their raw is the line.
type parser struct {
	sessionID string
	// turnError is set once the turn emitted an error of its own (an
	// assistant line with an `error`), so that its result adds none.
	turnError bool
	// refusedModel is called when the binary says the model does not exist
	// or is not in the plan.
	refusedModel func()
}

type line struct {
	Type      string          `json:"type"`
	Subtype   string          `json:"subtype"`
	SessionID string          `json:"session_id"`
	Error     string          `json:"error"`
	Event     json.RawMessage `json:"event"`
	Message   struct {
		Content json.RawMessage `json:"content"`
	} `json:"message"`
	RateLimitInfo *rateLimitInfo `json:"rate_limit_info"`

	// result
	IsError        bool     `json:"is_error"`
	Result         *string  `json:"result"`
	TerminalReason string   `json:"terminal_reason"`
	TotalCostUSD   *float64 `json:"total_cost_usd"`
	Usage          *struct {
		InputTokens              int `json:"input_tokens"`
		CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
		CacheReadInputTokens     int `json:"cache_read_input_tokens"`
		OutputTokens             int `json:"output_tokens"`
	} `json:"usage"`
}

type rateLimitInfo struct {
	Status         string `json:"status"`
	ResetsAt       *int64 `json:"resetsAt"`
	RateLimitType  string `json:"rateLimitType"`
	UnifiedWindows map[string]struct {
		Utilization *float64 `json:"utilization"`
		ResetsAt    *int64   `json:"resetsAt"`
		Status      string   `json:"status"`
	} `json:"unifiedWindows"`
}

type block struct {
	Type      string          `json:"type"`
	Text      string          `json:"text"`
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Input     json.RawMessage `json:"input"`
	ToolUseID string          `json:"tool_use_id"`
	IsError   bool            `json:"is_error"`
	Content   json.RawMessage `json:"content"`
}

// parse gives the events of one line; interrupted says whether the
// Runner interrupted the turn in progress.
func (p *parser) parse(raw []byte, interrupted bool) []contracts.EngineEvent {
	var l line
	if err := json.Unmarshal(raw, &l); err != nil {
		return nil // not a line of the stream: nothing to show
	}
	r := json.RawMessage(append([]byte(nil), raw...))
	switch l.Type {
	case "system":
		if l.Subtype == "init" && l.SessionID != "" {
			p.sessionID = l.SessionID
		}
	case "stream_event":
		var event struct {
			Type  string `json:"type"`
			Delta struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"delta"`
		}
		if json.Unmarshal(l.Event, &event) == nil && event.Type == "content_block_delta" && event.Delta.Type == "text_delta" && event.Delta.Text != "" {
			return []contracts.EngineEvent{{Message: &contracts.EngineEventMessage{Kind: contracts.EngineEventKindMessage, From: "agent", Text: event.Delta.Text, Raw: r}}}
		}
	case "assistant":
		return p.assistant(l, r)
	case "user":
		return userEvents(l, r)
	case "rate_limit_event":
		return rateLimitEvents(l.RateLimitInfo, r)
	case "result":
		return p.result(l, r, interrupted)
	}
	return nil
}

func (p *parser) assistant(l line, raw json.RawMessage) []contracts.EngineEvent {
	blocks := blocksOf(l.Message.Content)
	if l.Error != "" {
		p.turnError = true
		var text []string
		for _, b := range blocks {
			if b.Type == "text" {
				text = append(text, b.Text)
			}
		}
		message := strings.Join(text, "\n")
		switch l.Error {
		case "authentication_failed":
			return []contracts.EngineEvent{{AuthRequired: &contracts.EngineEventAuthRequired{Kind: contracts.EngineEventKindAuthRequired, Reason: message, Raw: raw}}}
		case "rate_limit":
			return []contracts.EngineEvent{{LimitReached: &contracts.EngineEventLimitReached{Kind: contracts.EngineEventKindLimitReached, Window: contracts.EngineEventLimitReachedWindowUnknown, Raw: raw}}}
		case "model_not_found":
			if p.refusedModel != nil {
				p.refusedModel()
			}
		}
		return []contracts.EngineEvent{{Error: &contracts.EngineEventError{Kind: contracts.EngineEventKindError, Code: l.Error, Message: message, Raw: raw}}}
	}
	var events []contracts.EngineEvent
	for _, b := range blocks {
		switch b.Type {
		case "text":
			if b.Text != "" {
				events = append(events, contracts.EngineEvent{Message: &contracts.EngineEventMessage{Kind: contracts.EngineEventKindMessage, From: "agent", Text: b.Text, Final: true, Raw: raw}})
			}
		case "tool_use":
			target, detail := describe(b.Name, b.Input)
			events = append(events, contracts.EngineEvent{ToolCall: &contracts.EngineEventToolCall{Kind: contracts.EngineEventKindToolCall, CallId: b.ID, Tool: b.Name, Target: target, Detail: detail, Raw: raw}})
		}
	}
	return events
}

func userEvents(l line, raw json.RawMessage) []contracts.EngineEvent {
	var events []contracts.EngineEvent
	for _, b := range blocksOf(l.Message.Content) {
		if b.Type != "tool_result" {
			continue
		}
		result := &contracts.EngineEventToolResult{Kind: contracts.EngineEventKindToolResult, CallId: b.ToolUseID, Ok: !b.IsError, Raw: raw}
		if text := textOf(b.Content); text != "" {
			result.Detail = &text
		}
		events = append(events, contracts.EngineEvent{ToolResult: result})
	}
	return events
}

// rateLimitEvents gives the usage of the subscription's windows and, when
// the binary says a limit is reached, a limit-reached.
func rateLimitEvents(info *rateLimitInfo, raw json.RawMessage) []contracts.EngineEvent {
	if info == nil {
		return nil
	}
	var events []contracts.EngineEvent
	usage := &contracts.EngineEventUsage{Kind: contracts.EngineEventKindUsage, Raw: raw}
	for _, w := range []struct {
		key string
		id  contracts.EngineEventUsageWindowsElemId
	}{{"five_hour", contracts.EngineEventUsageWindowsElemIdFiveHour}, {"seven_day", contracts.EngineEventUsageWindowsElemIdWeek}} {
		window, ok := info.UnifiedWindows[w.key]
		if !ok || window.Utilization == nil || window.ResetsAt == nil {
			continue
		}
		usage.Windows = append(usage.Windows, contracts.EngineEventUsageWindowsElem{
			Id:          w.id,
			UsedPercent: math.Round(*window.Utilization*10000) / 100,
			ResetsAt:    time.Unix(*window.ResetsAt, 0).UTC(),
		})
	}
	if len(usage.Windows) > 0 {
		events = append(events, contracts.EngineEvent{Usage: usage})
	}
	if info.Status != "" && info.Status != "allowed" && info.Status != "allowed_warning" {
		reached := &contracts.EngineEventLimitReached{Kind: contracts.EngineEventKindLimitReached, Window: windowOf(info.RateLimitType), Raw: raw}
		if info.ResetsAt != nil {
			at := time.Unix(*info.ResetsAt, 0).UTC()
			reached.ResetsAt = &at
		}
		events = append(events, contracts.EngineEvent{LimitReached: reached})
	}
	return events
}

func windowOf(rateLimitType string) contracts.EngineEventLimitReachedWindow {
	switch {
	case rateLimitType == "five_hour":
		return contracts.EngineEventLimitReachedWindowFiveHour
	case strings.HasPrefix(rateLimitType, "seven_day"):
		return contracts.EngineEventLimitReachedWindowWeek
	}
	return contracts.EngineEventLimitReachedWindowUnknown
}

// result gives the turn's usage, then its result, and, for a turn that
// failed with no error of its own, an error saying why.
func (p *parser) result(l line, raw json.RawMessage, interrupted bool) []contracts.EngineEvent {
	defer func() { p.turnError = false }()
	var events []contracts.EngineEvent
	var cost *int
	if l.TotalCostUSD != nil {
		micros := int(math.Round(*l.TotalCostUSD * 1e6))
		cost = &micros
	}
	if l.Usage != nil || cost != nil {
		usage := &contracts.EngineEventUsage{Kind: contracts.EngineEventKindUsage, CostUsdMicros: cost, Raw: raw}
		if l.Usage != nil {
			input := l.Usage.InputTokens + l.Usage.CacheCreationInputTokens + l.Usage.CacheReadInputTokens
			output := l.Usage.OutputTokens
			usage.InputTokens, usage.OutputTokens = &input, &output
		}
		events = append(events, contracts.EngineEvent{Usage: usage})
	}

	status := contracts.EngineEventResultStatusOk
	switch {
	case (interrupted && l.IsError) || strings.HasPrefix(l.TerminalReason, "aborted"):
		status = contracts.EngineEventResultStatusInterrupted
	case l.IsError:
		status = contracts.EngineEventResultStatusError
		if !p.turnError {
			code := l.TerminalReason
			if code == "" {
				code = l.Subtype
			}
			message := "Claude Code a terminé le tour sur une erreur."
			if l.Result != nil && *l.Result != "" {
				message = *l.Result
			}
			events = append(events, contracts.EngineEvent{Error: &contracts.EngineEventError{Kind: contracts.EngineEventKindError, Code: code, Message: message, Raw: raw}})
		}
	}
	result := &contracts.EngineEventResult{Kind: contracts.EngineEventKindResult, Status: status, CostUsdMicros: cost, Raw: raw}
	if id := l.SessionID; id != "" {
		result.EngineSessionId = &id
	} else if p.sessionID != "" {
		id := p.sessionID
		result.EngineSessionId = &id
	}
	return append(events, contracts.EngineEvent{Result: result})
}

func blocksOf(content json.RawMessage) []block {
	var blocks []block
	if json.Unmarshal(content, &blocks) == nil {
		return blocks
	}
	var text string
	if json.Unmarshal(content, &text) == nil && text != "" {
		return []block{{Type: "text", Text: text}}
	}
	return nil
}

// textOf is the text of a tool result's content, a string or text blocks.
func textOf(content json.RawMessage) string {
	var text string
	if json.Unmarshal(content, &text) == nil {
		return text
	}
	var parts []string
	for _, b := range blocksOf(content) {
		if b.Type == "text" {
			parts = append(parts, b.Text)
		}
	}
	return strings.Join(parts, "\n")
}

// describe gives a tool call's target (what it acts on) and detail (what the
// agent says it does), from the input's fields the tool has.
func describe(tool string, input json.RawMessage) (target, detail *string) {
	var fields map[string]any
	if json.Unmarshal(input, &fields) != nil {
		return nil, nil
	}
	pick := func(keys ...string) *string {
		for _, key := range keys {
			if s, ok := fields[key].(string); ok && s != "" {
				return &s
			}
		}
		return nil
	}
	switch tool {
	case "Bash":
		target = pick("command")
	case "Read", "Write", "Edit", "MultiEdit", "NotebookEdit":
		target = pick("file_path", "notebook_path")
	case "Glob", "Grep":
		target = pick("pattern")
	case "WebFetch":
		target = pick("url")
	case "WebSearch":
		target = pick("query")
	case "Skill":
		target = pick("skill", "command")
	case "Task", "Agent":
		target = pick("description")
		return target, nil
	default:
		target = pick("file_path", "path", "command", "url", "pattern")
	}
	return target, pick("description")
}

// commandOf is what a permission request shows of the call: the command, the
// file, else the input itself.
func commandOf(input json.RawMessage) string {
	var fields map[string]any
	if json.Unmarshal(input, &fields) == nil {
		for _, key := range []string{"command", "file_path", "notebook_path", "url", "pattern"} {
			if s, ok := fields[key].(string); ok && s != "" {
				return s
			}
		}
	}
	compact, err := json.Marshal(json.RawMessage(input))
	if err != nil {
		return string(input)
	}
	return string(compact)
}
