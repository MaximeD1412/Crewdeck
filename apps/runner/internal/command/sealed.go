package command

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
)

// opened is a Commande as the Runner opened it: the only text it runs, and
// the only place it runs it.
type opened struct {
	Run   string
	Where contracts.ProcessSealedCommandsValueWhere
}

// runMax is the longest text of a Commande (zProcessSealedPayload's `run`),
// in UTF-16 code units as zod counts a string's length.
const runMax = 10000

// processID is zProcessId: a Commande's id in the sealed part.
var processID = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

var errSealed = errors.New("command: the sealed part does not open")

// openSealed opens the message's sealed part with the vault, under the
// additional data `process:<projectId>` of the message's own projectId (a
// version of another Projet does not open), checks the whole of it against
// zSealedCommands (every Commande, no property it does not name) and gives
// its Commande `commandId`. Any failure is errSealed: nothing runs.
func openSealed(vault Vault, message contracts.RunnerCommandRun) (opened, error) {
	if vault == nil || !uuid.MatchString(message.ProjectId) {
		return opened{}, errSealed
	}
	key, err1 := base64.RawURLEncoding.Strict().DecodeString(message.Sealed.Key)
	ciphertext, err2 := base64.RawURLEncoding.Strict().DecodeString(message.Sealed.Ciphertext)
	if err1 != nil || err2 != nil {
		return opened{}, errSealed
	}
	plain, err := vault.OpenItem(keys.SealedItem{Key: key, Ciphertext: ciphertext}, []byte("process:"+message.ProjectId))
	if err != nil {
		return opened{}, errSealed
	}
	commands, ok := sealedCommands(plain)
	if !ok {
		return opened{}, errSealed
	}
	command, ok := commands[message.CommandId]
	if !ok {
		return opened{}, errSealed
	}
	return command, nil
}

// sealedCommands is the sealed part's Commandes when the whole of it is
// zSealedCommands: an object of `commands` only, each key a zProcessId,
// each value an object of `run` (1 to runMax), `where` (`project` or
// `worktree`) and an optional `healthUrl` (an http(s) URL), nothing else.
func sealedCommands(plain []byte) (map[string]opened, bool) {
	top, ok := object(plain, "commands")
	if !ok || top["commands"] == nil {
		return nil, false
	}
	entries, ok := object(top["commands"], "")
	if !ok {
		return nil, false
	}
	commands := make(map[string]opened, len(entries))
	for id, raw := range entries {
		if len(id) > 40 || !processID.MatchString(id) {
			return nil, false
		}
		fields, ok := object(raw, "run", "where", "healthUrl")
		if !ok {
			return nil, false
		}
		run, ok1 := jsonString(fields["run"])
		where, ok2 := jsonString(fields["where"])
		if !ok1 || !ok2 || run == "" || utf16Len(run) > runMax {
			return nil, false
		}
		if where != string(contracts.ProcessSealedCommandsValueWhereProject) && where != string(contracts.ProcessSealedCommandsValueWhereWorktree) {
			return nil, false
		}
		if raw, given := fields["healthUrl"]; given {
			health, ok := jsonString(raw)
			if !ok || !httpURL(health) {
				return nil, false
			}
		}
		commands[id] = opened{Run: run, Where: contracts.ProcessSealedCommandsValueWhere(where)}
	}
	return commands, true
}

// object decodes raw as a JSON object whose keys are all in names (any key
// when names is only ""); null or another JSON value is not one.
func object(raw json.RawMessage, names ...string) (map[string]json.RawMessage, bool) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || raw[0] != '{' {
		return nil, false
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return nil, false
	}
	if len(names) == 1 && names[0] == "" {
		return fields, true
	}
	for name := range fields {
		if !slices.Contains(names, name) {
			return nil, false
		}
	}
	return fields, true
}

// jsonString decodes raw as a JSON string; absent, null or another value is not one.
func jsonString(raw json.RawMessage) (string, bool) {
	raw = bytes.TrimSpace(raw)
	var s string
	if len(raw) == 0 || raw[0] != '"' || json.Unmarshal(raw, &s) != nil {
		return "", false
	}
	return s, true
}

func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		n += utf16.RuneLen(r)
	}
	return n
}

// httpURL says whether s is a `healthUrl` of zSealedCommands, where zod's
// `z.url({ protocol: /^https?$/ })` wants `http://` or `https://` and an
// address the WHATWG parser accepts. The Runner accepts a part of what zod
// accepts, never more: no space, control nor backslash anywhere, no user
// nor password, an ASCII host of non-empty labels (no `xn--` one) or an IP
// (a host ending in a number is a dotted quad), a port of 0 to 65535. The
// cases both sides read: packages/contracts/fixtures/process-sealed.
func httpURL(s string) bool {
	var rest string
	switch lower := strings.ToLower(s); {
	case strings.HasPrefix(lower, "http://"):
		rest = s[len("http://"):]
	case strings.HasPrefix(lower, "https://"):
		rest = s[len("https://"):]
	default:
		return false
	}
	for _, r := range rest {
		if r <= ' ' || r == '\\' || unicode.IsControl(r) || r == utf8.RuneError {
			return false
		}
	}
	authority := rest
	if i := strings.IndexAny(rest, "/?#"); i >= 0 {
		authority = rest[:i]
	}
	if strings.Contains(authority, "@") {
		return false
	}
	host, port := authority, ""
	if strings.HasPrefix(authority, "[") {
		end := strings.IndexByte(authority, ']')
		if end < 0 {
			return false
		}
		host, port = authority[1:end], authority[end+1:]
		if ip := net.ParseIP(host); ip == nil || !strings.Contains(host, ":") {
			return false
		}
		if port != "" && !strings.HasPrefix(port, ":") {
			return false
		}
		port = strings.TrimPrefix(port, ":")
	} else {
		if i := strings.LastIndexByte(authority, ':'); i >= 0 {
			host, port = authority[:i], authority[i+1:]
		}
		if !hostName(host) {
			return false
		}
	}
	return validPort(port)
}

var hostLabel = regexp.MustCompile(`^[A-Za-z0-9_~-]+$`)

// hostName is an ASCII host of non-empty labels, none `xn--`; one whose last
// label is a number (WHATWG then reads it as IPv4) only as a dotted quad.
func hostName(host string) bool {
	labels := strings.Split(host, ".")
	for _, label := range labels {
		if !hostLabel.MatchString(label) || strings.HasPrefix(strings.ToLower(label), "xn--") {
			return false
		}
	}
	last := strings.ToLower(labels[len(labels)-1])
	if strings.Trim(last, "0123456789") == "" || strings.HasPrefix(last, "0x") {
		ip := net.ParseIP(host)
		return ip != nil && ip.To4() != nil && !strings.Contains(host, ":")
	}
	return true
}

// validPort is an empty port or digits of 0 to 65535.
func validPort(port string) bool {
	if strings.Trim(port, "0123456789") != "" {
		return false
	}
	port = strings.TrimLeft(port, "0")
	if port == "" {
		return true
	}
	n, err := strconv.Atoi(port)
	return err == nil && len(port) <= 5 && n <= 65535
}
