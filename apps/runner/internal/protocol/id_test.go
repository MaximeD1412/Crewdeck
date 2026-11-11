package protocol

import (
	"regexp"
	"testing"
	"time"
)

var uuidV7 = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestIdsAreUUIDv7OrderedByTime(t *testing.T) {
	first := newID(time.UnixMilli(1_700_000_000_000))
	second := newID(time.UnixMilli(1_700_000_000_001))
	if !uuidV7.MatchString(first) || !uuidV7.MatchString(second) {
		t.Fatalf("ids %s %s", first, second)
	}
	if first >= second {
		t.Fatalf("%s is not before %s", first, second)
	}
}

func TestTheBackoffDoublesUpToItsMaximumWithJitter(t *testing.T) {
	low := Backoff{Min: time.Second, Max: 30 * time.Second, Rand: func() float64 { return 0 }}
	high := Backoff{Min: time.Second, Max: 30 * time.Second, Rand: func() float64 { return 1 }}
	cases := []struct {
		failures  int
		low, high time.Duration
	}{
		{0, 500 * time.Millisecond, time.Second},
		{1, time.Second, 2 * time.Second},
		{3, 4 * time.Second, 8 * time.Second},
		{10, 15 * time.Second, 30 * time.Second},
		{1000, 15 * time.Second, 30 * time.Second},
	}
	for _, c := range cases {
		if got := low.Delay(c.failures); got != c.low {
			t.Errorf("Delay(%d) at the lowest jitter = %v, want %v", c.failures, got, c.low)
		}
		if got := high.Delay(c.failures); got != c.high {
			t.Errorf("Delay(%d) at the highest jitter = %v, want %v", c.failures, got, c.high)
		}
	}
}
