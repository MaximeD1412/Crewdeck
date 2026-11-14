package accounts

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// sessionsKeptFor is how long the Runner keeps the cost of a Session it has
// not heard from: Claude Code deletes a Session's transcript after
// `cleanupPeriodDays` (30 days by default), so a Session silent for a year
// can no longer be resumed.
const sessionsKeptFor = 365 * 24 * time.Hour

// spentCompactAfter is how many lines the file of the costs (SpentPath)
// may hold beyond the live ones before it is rewritten.
const spentCompactAfter = 1000

// sessionCost is what a Session of a Moteur reported of its cost so far.
type sessionCost struct {
	CostUsdMicros int
	At            time.Time
}

// spentLine is a line of SpentPath, appended as it happens: what a Session
// reported of its cost so far and the spend it sends for it, written
// together before the spend is sent; or the spend the server acked.
type spentLine struct {
	Session       string                 `json:"session,omitempty"`
	CostUsdMicros int                    `json:"costUsdMicros,omitempty"`
	At            time.Time              `json:"at,omitzero"`
	Spend         *contracts.RunnerUsage `json:"spend,omitempty"`
	Acked         string                 `json:"acked,omitempty"`
}

func sessionKey(engineID contracts.EngineId, engineSessionID string) string {
	return string(engineID) + "/" + engineSessionID
}

// sessionSpent is the cost the Session `key` reported so far, its runs
// before a resume included; false when it is unknown. Under r.mu.
func (r *Reporter) sessionSpent(key string) (int, bool) {
	r.loadSpent()
	c, ok := r.spent[key]
	return c.CostUsdMicros, ok
}

// keepSpent records what the Session `key` ("" for none named) reported of
// its cost so far, and `spend`, when not nil, as waiting to be sent: in
// SpentPath too, in one line, so that a restart neither counts the cost
// again nor loses the spend. Under r.mu.
func (r *Reporter) keepSpent(key string, costUsdMicros int, spend *contracts.RunnerUsage) {
	r.loadSpent()
	line := spentLine{Spend: spend}
	if key != "" {
		if known, ok := r.spent[key]; !ok || known.CostUsdMicros != costUsdMicros {
			line.Session, line.CostUsdMicros, line.At = key, costUsdMicros, r.now()
			r.spent[key] = sessionCost{CostUsdMicros: costUsdMicros, At: line.At}
		}
	}
	if spend != nil {
		r.pending = append(r.pending, *spend)
	}
	if line.Session != "" || line.Spend != nil {
		r.appendSpent(line)
	}
}

// isPending: the spend `id` waits to be sent. Under r.mu.
func (r *Reporter) isPending(id string) bool {
	return slices.ContainsFunc(r.pending, func(m contracts.RunnerUsage) bool { return m.Id == id })
}

// spendAcked records that the server acked the spend `id`. Under r.mu.
func (r *Reporter) spendAcked(id string) {
	r.pending = slices.DeleteFunc(r.pending, func(m contracts.RunnerUsage) bool { return m.Id == id })
	r.appendSpent(spentLine{Acked: id})
}

// loadSpent reads SpentPath once, then rewrites it with what is still
// live: a line cut by a crash is skipped, and no append follows it. A file
// missing or unreadable is an empty record. Under r.mu.
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
	if err != nil {
		r.logger().Warn("usage", "error", fmt.Errorf("read %s: %w", r.SpentPath, err))
		return
	}
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(nil, len(data)+1)
	for scanner.Scan() {
		var line spentLine
		if err := json.Unmarshal(scanner.Bytes(), &line); err != nil {
			r.logger().Warn("usage", "error", fmt.Errorf("read %s: %w", r.SpentPath, err))
			continue
		}
		if line.Session != "" {
			r.spent[line.Session] = sessionCost{CostUsdMicros: line.CostUsdMicros, At: line.At}
		}
		if line.Spend != nil {
			r.pending = append(r.pending, *line.Spend)
		}
		if line.Acked != "" {
			r.pending = slices.DeleteFunc(r.pending, func(m contracts.RunnerUsage) bool { return m.Id == line.Acked })
		}
	}
	forgotten := r.now().Add(-sessionsKeptFor)
	for key, c := range r.spent {
		if c.At.Before(forgotten) {
			delete(r.spent, key)
		}
	}
	r.compactSpent()
}

// appendSpent appends `line` to SpentPath, rewritten once it holds too many
// lines no longer live. Under r.mu.
func (r *Reporter) appendSpent(line spentLine) {
	if r.SpentPath == "" {
		return
	}
	if r.spentLines >= len(r.spent)+len(r.pending)+spentCompactAfter {
		r.compactSpent()
	}
	err := func() error {
		data, err := json.Marshal(line)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(r.SpentPath), 0o700); err != nil {
			return err
		}
		f, err := os.OpenFile(r.SpentPath, os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o600)
		if err != nil {
			return err
		}
		if _, err := f.Write(append(data, '\n')); err != nil {
			f.Close()
			return err
		}
		return f.Close()
	}()
	if err != nil {
		r.logger().Warn("usage", "error", err)
		return
	}
	r.spentLines++
}

// compactSpent replaces SpentPath at once (mode 600) with one line a
// Session and one a spend waiting. Under r.mu.
func (r *Reporter) compactSpent() {
	lines := make([]spentLine, 0, len(r.spent)+len(r.pending))
	for key, c := range r.spent {
		lines = append(lines, spentLine{Session: key, CostUsdMicros: c.CostUsdMicros, At: c.At})
	}
	for i := range r.pending {
		lines = append(lines, spentLine{Spend: &r.pending[i]})
	}
	if err := r.writeSpent(lines); err != nil {
		r.logger().Warn("usage", "error", err)
		return
	}
	r.spentLines = len(lines)
}

func (r *Reporter) writeSpent(lines []spentLine) error {
	var data bytes.Buffer
	encoder := json.NewEncoder(&data)
	for _, line := range lines {
		if err := encoder.Encode(line); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(filepath.Dir(r.SpentPath), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(r.SpentPath), filepath.Base(r.SpentPath)+".*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data.Bytes()); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), r.SpentPath)
}
