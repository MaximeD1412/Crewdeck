package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func readRunnerFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(runnerFixtures, name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return data
}

// The fixtures of a migration of Source (SOURCE-7) decode into their Go types,
// the same messages the server sends and reads.
func TestMigrationMessagesDecodeTheSharedFixtures(t *testing.T) {
	var copyMessage RunnerMigrationCopy
	if err := json.Unmarshal(readRunnerFixture(t, "migration.copy.json"), &copyMessage); err != nil {
		t.Fatalf("decode migration.copy: %v", err)
	}
	if copyMessage.Group != "ticket" || copyMessage.From != "local" || copyMessage.To != "github" || copyMessage.Repository == nil || copyMessage.Repository.Name != "fixture-app" {
		t.Fatalf("migration.copyMessage %+v", copyMessage)
	}

	var progress RunnerMigrationProgress
	if err := json.Unmarshal(readRunnerFixture(t, "migration.progress.json"), &progress); err != nil || progress.Total != 30 || progress.Copied != 12 {
		t.Fatalf("migration.progress %+v: %v", progress, err)
	}

	var switched RunnerMigrationSwitch
	if err := json.Unmarshal(readRunnerFixture(t, "migration.switch.json"), &switched); err != nil || len(switched.Fingerprints) != 2 || len(switched.Renumbering) != 2 {
		t.Fatalf("migration.switch %+v: %v", switched, err)
	}

	var finish RunnerMigrationFinish
	if err := json.Unmarshal(readRunnerFixture(t, "migration.finish.json"), &finish); err != nil || len(finish.Fingerprints) != 2 {
		t.Fatalf("migration.finish %+v: %v", finish, err)
	}

	var finished RunnerMigrationFinished
	if err := json.Unmarshal(readRunnerFixture(t, "migration.finished.json"), &finished); err != nil || finished.MigrationId == "" {
		t.Fatalf("migration.finished %+v: %v", finished, err)
	}

	var failed RunnerMigrationFailed
	if err := json.Unmarshal(readRunnerFixture(t, "migration.failed.json"), &failed); err != nil || failed.Stage != "copy" || failed.Code != "github.unavailable" {
		t.Fatalf("migration.failed %+v: %v", failed, err)
	}
}

func TestMigrationFailedRejectsAStageOfItsOwn(t *testing.T) {
	var failed RunnerMigrationFailed
	data := []byte(`{"type":"migration.failed","id":"019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a75","at":"2026-11-11T09:00:40.000Z","migrationId":"019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b01","stage":"switch","code":"github.unavailable"}`)
	if err := json.Unmarshal(data, &failed); err == nil {
		t.Fatal("decoded a stage outside copyMessage and finish")
	}
}
