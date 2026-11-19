package command

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/relay"
)

// The relay of a run's output (docs/security/e2e.md « Commandes »), a
// Session's to the letter: a 32-byte key per run, kept in
// `commands/<runId>.key`, wrapped for each Appareil the Runner authenticated
// under "command:<runId>:<holderId>"; each chunk sealed under it with
// "command:<runId>:<seq>", sent live to every tab of the run, and from the
// log for a replay.

func wrapAad(runID string) func(string) string {
	return func(holderID string) string { return "command:" + runID + ":" + holderID }
}

func chunkAad(runID string, seq int) string {
	return "command:" + runID + ":" + strconv.Itoa(seq)
}

func (r *Runner) sendKeys(ctx context.Context, runID, tabID string, key []byte) error {
	wrapped, err := r.cfg.Keys.Wraps(key, wrapAad(runID))
	if err != nil {
		return err
	}
	wraps := make([]contracts.RunnerCommandKeysWrapsElem, len(wrapped))
	for i, w := range wrapped {
		wraps[i] = contracts.RunnerCommandKeysWrapsElem(w)
	}
	return r.cfg.Send(ctx, protocol.NewCommandKeys(runID, tabID, wraps))
}

func (r *Runner) sendChunk(ctx context.Context, runID, tabID string, key []byte, chunk Chunk) error {
	plain, err := json.Marshal(contracts.CommandOutputChunk{Stream: chunk.Stream, Text: chunk.Text, At: chunk.At})
	if err != nil {
		return err
	}
	nonce, ciphertext, err := relay.Seal(key, plain, chunkAad(runID, chunk.Seq))
	if err != nil {
		return err
	}
	return r.cfg.Send(ctx, protocol.NewCommandOutput(runID, tabID, chunk.Seq, nonce, ciphertext))
}

// warnRelay logs a failed send of the relay, but offline: the frame is
// lost, the tab's open replays it once the Runner is back. Never its text.
func (r *Runner) warnRelay(step, runID string, err error) {
	if err == nil || errors.Is(err, protocol.ErrNotConnected) {
		return
	}
	r.cfg.Logger.Warn("command.relay", "runId", runID, "step", step, "error", "not sent")
}

func (r *Runner) relayContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(r.ctx), protocolTimeout)
}

const protocolTimeout = 10 * time.Second

func (r *Runner) relayKeys(runID, tabID string, key []byte) {
	ctx, cancel := r.relayContext()
	defer cancel()
	r.warnRelay("keys", runID, r.sendKeys(ctx, runID, tabID, key))
}

func (r *Runner) relayChunk(runID, tabID string, key []byte, chunk Chunk) {
	ctx, cancel := r.relayContext()
	defer cancel()
	r.warnRelay("output", runID, r.sendChunk(ctx, runID, tabID, key, chunk))
}

// ReplayTo sends the tab of the replay the run's key, then its logged chunks
// from fromSeq, in the background. A run the Runner has no key for (none
// started here, or past LogAge) sends nothing.
func (r *Runner) ReplayTo(message contracts.RunnerCommandReplay) {
	if r.cfg.Keys == nil || message.FromSeq < 1 || !uuid.MatchString(message.RunId) {
		return
	}
	key, err := relay.ReadKey(keyPath(r.cfg.Home, message.RunId))
	if err != nil {
		return
	}
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return
	}
	r.wg.Add(1)
	r.mu.Unlock()
	go func() {
		defer r.wg.Done()
		ctx, cancel := context.WithCancel(r.ctx)
		defer cancel()
		if err := r.sendKeys(ctx, message.RunId, message.TabId, key); err != nil {
			r.warnRelay("keys", message.RunId, err)
			return
		}
		for chunk, err := range Replay(r.cfg.Home, message.RunId, message.FromSeq) {
			if err == nil {
				err = r.sendChunk(ctx, message.RunId, message.TabId, key, chunk)
			}
			if err != nil {
				r.warnRelay("replay", message.RunId, err)
				return
			}
		}
	}()
}
