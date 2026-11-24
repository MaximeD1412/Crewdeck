package migration

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// The stages of a migration, as its progress file says them.
const (
	stageCopying   = "copying"
	stageVerifying = "verifying"
	stageSwitched  = "switched"
	stageFrozen    = "frozen"
	stageFinished  = "finished"
)

// progress is a migration as this Runner moved it so far, in
// `<home>/migrations/<migrationId>.json` (mode 600): `migration.finish`
// carries only the migration's id, and a restart resumes from it. Numbers
// only, never a title nor a body.
type progress struct {
	MigrationID string `json:"migrationId"`
	ProjectID   string `json:"projectId"`
	From        string `json:"from"`
	To          string `json:"to"`
	Owner       string `json:"owner,omitempty"`
	Name        string `json:"name,omitempty"`
	Stage       string `json:"stage"`
	// Group is the group moved: `ticket` ("" in a progress written before
	// SOURCE-9) or `code`.
	Group string `json:"group,omitempty"`
	// Release and Integration are the Projet's branches, for the code: the
	// release one pushed first, the integration one checked out.
	Release     string `json:"release,omitempty"`
	Integration string `json:"integration,omitempty"`
	// Folder is the folder the code is cloned into on its way to Local,
	// recorded at the first copy: a retry continues there, even once the
	// folder picked is no longer held pending.
	Folder string `json:"folder,omitempty"`
	// CheckedOut is whether the folder's work tree holds a branch: the
	// integration one once the clone checked it out, the Pilote's own in a
	// folder that had commits.
	CheckedOut bool `json:"checkedOut,omitempty"`
	// Dir is where the Local side is read: `tickets/`, its archive once frozen.
	Dir string `json:"dir,omitempty"`
	// Archive is the name the Local side is frozen under, kept before the
	// rename: a finish cut after it finds the archive again.
	Archive string `json:"archive,omitempty"`
	// Switched is each milestone of the old place, by its number there, as
	// the switch saw it: the finish writes over the new Source only what
	// changed since.
	Switched map[int]switchedMilestone `json:"switched,omitempty"`
	// Tickets and Milestones are each old number to its new one.
	Tickets    map[int]int `json:"tickets"`
	Milestones map[int]int `json:"milestones"`
	// Changes are each open change's old number to its new one (the code).
	Changes map[int]int `json:"changes,omitempty"`
}

func progressPath(home, migrationID string) string {
	return filepath.Join(home, "migrations", migrationID+".json")
}

// loadProgress is the migration's progress; false when none was written.
func loadProgress(home, migrationID string) (*progress, bool, error) {
	data, err := os.ReadFile(progressPath(home, migrationID))
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("migration: read its progress: %w", err)
	}
	var p progress
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, false, fmt.Errorf("migration: read its progress: %w", err)
	}
	if p.Tickets == nil {
		p.Tickets = map[int]int{}
	}
	if p.Milestones == nil {
		p.Milestones = map[int]int{}
	}
	if p.Changes == nil {
		p.Changes = map[int]int{}
	}
	return &p, true, nil
}

// save writes the progress whole, readable by its owner only.
func (p *progress) save(home string) error {
	path := progressPath(home, p.MigrationID)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("migration: write its progress: %w", err)
	}
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".progress-*.tmp")
	if err != nil {
		return fmt.Errorf("migration: write its progress: %w", err)
	}
	defer os.Remove(tmp.Name())
	_, err = tmp.Write(data)
	if err == nil {
		err = tmp.Chmod(0o600)
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(tmp.Name(), path)
	}
	if err != nil {
		return fmt.Errorf("migration: write its progress: %w", err)
	}
	return nil
}
