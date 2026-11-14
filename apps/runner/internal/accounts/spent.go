package accounts

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// sessionsKept is how many Sessions' costs the Runner keeps, the ones
// reported longest ago dropped beyond: a Session resumed that late counts
// again what it cost before.
const sessionsKept = 500

// sessionCost is what a Session of a Moteur reported of its cost so far.
type sessionCost struct {
	CostUsdMicros int       `json:"costUsdMicros"`
	At            time.Time `json:"at"`
}

func sessionKey(engineID contracts.EngineId, engineSessionID string) string {
	return string(engineID) + "/" + engineSessionID
}

// sessionSpent is the cost the Session `engineSessionID` of `engineID`
// reported so far, its runs before a resume included; false when it is
// unknown. Under r.mu.
func (r *Reporter) sessionSpent(engineID contracts.EngineId, engineSessionID string) (int, bool) {
	r.loadSpent()
	c, ok := r.spent[sessionKey(engineID, engineSessionID)]
	return c.CostUsdMicros, ok
}

// keepSessionSpent records what the Session reported of its cost so far,
// in SpentPath too. Under r.mu.
func (r *Reporter) keepSessionSpent(engineID contracts.EngineId, engineSessionID string, costUsdMicros int) {
	r.loadSpent()
	key := sessionKey(engineID, engineSessionID)
	if known, ok := r.spent[key]; ok && known.CostUsdMicros == costUsdMicros {
		return
	}
	r.spent[key] = sessionCost{CostUsdMicros: costUsdMicros, At: r.now()}
	if extra := len(r.spent) - sessionsKept; extra > 0 {
		keys := make([]string, 0, len(r.spent))
		for k := range r.spent {
			keys = append(keys, k)
		}
		sort.Slice(keys, func(i, j int) bool { return r.spent[keys[i]].At.Before(r.spent[keys[j]].At) })
		for _, k := range keys[:extra] {
			delete(r.spent, k)
		}
	}
	if err := r.saveSpent(); err != nil {
		r.logger().Warn("usage", "error", err)
	}
}

// loadSpent reads SpentPath once; a file missing or unreadable is an empty
// record. Under r.mu.
func (r *Reporter) loadSpent() {
	if r.spent != nil {
		return
	}
	r.spent = map[string]sessionCost{}
	if r.SpentPath == "" {
		return
	}
	data, err := os.ReadFile(r.SpentPath)
	if errors.Is(err, os.ErrNotExist) {
		return
	}
	if err == nil {
		err = json.Unmarshal(data, &r.spent)
	}
	if err != nil {
		r.spent = map[string]sessionCost{}
		r.logger().Warn("usage", "error", fmt.Errorf("read %s: %w", r.SpentPath, err))
	}
}

// saveSpent replaces SpentPath at once (mode 600). Under r.mu.
func (r *Reporter) saveSpent() error {
	if r.SpentPath == "" {
		return nil
	}
	data, err := json.Marshal(r.spent)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(r.SpentPath), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(r.SpentPath), filepath.Base(r.SpentPath)+".*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), r.SpentPath)
}
