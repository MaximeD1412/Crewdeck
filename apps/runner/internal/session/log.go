package session

import (
	"bufio"
	"encoding/json"
	"errors"
	"io/fs"
	"iter"
	"os"
	"path/filepath"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
)

// The Session's local log (ADR 0007): `<home>/sessions/<id>/log.jsonl`, mode
// 600, one normalised event per line with its seq, which continues from one
// run of the Moteur to the next (a resume). It never leaves the Runner but
// through SESSION-1's encrypted relay, which reads it with Replay.
const logFile = "log.jsonl"

// maxLogLine is the longest line Replay reads: an event with its raw.
const maxLogLine = 16 << 20

type sessionLog struct {
	file    *os.File
	lastSeq int
}

// openLog opens the log for appending; lastSeq is its last event's.
func openLog(dir string) (*sessionLog, error) {
	last := 0
	for event, err := range replayFile(filepath.Join(dir, logFile), 0) {
		if err != nil {
			return nil, err
		}
		last = seqOf(event)
	}
	file, err := os.OpenFile(filepath.Join(dir, logFile), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	return &sessionLog{file: file, lastSeq: last}, nil
}

// append writes the run's event, its seq offset by the runs before.
func (l *sessionLog) append(event contracts.EngineEvent, offset int) (contracts.EngineEvent, error) {
	at := atOf(event)
	stamped := engine.Stamp(event, offset+seqOf(event), at)
	line, err := json.Marshal(stamped)
	if err != nil {
		return stamped, err
	}
	if _, err := l.file.Write(append(line, '\n')); err != nil {
		return stamped, err
	}
	l.lastSeq = seqOf(stamped)
	return stamped, nil
}

func (l *sessionLog) close() error { return l.file.Close() }

// Replay gives the events of the Session's log after fromSeq, in order; a
// Session without a log gives none.
func Replay(home, sessionID string, fromSeq int) iter.Seq2[contracts.EngineEvent, error] {
	return replayFile(filepath.Join(sessionsDir(home), sessionID, logFile), fromSeq)
}

func replayFile(path string, fromSeq int) iter.Seq2[contracts.EngineEvent, error] {
	return func(yield func(contracts.EngineEvent, error) bool) {
		file, err := os.Open(path)
		if errors.Is(err, fs.ErrNotExist) {
			return
		}
		if err != nil {
			yield(contracts.EngineEvent{}, err)
			return
		}
		defer file.Close()
		scanner := bufio.NewScanner(file)
		scanner.Buffer(make([]byte, 64<<10), maxLogLine)
		for scanner.Scan() {
			var event contracts.EngineEvent
			if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
				// A line a killed Runner left half written ends the log.
				return
			}
			if seqOf(event) <= fromSeq {
				continue
			}
			if !yield(event, nil) {
				return
			}
		}
		if err := scanner.Err(); err != nil {
			yield(contracts.EngineEvent{}, err)
		}
	}
}
