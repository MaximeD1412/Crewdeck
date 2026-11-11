package claude

import (
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// No recording reached a limit yet (the spike's 06-b is still to record):
// this event is the recorded one of 06-a with its five-hour window refused,
// as rate_limit_info says it.
func TestARefusedWindowIsALimitReachedAfterItsUsage(t *testing.T) {
	line := `{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1794402600,"rateLimitType":"five_hour","unifiedWindows":{"five_hour":{"utilization":1,"resetsAt":1794402600,"status":"rejected"},"seven_day":{"utilization":0.23,"resetsAt":1794855600,"status":"allowed"}}}}`
	var p parser
	events := p.parse([]byte(line), false)
	if len(events) != 2 || events[0].Usage == nil || events[1].LimitReached == nil {
		t.Fatalf("events %+v", events)
	}
	windows := events[0].Usage.Windows
	if len(windows) != 2 || windows[0].UsedPercent != 100 || windows[1].Id != contracts.EngineEventUsageWindowsElemIdWeek {
		t.Fatalf("windows %+v", windows)
	}
	limit := events[1].LimitReached
	want := time.Unix(1794402600, 0).UTC()
	if limit.Window != contracts.EngineEventLimitReachedWindowFiveHour || limit.ResetsAt == nil || !limit.ResetsAt.Equal(want) {
		t.Fatalf("limit %+v", limit)
	}
	if limit.Raw == nil {
		t.Fatal("no raw")
	}
}

// A limit Claude reports on the turn itself, with no window.
func TestARateLimitErrorOfTheTurnIsALimitReachedOfAnUnknownWindow(t *testing.T) {
	var p parser
	events := p.parse([]byte(`{"type":"assistant","error":"rate_limit","message":{"content":[{"type":"text","text":"Limit reached"}]}}`), false)
	if len(events) != 1 || events[0].LimitReached == nil || events[0].LimitReached.Window != contracts.EngineEventLimitReachedWindowUnknown {
		t.Fatalf("events %+v", events)
	}
	result := p.parse([]byte(`{"type":"result","subtype":"success","is_error":true,"session_id":"s"}`), false)
	// The turn's error is already said: the result adds no other.
	if len(result) != 1 || result[0].Result == nil || result[0].Result.Status != contracts.EngineEventResultStatusError {
		t.Fatalf("result %+v", result)
	}
}
