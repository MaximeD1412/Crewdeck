package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "api", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return data
}

func TestHealthDecodesTheSharedFixture(t *testing.T) {
	var health Health
	if err := json.Unmarshal(readFixture(t, "health.json"), &health); err != nil {
		t.Fatalf("decode health.json: %v", err)
	}
	want := Health{Status: "ok", Commit: "0123456789abcdef0123456789abcdef01234567", Db: HealthDbOk}
	if health != want {
		t.Fatalf("decoded %+v, want %+v", health, want)
	}
}

func TestHealthRejectsAStatusOtherThanOk(t *testing.T) {
	var health Health
	if err := json.Unmarshal(readFixture(t, "health.invalid.json"), &health); err == nil {
		t.Fatalf("decode health.invalid.json: want an error, got %+v", health)
	}
}

func TestHealthRejectsADbStateOutsideOkAndDown(t *testing.T) {
	var health Health
	if err := json.Unmarshal([]byte(`{"status":"ok","commit":"dev","db":"maybe"}`), &health); err == nil {
		t.Fatalf("want an error, got %+v", health)
	}
}
