package session

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
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

// openLog opens the log for appending; lastSeq is its last event's. What a
// killed Runner left after the last whole event (half a line) is cut first,
// so that the next events follow it and Replay sees them.
func openLog(dir string) (*sessionLog, error) {
	path := filepath.Join(dir, logFile)
	last, whole, err := scanLog(path)
	if err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	if err := file.Truncate(whole); err != nil {
		file.Close()
		return nil, err
	}
	return &sessionLog{file: file, lastSeq: last}, nil
}

// scanLog gives the seq of the log's last whole event, and the length of
// the log up to the end of its line: a line not ended, or not an event, ends
// the log, as it does Replay.
func scanLog(path string) (last int, whole int64, err error) {
	file, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return 0, 0, nil
	}
	if err != nil {
		return 0, 0, err
	}
	defer file.Close()
	reader := bufio.NewReaderSize(file, 64<<10)
	for {
		line, err := reader.ReadBytes('\n')
		if errors.Is(err, io.EOF) {
			return last, whole, nil
		}
		if err != nil {
			return 0, 0, err
		}
		var event contracts.EngineEvent
		if json.Unmarshal(line, &event) != nil {
			return last, whole, nil
		}
		last, whole = seqOf(event), whole+int64(len(line))
	}
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
