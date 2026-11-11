package protocol

import (
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"time"
)

// newID is a UUIDv7 (RFC 9562), the shape of every id of the protocol: 48
// bits of Unix milliseconds, then random bits.
func newID(now time.Time) string {
	var b [16]byte
	if _, err := rand.Read(b[6:]); err != nil {
		panic(fmt.Sprintf("protocol: random id: %v", err))
	}
	var ms [8]byte
	binary.BigEndian.PutUint64(ms[:], uint64(now.UnixMilli()))
	copy(b[:6], ms[2:])
	b[6] = 0x70 | (b[6] & 0x0f)
	b[8] = 0x80 | (b[8] & 0x3f)
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
