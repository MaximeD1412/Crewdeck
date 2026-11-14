// Package mcp keeps the Serveurs MCP the Pilote declares on their Runner
// (US-73, ADR 0013): their configuration in ~/.crewdeck/mcp.json (mode 600),
// the values of their `--env` and `--header` in the OS keychain when one
// answers (service crewdeck-runner, user `mcp:<name>:env:<K>` or
// `mcp:<name>:header:<K>`), else in the file itself; and a minimal MCP
// client that lists a server's tools, for `crewdeck-runner mcp add` and
// `test`. The server only ever learns the names (risk SEC-13).
package mcp

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/accounts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

// FileName is the declarations' file in the Runner's folder.
const FileName = "mcp.json"

const fileVersion = 1

// Name is the rule of a Serveur MCP's name, as packages/contracts/src/runner/mcp.ts writes it.
var Name = regexp.MustCompile(`^[a-z0-9-]{1,40}$`)

// Transport is how the Runner speaks to a server.
type Transport string

const (
	TransportStdio Transport = "stdio"
	TransportHTTP  Transport = "http"
)

// State is the last test's outcome.
type State string

const (
	StateReady  State = "ready"
	StateFailed State = "failed"
)

var (
	// ErrExists: a server of this name is already declared.
	ErrExists = errors.New("mcp: already declared")
	// ErrUnknown: no server of this name is declared.
	ErrUnknown = errors.New("mcp: not declared")
)

// Server is a declaration with its secrets' values: what `add` takes and
// `Resolve` gives, never written nor sent as is.
type Server struct {
	Name      string
	Transport Transport
	// Command and Args start a stdio server, its Env added to the Runner's.
	Command string
	Args    []string
	Env     map[string]string
	// URL is a streamable HTTP server's, its Headers sent with each request.
	URL     string
	Headers map[string]string
}

// Secrets are the values of the server's env and headers.
func (s Server) Secrets() []string {
	var values []string
	for _, v := range s.Env {
		values = append(values, v)
	}
	for _, v := range s.Headers {
		values = append(values, v)
	}
	return values
}

// Declared is what may be shown of a declaration: no command, URL nor value.
type Declared struct {
	Name      string
	Transport Transport
	State     State
	// ToolCount is the last test's, nil when it failed.
	ToolCount *int
	TestedAt  *time.Time
	// Keys are the names of its env variables or headers, sorted.
	Keys []string
}

// secretRef is where a value is: in the keychain, or here.
type secretRef struct {
	Keychain bool    `json:"keychain,omitempty"`
	Value    *string `json:"value,omitempty"`
}

type declaration struct {
	Transport Transport            `json:"transport"`
	Command   string               `json:"command,omitempty"`
	Args      []string             `json:"args,omitempty"`
	Env       map[string]secretRef `json:"env,omitempty"`
	URL       string               `json:"url,omitempty"`
	Headers   map[string]secretRef `json:"headers,omitempty"`
	State     State                `json:"state"`
	ToolCount *int                 `json:"toolCount"`
	TestedAt  *time.Time           `json:"testedAt"`
}

type file struct {
	Version int                    `json:"version"`
	Servers map[string]declaration `json:"servers"`
}

// Store keeps the declarations; Dir is the Runner's folder (~/.crewdeck).
type Store struct {
	// Keyring is the keychain; nil, the OS's.
	Keyring accounts.Keyring
	Dir     string
}

// Default is the store of the OS keychain, in the Runner's folder
// (`$CREWDECK_HOME`, else `~/.crewdeck`).
func Default() (Store, error) {
	home, err := state.Default()
	if err != nil {
		return Store{}, err
	}
	return Store{Dir: home.Dir}, nil
}

func (s Store) keyring() accounts.Keyring {
	if s.Keyring == nil {
		return accounts.OSKeyring{}
	}
	return s.Keyring
}

func (s Store) path() string { return filepath.Join(s.Dir, FileName) }

