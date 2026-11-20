package checks

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// ideaParams are the params of the Contrat `idea-analysis`'s two checks.
var ideaParams = map[string]any{"report": ".crewdeck/report.json", "context": ".crewdeck/context.json"}

// ideaFixture is a folder of testdata/idea-analysis.
func ideaFixture(name string) target.Target {
	return target.Target{Dir: filepath.Join("testdata", "idea-analysis", name)}
}

func lookup(t *testing.T, name string) Func {
	t.Helper()
	fn, ok := Lookup(name)
	if !ok {
		t.Fatalf("%s is not registered", name)
	}
	return fn
}

func TestIdeaProjectPassesAProjetOfTheContextOrANewOne(t *testing.T) {
	fn := lookup(t, "idea-project")
	for name, want := range map[string]bool{"pass": true, "pass-new-project": true, "fail-project": false, "fail-duplicate": true} {
		got, err := fn(context.Background(), ideaFixture(name), ideaParams)
		if err != nil || got != want {
			t.Errorf("%s: %v, %v, want %v", name, got, err, want)
		}
	}
}

func TestIdeaDuplicatesPassesOnlyOtherOpenIdees(t *testing.T) {
	fn := lookup(t, "idea-duplicates")
	for name, want := range map[string]bool{"pass": true, "pass-new-project": true, "fail-duplicate": false, "fail-project": true} {
		got, err := fn(context.Background(), ideaFixture(name), ideaParams)
		if err != nil || got != want {
			t.Errorf("%s: %v, %v, want %v", name, got, err, want)
		}
	}
}

// A duplicate the context does not list, one without an id, fail too.
func TestIdeaDuplicatesFailsAnIdeeOutsideTheContext(t *testing.T) {
	fn := lookup(t, "idea-duplicates")
	context := `{"idea":{"id":"a"},"projects":[],"openIdeas":[{"id":"a"},{"id":"b"}]}`
	for report, want := range map[string]bool{
		`{"duplicates":[{"id":"b"}]}`:        true,
		`{"duplicates":[]}`:                  true,
		`{"duplicates":[{"id":"c"}]}`:        false,
		`{"duplicates":[{"why":"sans id"}]}`: false,
	} {
		got, err := fn(t.Context(), ideaFolder(t, report, context), ideaParams)
		if err != nil || got != want {
			t.Errorf("%s: %v, %v, want %v", report, got, err, want)
		}
	}
}

// A report or a context missing, or no JSON, fails both checks without an
// error; params that name no file of the folder are an error.
func TestIdeaChecksFailAMissingOrInvalidFile(t *testing.T) {
	context := `{"idea":{"id":"a"},"projects":[{"id":"p"}],"openIdeas":[]}`
	folders := map[string]target.Target{
		"no report":         ideaFolder(t, "", context),
		"no context":        ideaFolder(t, `{"projectId":"p","duplicates":[]}`, ""),
		"report not json":   ideaFolder(t, `{"projectId":`, context),
		"context not json":  ideaFolder(t, `{"projectId":"p","duplicates":[]}`, `[1,2]`),
		"report of a shape": ideaFolder(t, `{"projectId":3,"duplicates":[]}`, context),
	}
	for _, name := range []string{"idea-project", "idea-duplicates"} {
		fn := lookup(t, name)
		for what, folder := range folders {
			if got, err := fn(t.Context(), folder, ideaParams); got || err != nil {
				t.Errorf("%s, %s: %v, %v, want false and no error", name, what, got, err)
			}
		}
		for _, params := range []map[string]any{nil, {"report": ".crewdeck/report.json"}, {"report": "../report.json", "context": ".crewdeck/context.json"}, {"report": 3, "context": "c"}} {
			if _, err := fn(t.Context(), folders["no report"], params); err == nil {
				t.Errorf("%s, params %v: no error", name, params)
			}
		}
	}
}

// ideaFolder is a folder with the report and the context given, an empty
// one not written.
func ideaFolder(t *testing.T, report, context string) target.Target {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, ".crewdeck"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string]string{"report.json": report, "context.json": context} {
		if data == "" {
			continue
		}
		if err := os.WriteFile(filepath.Join(dir, ".crewdeck", name), []byte(data), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return target.Target{Dir: dir}
}
