package command_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/maximed1412/crewdeck/apps/runner/internal/command"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
)

// alive is whether the process pid still runs (a zombie does not).
func alive(pid int) bool {
	stat, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return syscall.Kill(pid, 0) == nil
	}
	fields := strings.Fields(string(stat[strings.LastIndexByte(string(stat), ')')+1:]))
	return len(fields) > 0 && fields[0] != "Z"
}

// dies waits a little for pid to end, and says whether it did.
func dies(pid int) bool {
	deadline := time.Now().Add(5 * time.Second)
	for alive(pid) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	return !alive(pid)
}

// pidIn waits for the pid a run wrote at path.
func pidIn(t *testing.T, path string) int {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if data, err := os.ReadFile(path); err == nil && strings.HasSuffix(string(data), "\n") {
			pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
			if err == nil {
				return pid
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("no pid in %s", filepath.Base(path))
	return 0
}

func TestARunPastThirtyMinutesHasItsGroupKilledAfterTheGrace(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	// The shell and its child both ignore SIGTERM: only the SIGKILL after
	// the grace ends them.
	h.commands.Run(h.run(t, runID, "trap '' TERM; sleep 300 & echo $! > "+h.mark("child")+"; wait", "worktree", sha))
	h.sent.started(t, runID)
	child := pidIn(t, h.mark("child"))

	h.clock.fire(t, command.Timeout)
	h.clock.fire(t, command.KillGrace)
	v := h.sent.verdict(t, runID)
	if v.Passed || v.Reason != contracts.RunnerCommandVerdictReasonTimeout || v.ExitCode != nil {
		t.Fatalf("verdict %+v, want timeout without an exit code", v)
	}
	if !dies(child) {
		t.Fatal("the run's child outlived its group's kill")
	}
}

func TestAStoppedRunEndsStoppedAndASecondRunOfTheSameCommandeIsBusy(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	h.commands.Run(h.run(t, runID, "sleep 300 & echo $! > "+h.mark("child")+"; wait", "project", sha))
	h.sent.started(t, runID)
	child := pidIn(t, h.mark("child"))

	h.commands.Run(h.run(t, secondRun, "touch "+h.mark("second"), "project", sha))
	if v := h.sent.verdict(t, secondRun); v.Reason != contracts.RunnerCommandVerdictReasonBusy || v.Passed {
		t.Fatalf("verdict %+v, want busy", v)
	}
	if exists(h.mark("second")) {
		t.Fatal("a second run of a Commande under way ran")
	}

	h.commands.Stop(runID)
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonStopped || v.Passed || v.ExitCode != nil {
		t.Fatalf("verdict %+v, want stopped", v)
	}
	if !dies(child) {
		t.Fatal("the stopped run's child still runs")
	}
}

func TestAStopThatFollowsTheRunWhileItsSealedPartOpensStopsItBeforeAnythingRuns(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.gate = make(chan struct{})
	h.start(t)

	h.commands.Run(h.run(t, runID, "touch "+h.mark("ran"), "project", sha))
	h.commands.Stop(runID)
	close(h.gate)

	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonStopped || v.Passed || v.ExitCode != nil {
		t.Fatalf("verdict %+v, want stopped", v)
	}
	if h.sent.startedAny(runID) || exists(h.mark("ran")) {
		t.Fatal("a run stopped before it started ran")
	}
	// Its Commande is free again.
	h.commands.Run(h.run(t, secondRun, "exit 0", "project", sha))
	if v := h.sent.verdict(t, secondRun); v.Reason != contracts.RunnerCommandVerdictReasonExited {
		t.Fatalf("verdict %+v, want exited", v)
	}
}

func TestTheOutputIsLoggedPrivatelyAndReplaysFromASeq(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	h.commands.Run(h.run(t, runID, "echo un; echo deux >&2; printf trois", "worktree", sha))
	if v := h.sent.verdict(t, runID); !v.Passed {
		t.Fatalf("verdict %+v", v)
	}
	path := filepath.Join(h.home, "commands", runID+".log")
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("log %v, %v, want mode 600", info, err)
	}
	if dir, _ := os.Stat(filepath.Dir(path)); dir.Mode().Perm() != 0o700 {
		t.Fatalf("commands folder mode %v, want 700", dir.Mode().Perm())
	}

	var all []command.Chunk
	for chunk, err := range command.Replay(h.home, runID, 1) {
		if err != nil {
			t.Fatal(err)
		}
		all = append(all, chunk)
	}
	// Chunks follow the reads: each stream's text, in order, is the run's.
	got := map[string]string{}
	for i, chunk := range all {
		if chunk.Seq != i+1 {
			t.Fatalf("chunk %d numbered %d", i, chunk.Seq)
		}
		got[string(chunk.Stream)] += chunk.Text
	}
	if len(got) != 2 || got["stdout"] != "un\ntrois" || got["stderr"] != "deux\n" {
		t.Fatalf("logged %+v, want un, trois on stdout and deux on stderr", all)
	}
	var later []int
	for chunk, err := range command.Replay(h.home, runID, 2) {
		if err != nil {
			t.Fatal(err)
		}
		later = append(later, chunk.Seq)
	}
	if len(later) != len(all)-1 || later[0] != 2 || later[len(later)-1] != len(all) {
		t.Fatalf("replay from 2 gave %v of %d chunks", later, len(all))
	}
	for range command.Replay(h.home, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6cff", 1) {
		t.Fatal("a run never logged replays something")
	}
}

func TestALongLineIsCutIntoChunksAtACharactersStart(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	// 10 000 « é » (20 000 bytes) on one line, in one write, then a short one.
	h.commands.Run(h.run(t, runID, `s=é; for i in 1 2 3 4 5 6 7 8 9 10 11 12 13; do s=$s$s; done; printf '%s%s' "$s" "$(printf '%s' "$s" | head -c 3616)"; echo; echo fin`, "worktree", sha))
	if v := h.sent.verdict(t, runID); !v.Passed {
		t.Fatalf("verdict %+v", v)
	}
	var texts []string
	for chunk, err := range command.Replay(h.home, runID, 1) {
		if err != nil {
			t.Fatal(err)
		}
		if len(chunk.Text) > command.ChunkMax {
			t.Fatalf("chunk %d of %d bytes", chunk.Seq, len(chunk.Text))
		}
		if !utf8.ValidString(chunk.Text) {
			t.Fatalf("chunk %d cuts a character", chunk.Seq)
		}
		texts = append(texts, chunk.Text)
	}
	joined := strings.Join(texts, "")
	if joined != strings.Repeat("é", 10000)+"\nfin\n" {
		t.Fatalf("output %d bytes in %d chunks, not the run's", len(joined), len(texts))
	}
	if len(texts) < 2 {
		t.Fatalf("%d chunk(s), want the line cut", len(texts))
	}
}

func TestAnOutputWithNoNewlineIsLoggedWhileTheRunGoesOn(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	h.commands.Run(h.run(t, runID, `printf 'progress 1\r'; sleep 300`, "worktree", sha))
	t.Cleanup(func() { h.commands.Stop(runID) })
	deadline := time.Now().Add(10 * time.Second)
	for {
		var texts []string
		for chunk, err := range command.Replay(h.home, runID, 1) {
			if err == nil {
				texts = append(texts, chunk.Text)
			}
		}
		if strings.Join(texts, "") == "progress 1\r" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("logged %q while the run goes on, want its progress", texts)
		}
		time.Sleep(20 * time.Millisecond)
	}
	h.commands.Stop(runID)
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonStopped {
		t.Fatalf("verdict %+v, want stopped", v)
	}
}