func keychainUser(name, kind, key string) string { return "mcp:" + name + ":" + kind + ":" + key }

func (s Store) read() (file, error) {
	f := file{Version: fileVersion, Servers: map[string]declaration{}}
	data, err := os.ReadFile(s.path())
	if errors.Is(err, os.ErrNotExist) {
		return f, nil
	}
	if err != nil {
		return f, fmt.Errorf("mcp: read %s: %w", FileName, err)
	}
	if err := json.Unmarshal(data, &f); err != nil {
		return f, fmt.Errorf("mcp: read %s: %w", FileName, err)
	}
	if f.Servers == nil {
		f.Servers = map[string]declaration{}
	}
	return f, nil
}

// write replaces mcp.json at once (mode 600, its folder 700): a crash never
// leaves half a file.
func (s Store) write(f file) error {
	data, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return fmt.Errorf("mcp: encode: %w", err)
	}
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return fmt.Errorf("mcp: create %s: %w", s.Dir, err)
	}
	tmp, err := os.CreateTemp(s.Dir, FileName+".*")
	if err != nil {
		return fmt.Errorf("mcp: write %s: %w", FileName, err)
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("mcp: chmod %s: %w", FileName, err)
	}
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		return fmt.Errorf("mcp: write %s: %w", FileName, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("mcp: write %s: %w", FileName, err)
	}
	if err := os.Rename(tmp.Name(), s.path()); err != nil {
		return fmt.Errorf("mcp: write %s: %w", FileName, err)
	}
	return nil
}

