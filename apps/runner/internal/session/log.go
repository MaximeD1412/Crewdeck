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
	"time"

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
	// cut: an agent's message still streams at its end (a delta, maybe
	// usage reports after it), what a Runner killed in the middle of a turn
	// leaves.
	cut bool
}

// openLog opens the log for appending; lastSeq is its last event's. What a
// killed Runner left after the last whole event (half a line) is cut first,
// so that the next events follow it and Replay sees them.
func openLog(dir string) (*sessionLog, error) {
	path := filepath.Join(dir, logFile)
	last, whole, cut, err := scanLog(path)
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
	return &sessionLog{file: file, lastSeq: last, cut: cut}, nil
}

// scanLog gives the seq of the log's last whole event, the length of the
// log up to the end of its line, and whether that event is a delta: a line
// not ended, or not an event, ends the log, as it does Replay.
func scanLog(path string) (last int, whole int64, cut bool, err error) {
	file, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return 0, 0, false, nil
	}
	if err != nil {
		return 0, 0, false, err
	}
	defer file.Close()
	reader := bufio.NewReaderSize(file, 64<<10)
	for {
		line, err := reader.ReadBytes('\n')
		if errors.Is(err, io.EOF) {
			return last, whole, cut, nil
		}
		if err != nil {
			return 0, 0, false, err
		}
		var event contracts.EngineEvent
		if json.Unmarshal(line, &event) != nil {
			return last, whole, cut, nil
		}
		last, whole = seqOf(event), whole+int64(len(line))
		cut = stillCut(cut, event)
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
	l.cut = stillCut(l.cut, stamped)
	return stamped, nil
}

// stillCut says whether a message still streams after the event: a delta
// opens it, a usage report keeps it as it was, anything else ends it (the
// page joins the deltas by the same rule).
func stillCut(cut bool, event contracts.EngineEvent) bool {
	switch {
	case event.Message != nil:
		return !event.Message.Final
	case event.Usage != nil:
		return cut
	}
	return false
}

// endCut ends the turn a killed Runner cut, a `result` `interrupted` after
// its last delta, so that what the resumed run says is a message apart, in
// the log as in its replay. A log not cut is left as it is.
func (l *sessionLog) endCut(at time.Time) (contracts.EngineEvent, bool, error) {
	if !l.cut {
		return contracts.EngineEvent{}, false, nil
	}
	end := contracts.EngineEvent{Result: &contracts.EngineEventResult{Kind: contracts.EngineEventKindResult, Status: contracts.EngineEventResultStatusInterrupted, Seq: 1, At: at}}
	stamped, err := l.append(end, l.lastSeq)
	return stamped, err == nil, err
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
