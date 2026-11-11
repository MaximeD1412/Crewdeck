// Package state keeps what the Runner knows of its link to the server, in
// ~/.crewdeck/ (ADR 0004): runner.json holds the server, the Runner's id and
// its token, readable by the Pilote only.
package state

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// HomeEnv overrides the folder of the state (tests, a second Runner).
const HomeEnv = "CREWDECK_HOME"

// FileName is the state's file in its folder.
const FileName = "runner.json"

const (
	dirMode  os.FileMode = 0o700
	fileMode os.FileMode = 0o600
)

// ErrNotLinked is returned by Load when the Runner was never linked.
var ErrNotLinked = errors.New("state: the Runner is not linked")

// State is the content of runner.json.
type State struct {
	Server   string `json:"server"`
	RunnerID string `json:"runnerId"`
	Token    string `json:"token"`
}

// Store reads and writes the state in Dir.
type Store struct {
	Dir string
}

// Default is the store of $CREWDECK_HOME, else of ~/.crewdeck.
func Default() (Store, error) {
	if dir := os.Getenv(HomeEnv); dir != "" {
		return Store{Dir: dir}, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return Store{}, fmt.Errorf("state: home folder: %w", err)
	}
	return Store{Dir: filepath.Join(home, ".crewdeck")}, nil
}

// Path is the path of runner.json.
func (s Store) Path() string {
	return filepath.Join(s.Dir, FileName)
}

// Load reads runner.json; ErrNotLinked when it does not exist.
func (s Store) Load() (State, error) {
	data, err := os.ReadFile(s.Path())
	if errors.Is(err, os.ErrNotExist) {
		return State{}, ErrNotLinked
	}
	if err != nil {
		return State{}, fmt.Errorf("state: read %s: %w", FileName, err)
	}
	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		return State{}, fmt.Errorf("state: decode %s: %w", FileName, err)
	}
	if state.Server == "" || state.Token == "" {
		return State{}, fmt.Errorf("state: %s lacks its server or its token", FileName)
	}
	return state, nil
}

// Save writes runner.json (mode 600) in its folder (mode 700), replacing the
// one before at once: a crash never leaves half a file.
func (s Store) Save(state State) error {
	if err := os.MkdirAll(s.Dir, dirMode); err != nil {
		return fmt.Errorf("state: create %s: %w", s.Dir, err)
	}
	// MkdirAll keeps the mode of a folder that already exists.
	if err := os.Chmod(s.Dir, dirMode); err != nil {
		return fmt.Errorf("state: chmod %s: %w", s.Dir, err)
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("state: encode: %w", err)
	}
	tmp, err := os.CreateTemp(s.Dir, FileName+".*")
	if err != nil {
		return fmt.Errorf("state: write %s: %w", FileName, err)
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(fileMode); err != nil {
		tmp.Close()
		return fmt.Errorf("state: chmod %s: %w", FileName, err)
	}
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		return fmt.Errorf("state: write %s: %w", FileName, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("state: write %s: %w", FileName, err)
	}
	if err := os.Rename(tmp.Name(), s.Path()); err != nil {
		return fmt.Errorf("state: write %s: %w", FileName, err)
	}
	return nil
}
