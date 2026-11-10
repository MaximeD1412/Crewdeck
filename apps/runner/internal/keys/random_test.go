package keys

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io"
	"testing"
)

// The test-only seam over the randomness (the ephemeral keys, the nonces).
// It lives in a _test.go file, so it is never compiled into the Runner.
//
// The deterministic stream is the one of apps/web/src/keys/testing.ts:
// block i = HMAC-SHA256(seed, "crewdeck/test/random" ‖ uint32be(i)), the
// blocks concatenated, each draw taking the next bytes.

func useRandom(t *testing.T, r io.Reader) {
	t.Helper()
	previous := random
	random = r
	t.Cleanup(func() { random = previous })
}

// withDeterministicRandom makes every draw come from the seed's stream until
// the test ends.
func withDeterministicRandom(t *testing.T, seed []byte) {
	t.Helper()
	useRandom(t, &deterministicStream{seed: seed})
}

// withFixedRandom hands out exactly these bytes, then fails.
func withFixedRandom(t *testing.T, b []byte) {
	t.Helper()
	useRandom(t, &fixedStream{rest: append([]byte(nil), b...)})
}

type deterministicStream struct {
	seed    []byte
	counter uint32
	buf     []byte
}

func (d *deterministicStream) Read(p []byte) (int, error) {
	for len(d.buf) < len(p) {
		mac := hmac.New(sha256.New, d.seed)
		mac.Write([]byte("crewdeck/test/random"))
		mac.Write(binary.BigEndian.AppendUint32(nil, d.counter))
		d.counter++
		d.buf = mac.Sum(d.buf)
	}
	n := copy(p, d.buf)
	d.buf = d.buf[n:]
	return n, nil
}

type fixedStream struct{ rest []byte }

func (f *fixedStream) Read(p []byte) (int, error) {
	if len(f.rest) < len(p) {
		return 0, errors.New("fixed random exhausted")
	}
	n := copy(p, f.rest)
	f.rest = f.rest[n:]
	return n, nil
}
