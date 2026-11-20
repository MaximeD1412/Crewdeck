package checks

import (
	"encoding/json"
	"fmt"
	"path/filepath"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// What the two checks of the Contrat `idea-analysis` (IDEE-2) share: the
// report the Skill wrote and the context the Runner wrote before it, both in
// the Session's scratch folder, at the paths of the rule's params.

// ideaReport is what the checks read of `.crewdeck/report.json`.
type ideaReport struct {
	ProjectID  *string `json:"projectId"`
	Duplicates []struct {
		ID *string `json:"id"`
	} `json:"duplicates"`
}

// ideaContext is what the checks read of `.crewdeck/context.json`.
type ideaContext struct {
	Idea struct {
		ID string `json:"id"`
	} `json:"idea"`
	Projects []struct {
		ID string `json:"id"`
	} `json:"projects"`
	OpenIdeas []struct {
		ID string `json:"id"`
	} `json:"openIdeas"`
}

// ideaFiles reads the report and the context the params name: ok false
// (the check fails) when either is missing or no JSON of its shape, an error
// when the params name no file of the folder.
func ideaFiles(name string, t target.Target, params map[string]any) (report ideaReport, context ideaContext, ok bool, err error) {
	paths := [2]string{}
	for i, key := range []string{"report", "context"} {
		path, isString := params[key].(string)
		if !isString || !filepath.IsLocal(filepath.FromSlash(path)) {
			return report, context, false, fmt.Errorf("%s: params.%s must be a path of the folder, got %v", name, key, params[key])
		}
		paths[i] = path
	}
	if ok, err = readJSON(t, paths[0], &report); !ok || err != nil {
		return report, context, false, err
	}
	ok, err = readJSON(t, paths[1], &context)
	return report, context, ok, err
}

// readJSON decodes the file at path into v: ok false when it is missing or
// is no JSON of v's shape.
func readJSON(t target.Target, path string, v any) (bool, error) {
	data, ok, err := t.ReadFile(path)
	if !ok || err != nil {
		return false, err
	}
	return json.Unmarshal(data, v) == nil, nil
}
