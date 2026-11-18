package command

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"iter"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/relay"
)

// ChunkMax is the most bytes of output one chunk holds
// (COMMAND_CHUNK_BYTES_MAX).
const ChunkMax = 16 * 1024

// Chunk is a line of a run's log: what one stream gave, at that instant,
// numbered from 1 across both streams.
type Chunk struct {
	Seq    int                                `json:"seq"`
	At     time.Time                          `json:"at"`
	Stream contracts.CommandOutputChunkStream `json:"stream"`
	Text   string                             `json:"text"`
}

func logPath(home, runID string) string {
	return filepath.Join(commandsDir(home), runID+".log")
}

func keyPath(home, runID string) string {
	return filepath.Join(commandsDir(home), runID+".key")
}

// output is a run's output under way: each chunk logged, then relayed live.
type output struct {
	r     *Runner
	runID string
	key   []byte

	mu      sync.Mutex
	file    *os.File
	seq     int
	streams []*stream
}

// openOutput creates the run's log (mode 600) and, when the relay is on,
// its key, sent to the run's tabs before any chunk.
func (r *Runner) openOutput(runID string) (*output, error) {
	file, err := os.OpenFile(logPath(r.cfg.Home, runID), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	out := &output{r: r, runID: runID, file: file}
	if r.cfg.Keys != nil {
		key, err := relay.LoadOrCreateKey(keyPath(r.cfg.Home, runID))
		if err != nil {
			file.Close()
			return nil, err
		}
		out.key = key
		r.relayKeys(runID, "", key)
	}
	return out, nil
}

// stream is the writer of one of the run's streams.
func (o *output) stream(name contracts.CommandOutputChunkStream) io.Writer {
	s := &stream{out: o, name: name}
	o.streams = append(o.streams, s)
	return s
}

// flush logs what the streams still hold, once the run ended.
func (o *output) flush() {
	for _, s := range o.streams {
		s.flush()
	}
}

func (o *output) close() {
	o.mu.Lock()
	defer o.mu.Unlock()
	_ = o.file.Close()
}

// emit logs one chunk, then relays it.
func (o *output) emit(name contracts.CommandOutputChunkStream, text []byte) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.seq++
	chunk := Chunk{Seq: o.seq, At: time.Now().UTC().Truncate(time.Millisecond), Stream: name, Text: string(text)}
	line, err := json.Marshal(chunk)
	if err == nil {
		_, err = o.file.Write(append(line, '\n'))
	}
	if err != nil {
		o.r.cfg.Logger.Warn("command.log", "runId", o.runID, "error", "not written")
	}
	if o.key != nil {
		o.r.relayChunk(o.runID, "", o.key, chunk)
	}
}

// stream cuts what one stream writes into chunks as it comes, a line ended
// or not (a progress written with `\r` shows at once): each chunk at most
// ChunkMax bytes, cut at a character's start, a character a read cut in two
// held until its end comes. A chunk holds one stream only.
type stream struct {
	out  *output
	name contracts.CommandOutputChunkStream
	mu   sync.Mutex
	buf  []byte
}

func (s *stream) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.buf = append(s.buf, p...)
	for n := next(s.buf, false); n > 0; n = next(s.buf, false) {
		s.out.emit(s.name, s.buf[:n])
		s.buf = s.buf[n:]
	}
	s.buf = bytes.Clone(s.buf)
	return len(p), nil
}

func (s *stream) flush() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for n := next(s.buf, true); n > 0; n = next(s.buf, true) {
		s.out.emit(s.name, s.buf[:n])
		s.buf = s.buf[n:]
	}
}

// next is the length of b's next chunk: all of it up to ChunkMax, cut at a
// character's start; 0 when b is only the start of a character, unless the
// stream ended (bytes that are no UTF-8 go as they are).
func next(b []byte, ended bool) int {
	if len(b) == 0 {
		return 0
	}
	if len(b) > ChunkMax {
		for n := ChunkMax; n > ChunkMax-utf8.UTFMax; n-- {
			if utf8.RuneStart(b[n]) {
				return n
			}
		}
		return ChunkMax
	}
	if ended {
		return len(b)
	}
	// A character the read cut in two waits for its end.
	for start := len(b) - 1; start >= 0 && start >= len(b)-utf8.UTFMax; start-- {
		if utf8.RuneStart(b[start]) {
			if !utf8.FullRune(b[start:]) {
				return start
			}
			break
		}
	}
	return len(b)
}

// Replay is the run's logged chunks from fromSeq (included), in order. A
// run that has logged nothing yet gives none.
func Replay(home, runID string, fromSeq int) iter.Seq2[Chunk, error] {
	return func(yield func(Chunk, error) bool) {
		file, err := os.Open(logPath(home, runID))
		if errors.Is(err, os.ErrNotExist) {
			return
		}
		if err != nil {
			yield(Chunk{}, err)
			return
		}
		defer file.Close()
		reader := bufio.NewReader(file)
		for {
			line, err := reader.ReadBytes('\n')
			if len(line) > 0 && line[len(line)-1] == '\n' {
				var chunk Chunk
				if decodeErr := json.Unmarshal(line, &chunk); decodeErr != nil {
					if !yield(Chunk{}, decodeErr) {
						return
					}
				} else if chunk.Seq >= fromSeq && !yield(chunk, nil) {
					return
				}
			}
			if err != nil {
				if !errors.Is(err, io.EOF) {
					yield(Chunk{}, err)
				}
				return // a line not ended is one being written
			}
		}
	}
}

// Sweep removes the runs' logs and keys older than LogAge.
func (r *Runner) Sweep() {
	dir := commandsDir(r.cfg.Home)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-LogAge)
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !(strings.HasSuffix(name, ".log") || strings.HasSuffix(name, ".key")) {
			continue
		}
		info, err := entry.Info()
		if err == nil && info.ModTime().Before(cutoff) {
			_ = os.Remove(filepath.Join(dir, name))
		}
	}
}
