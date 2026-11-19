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
	// turn: whether its last turn was cut, what a Runner killed in the
	// middle of it leaves.
	turn turnState
}

// turnState follows the log's last turn: an agent's message still streaming
// (a delta, maybe usage reports after it), the requests waiting for the
// Pilote (SESSION-3), which a `result` withdraws.
type turnState struct {
	streaming bool
	open      map[string]bool
}

func (t *turnState) see(event contracts.EngineEvent) {
	t.streaming = stillCut(t.streaming, event)
	switch {
	case event.Question != nil:
		t.wait(event.Question.RequestId)
	case event.PermissionRequest != nil:
		t.wait(event.PermissionRequest.RequestId)
	case event.Answer != nil:
		delete(t.open, event.Answer.RequestId)
	case event.Result != nil:
		t.open = nil
	}
}

func (t *turnState) wait(requestID string) {
	if t.open == nil {
		t.open = map[string]bool{}
	}
	t.open[requestID] = true
}

// cut: a message streams, or a request waits, at the log's end; the next
// run starts without them.
func (t *turnState) cut() bool { return t.streaming || len(t.open) > 0 }

// openLog opens the log for appending; lastSeq is its last event's. What a
// killed Runner left after the last whole event (half a line) is cut first,
// so that the next events follow it and Replay sees them.
func openLog(dir string) (*sessionLog, error) {
	path := filepath.Join(dir, logFile)
	last, whole, turn, err := scanLog(path)
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
	return &sessionLog{file: file, lastSeq: last, turn: turn}, nil
}

// scanLog gives the seq of the log's last whole event, the length of the
// log up to the end of its line, and its last turn: a line not ended, or
// not an event, ends the log, as it does Replay.
func scanLog(path string) (last int, whole int64, turn turnState, err error) {
	file, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return 0, 0, turn, nil
	}
	if err != nil {
		return 0, 0, turn, err
	}
	defer file.Close()
	reader := bufio.NewReaderSize(file, 64<<10)
	for {
		line, err := reader.ReadBytes('\n')
		if errors.Is(err, io.EOF) {
			return last, whole, turn, nil
		}
		if err != nil {
			return 0, 0, turnState{}, err
		}
		var event contracts.EngineEvent
		if json.Unmarshal(line, &event) != nil {
			return last, whole, turn, nil
		}
		last, whole = seqOf(event), whole+int64(len(line))
		turn.see(event)
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
	l.turn.see(stamped)
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
// its last delta or its requests still waiting, so that what the resumed run
// says is a message apart and those requests withdrawn (the new run never
// takes their answer), in the log as in its replay. A log not cut is left as
// it is.
func (l *sessionLog) endCut(at time.Time) (contracts.EngineEvent, bool, error) {
	if !l.turn.cut() {
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
