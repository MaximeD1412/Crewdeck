package session

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// record is `<home>/sessions/<id>/session.json`, mode 600: what the Runner
// keeps of a Session to report it after a restart and to resume it. Its
// title is not kept: nothing reads it on the Runner.
type record struct {
	SessionID string `json:"sessionId"`
	// ProjectID, Branch and Base are "" for a scratch Session without them,
	// Origin nil (IDEE-2).
	ProjectID string            `json:"projectId"`
	Origin    *contracts.Origin `json:"origin"`
	Branch    string            `json:"branch"`
	Base      string            `json:"base"`
	// Worktree is the Session's folder: its worktree, or its scratch
	// folder when Scratch.
	Worktree        string                                     `json:"worktree"`
	Scratch         bool                                       `json:"scratch,omitempty"`
	Engine          contracts.RunnerSessionStartEngine         `json:"engine"`
	Model           string                                     `json:"model"`
	Role            string                                     `json:"role"`
	PermissionMode  contracts.RunnerSessionStartPermissionMode `json:"permissionMode"`
	Step            *contracts.RunnerSessionStartStep          `json:"step,omitempty"`
	EngineSessionID string                                     `json:"engineSessionId,omitempty"`
	State           contracts.RunnerSessionStateState          `json:"state"`
	Outcome         contracts.RunnerSessionStateOutcome        `json:"outcome,omitempty"`
	Error           contracts.RunnerSessionStateError          `json:"error,omitempty"`
	// WorktreeCommands are the Projet's sealed worktree Commandes the
	// session.start gave, kept for the worktree a resume makes again and
	// for its cleaning; nil for none.
	WorktreeCommands *SealedCommands `json:"worktreeCommands,omitempty"`
}

const recordFile = "session.json"

var sessionID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func sessionsDir(home string) string { return filepath.Join(home, "sessions") }

// sessionDir is the Session's folder, mode 700: its record, its log, the
// Moteur's control socket (RUNNER-5).
func sessionDir(home, id string) string { return filepath.Join(sessionsDir(home), id) }

func (r *record) save(home string) error {
	dir := sessionDir(home, r.SessionID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, recordFile+".*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), filepath.Join(dir, recordFile))
}

// loadRecords reads every Session the Runner kept; one it cannot read is
// skipped.
func loadRecords(home string) ([]*record, error) {
	entries, err := os.ReadDir(sessionsDir(home))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var records []*record
	for _, entry := range entries {
		if !entry.IsDir() || !sessionID.MatchString(entry.Name()) {
			continue
		}
		data, err := os.ReadFile(filepath.Join(sessionsDir(home), entry.Name(), recordFile))
		if err != nil {
			continue
		}
		var r record
		if json.Unmarshal(data, &r) != nil || r.SessionID != entry.Name() {
			continue
		}
		records = append(records, &r)
	}
	return records, nil
}