// Load gives the declarations, by name; none without a file.
func (s Store) Load() ([]Declared, error) {
	f, err := s.read()
	if err != nil {
		return nil, err
	}
	declared := make([]Declared, 0, len(f.Servers))
	for name, d := range f.Servers {
		keys := make([]string, 0, len(d.Env)+len(d.Headers))
		for k := range d.Env {
			keys = append(keys, k)
		}
		for k := range d.Headers {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		declared = append(declared, Declared{Name: name, Transport: d.Transport, State: d.State, ToolCount: d.ToolCount, TestedAt: d.TestedAt, Keys: keys})
	}
	sort.Slice(declared, func(i, j int) bool { return declared[i].Name < declared[j].Name })
	return declared, nil
}

// Names are the declared servers' names, sorted.
func (s Store) Names() ([]string, error) {
	declared, err := s.Load()
	if err != nil {
		return nil, err
	}
	names := make([]string, len(declared))
	for i, d := range declared {
		names[i] = d.Name
	}
	return names, nil
}

// Add declares a server, `failed` until a test records it; ErrExists when its
// name is taken. Each value goes to the keychain, or to the file when the
// keychain does not answer.
func (s Store) Add(server Server) error {
	f, err := s.read()
	if err != nil {
		return err
	}
	if _, ok := f.Servers[server.Name]; ok {
		return ErrExists
	}
	d := declaration{Transport: server.Transport, Command: server.Command, Args: server.Args, URL: server.URL, State: StateFailed}
	var stored []string
	keep := func(kind string, values map[string]string) map[string]secretRef {
		if len(values) == 0 {
			return nil
		}
		refs := make(map[string]secretRef, len(values))
		for k, v := range values {
			user := keychainUser(server.Name, kind, k)
			if err := s.keyring().Set(accounts.Service, user, v); err == nil {
				refs[k] = secretRef{Keychain: true}
				stored = append(stored, user)
				continue
			}
			value := v
			refs[k] = secretRef{Value: &value}
		}
		return refs
	}
	d.Env = keep("env", server.Env)
	d.Headers = keep("header", server.Headers)
	f.Servers[server.Name] = d
	if err := s.write(f); err != nil {
		// The keychain keeps nothing of a declaration that was not saved.
		for _, user := range stored {
			_ = s.keyring().Delete(accounts.Service, user)
		}
		return err
	}
	return nil
}

// Record keeps a test's outcome: its tool count, nil when it failed.
func (s Store) Record(name string, toolCount *int, at time.Time) error {
	f, err := s.read()
	if err != nil {
		return err
	}
	d, ok := f.Servers[name]
	if !ok {
		return ErrUnknown
	}
	d.State, d.ToolCount, d.TestedAt = StateFailed, nil, &at
	if toolCount != nil {
		count := *toolCount
		d.State, d.ToolCount = StateReady, &count
	}
	f.Servers[name] = d
	return s.write(f)
}

// Resolve gives a declaration with its values, read from the keychain or the file.
func (s Store) Resolve(name string) (Server, error) {
	f, err := s.read()
	if err != nil {
		return Server{}, err
	}
	d, ok := f.Servers[name]
	if !ok {
		return Server{}, ErrUnknown
	}
	server := Server{Name: name, Transport: d.Transport, Command: d.Command, Args: d.Args, URL: d.URL}
	open := func(kind string, refs map[string]secretRef) (map[string]string, error) {
		if len(refs) == 0 {
			return nil, nil
		}
		values := make(map[string]string, len(refs))
		for k, ref := range refs {
			switch {
			case ref.Value != nil:
				values[k] = *ref.Value
			case ref.Keychain:
				v, err := s.keyring().Get(accounts.Service, keychainUser(name, kind, k))
				if err != nil {
					return nil, fmt.Errorf("mcp: read %s of %s from the keychain: %w", k, name, err)
				}
				values[k] = v
			}
		}
		return values, nil
	}
	if server.Env, err = open("env", d.Env); err != nil {
		return Server{}, err
	}
	if server.Headers, err = open("header", d.Headers); err != nil {
		return Server{}, err
	}
	return server, nil
}

// deleteSecrets removes a declaration's keychain entries; one already gone
// is not an error, a keychain that refuses is.
func (s Store) deleteSecrets(name string, d declaration) error {
	for kind, refs := range map[string]map[string]secretRef{"env": d.Env, "header": d.Headers} {
		for k, ref := range refs {
			if !ref.Keychain {
				continue
			}
			err := s.keyring().Delete(accounts.Service, keychainUser(name, kind, k))
			if err != nil && !errors.Is(err, accounts.ErrKeyringNotFound) {
				return fmt.Errorf("mcp: delete %s of %s from the keychain: %w", k, name, err)
			}
		}
	}
	return nil
}

// Remove deletes a declaration, its keychain entries first: a keychain that
// refuses leaves it declared. ErrUnknown when no server has this name.
func (s Store) Remove(name string) error {
	f, err := s.read()
	if err != nil {
		return err
	}
	d, ok := f.Servers[name]
	if !ok {
		return ErrUnknown
	}
	if err := s.deleteSecrets(name, d); err != nil {
		return err
	}
	delete(f.Servers, name)
	return s.write(f)
}

// DeleteSecrets removes every declaration's keychain entries, leaving the
// file (`uninstall`, which removes the folder next).
func (s Store) DeleteSecrets() error {
	f, err := s.read()
	if err != nil {
		return err
	}
	names := make([]string, 0, len(f.Servers))
	for name := range f.Servers {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if err := s.deleteSecrets(name, f.Servers[name]); err != nil {
			return err
		}
	}
	return nil
}

// Report is what `mcp.servers` says of the declarations: names, transports,
// states and tool counts, nothing else.
func Report(declared []Declared) []contracts.RunnerMcpServersServersElem {
	servers := make([]contracts.RunnerMcpServersServersElem, len(declared))
	for i, d := range declared {
		servers[i] = contracts.RunnerMcpServersServersElem{
			Name:      d.Name,
			Transport: contracts.RunnerMcpServersServersElemTransport(d.Transport),
			State:     contracts.RunnerMcpServersServersElemState(d.State),
		}
		if d.ToolCount != nil {
			servers[i].ToolCount = *d.ToolCount
		}
	}
	return servers
}
