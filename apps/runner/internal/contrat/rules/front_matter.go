package rules

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
	"gopkg.in/yaml.v3"
)

// `front-matter`: at least one file matches `glob`, and each opens with a
// YAML front matter (between two `---` lines) valid against `schema`.

func validateFrontMatter(r Rule) error {
	if r.Path != "" {
		return errors.New("a glob, not a path")
	}
	if err := validateGlob(r.Glob); err != nil {
		return err
	}
	_, err := compileSchema(r.Schema)
	return err
}

func evaluateFrontMatter(_ context.Context, t target.Target, r Rule) (bool, error) {
	paths, err := files(t, r.Glob)
	if err != nil || len(paths) == 0 {
		return false, err
	}
	for _, path := range paths {
		data, err := readFile(t, path)
		if err != nil {
			return false, err
		}
		header, ok := frontMatter(data)
		if !ok {
			return false, nil
		}
		var value any
		if err := yaml.Unmarshal(header, &value); err != nil {
			return false, nil
		}
		// Through JSON, as the schema reads it: a key that is not a string fails the rule.
		asJSON, err := json.Marshal(value)
		if err != nil {
			return false, nil
		}
		if ok, err := matchesSchema(r.Schema, asJSON); !ok || err != nil {
			return false, err
		}
	}
	return true, nil
}

// frontMatter is the YAML between the file's first line `---` and the next `---` line.
func frontMatter(data []byte) ([]byte, bool) {
	data = bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n"))
	if !bytes.HasPrefix(data, []byte("---\n")) {
		return nil, false
	}
	rest := data[len("---\n"):]
	if bytes.HasPrefix(rest, []byte("---\n")) || bytes.Equal(rest, []byte("---")) {
		return []byte{}, true
	}
	end := bytes.Index(rest, []byte("\n---\n"))
	if end < 0 {
		if !bytes.HasSuffix(rest, []byte("\n---")) {
			return nil, false
		}
		end = len(rest) - len("\n---")
	}
	return rest[:end], true
}