func TestTheLogsOlderThanThirtyDaysAreRemoved(t *testing.T) {
	h := newHarness(t)
	dir := filepath.Join(h.home, "commands")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-command.LogAge - time.Hour)
	recent := time.Now().Add(-command.LogAge + time.Hour)
	for name, at := range map[string]time.Time{"old.log": old, "old.key": old, "recent.log": recent, "recent.key": recent, "notes.txt": old} {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, at, at); err != nil {
			t.Fatal(err)
		}
	}
	h.start(t)
	entries, _ := os.ReadDir(dir)
	var kept []string
	for _, e := range entries {
		kept = append(kept, e.Name())
	}
	sort.Strings(kept)
	if strings.Join(kept, ",") != "notes.txt,recent.key,recent.log" {
		t.Fatalf("kept %v", kept)
	}
}

// opened is a relayed output, as an Appareil opens it.
type opened struct {
	key    []byte
	chunks map[int]contracts.CommandOutputChunk
}

func (h *harness) openKeys(t *testing.T, message contracts.RunnerCommandKeys) []byte {
	t.Helper()
	if len(message.Wraps) != 1 {
		t.Fatalf("wraps %+v, want one for the Appareil", message.Wraps)
	}
	w := message.Wraps[0]
	if w.HolderId != b64.EncodeToString(keys.PublicKeyBytes(h.device)) {
		t.Fatalf("wrapped for %s", w.HolderId)
	}
	decode := func(s string) []byte {
		b, err := b64.DecodeString(s)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	key, err := keys.OpenWrap(h.device, keys.PublicKeyBytes(h.runner), keys.Wrap{Enc: decode(w.Enc), Ciphertext: decode(w.WrappedKey), Tag: decode(w.Tag)},
		[]byte(keys.InfoSessionKey), []byte("command:"+message.RunId+":"+w.HolderId))
	if err != nil {
		t.Fatalf("the Appareil cannot open its wrap: %v", err)
	}
	return key
}

func openChunk(t *testing.T, key []byte, frame contracts.RunnerCommandOutput, seq int) (contracts.CommandOutputChunk, error) {
	t.Helper()
	nonce, err1 := b64.DecodeString(frame.Nonce)
	ciphertext, err2 := b64.DecodeString(frame.Ciphertext)
	if err1 != nil || err2 != nil {
		t.Fatalf("frame not in base64url: %v %v", err1, err2)
	}
	plain, err := keys.AESGCMOpen(key, append(nonce, ciphertext...), []byte("command:"+frame.RunId+":"+strconv.Itoa(seq)))
	if err != nil {
		return contracts.CommandOutputChunk{}, err
	}
	var chunk contracts.CommandOutputChunk
	if err := json.Unmarshal(plain, &chunk); err != nil {
		t.Fatal(err)
	}
	return chunk, nil
}

// relayed is what the tab tabID was sent of the run: its key, then its chunks.
func (h *harness) relayedTo(t *testing.T, tab *string, want int) opened {
	t.Helper()
	sameTab := func(got *string) bool {
		return (tab == nil && got == nil) || (tab != nil && got != nil && *got == *tab)
	}
	h.sent.await(t, "the relayed output", func(any) bool {
		n := 0
		for _, m := range h.sent.all() {
			if o, ok := m.(contracts.RunnerCommandOutput); ok && o.RunId == runID && sameTab(o.TabId) {
				n++
			}
		}
		return n >= want
	})
	out := opened{chunks: map[int]contracts.CommandOutputChunk{}}
	for _, m := range h.sent.all() {
		switch m := m.(type) {
		case contracts.RunnerCommandKeys:
			if m.RunId == runID && sameTab(m.TabId) {
				if out.key != nil {
					t.Fatal("the keys were sent twice")
				}
				out.key = h.openKeys(t, m)
			}
		case contracts.RunnerCommandOutput:
			if m.RunId != runID || !sameTab(m.TabId) {
				continue
			}
			if out.key == nil {
				t.Fatal("a chunk came before the keys")
			}
			chunk, err := openChunk(t, out.key, m, m.Seq)
			if err != nil {
				t.Fatalf("chunk %d does not open: %v", m.Seq, err)
			}
			if _, err := openChunk(t, out.key, m, m.Seq+1); err == nil {
				t.Fatalf("chunk %d opens under another seq", m.Seq)
			}
			out.chunks[m.Seq] = chunk
		}
	}
	return out
}

func TestTheOutputIsRelayedSealedForTheAppareilsLiveAndOnReplay(t *testing.T) {
	h := newHarness(t)
	h.relayed = true
	sha := h.remote.ticket(t)
	h.start(t)
	h.commands.Run(h.run(t, runID, "echo 'le secret du Pilote'; echo 'deux' >&2", "worktree", sha))
	if v := h.sent.verdict(t, runID); !v.Passed {
		t.Fatalf("verdict %+v", v)
	}
	live := h.relayedTo(t, nil, 2)
	texts := map[string]string{}
	for _, c := range live.chunks {
		texts[c.Text] = string(c.Stream)
	}
	if len(live.chunks) != 2 || texts["le secret du Pilote\n"] != "stdout" || texts["deux\n"] != "stderr" {
		t.Fatalf("relayed %+v", live.chunks)
	}
	for _, m := range h.sent.all() {
		raw, _ := json.Marshal(m)
		if strings.Contains(string(raw), "secret") {
			t.Fatalf("the output reached the server in the clear: %s", raw)
		}
	}

	tab := tabID
	h.commands.ReplayTo(contracts.RunnerCommandReplay{Type: "command.replay", Id: "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c30", At: time.Now().UTC(), RunId: runID, TabId: tab, FromSeq: 2})
	replayed := h.relayedTo(t, &tab, 1)
	if len(replayed.chunks) != 1 || replayed.chunks[2] != live.chunks[2] {
		t.Fatalf("replay from 2 gave %+v, want %+v", replayed.chunks, live.chunks[2])
	}
	if string(replayed.key) != string(live.key) {
		t.Fatal("the replay sealed under another key than the run's")
	}
	keyFile, err := os.Stat(filepath.Join(h.home, "commands", runID+".key"))
	if err != nil || keyFile.Mode().Perm() != 0o600 {
		t.Fatalf("key file %v, %v, want mode 600", keyFile, err)
	}
}
