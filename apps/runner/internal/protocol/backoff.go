package protocol

import (
	"math/rand/v2"
	"time"
)

// Backoff is the wait before each new attempt to connect: Min, doubled at
// each failure up to Max, each wait drawn between its half and itself
// (jitter), so that Runners cut off together do not come back together.
type Backoff struct {
	Min time.Duration
	Max time.Duration
	// Rand draws in [0, 1); math/rand/v2 when nil.
	Rand func() float64
}

// DefaultBackoff is the Runner's: 1 s doubling to 30 s.
var DefaultBackoff = Backoff{Min: time.Second, Max: 30 * time.Second}

// Delay is the wait before the attempt that follows `failures` failed ones in a row.
func (b Backoff) Delay(failures int) time.Duration {
	ceiling := b.Min
	for i := 0; i < failures && ceiling < b.Max; i++ {
		ceiling *= 2
	}
	ceiling = min(ceiling, b.Max)
	draw := rand.Float64
	if b.Rand != nil {
		draw = b.Rand
	}
	half := ceiling / 2
	return half + time.Duration(draw()*float64(ceiling-half))
}
