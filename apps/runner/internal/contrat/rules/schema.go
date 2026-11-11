package rules

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// The JSON Schemas of the `json` and `front-matter` rules, draft 2020-12 by default.

const schemaURL = "https://crewdeck.invalid/contrat/rule.schema.json"

func compileSchema(raw json.RawMessage) (*jsonschema.Schema, error) {
	if len(raw) == 0 {
		return nil, errors.New("a schema")
	}
	document, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("schema: %w", err)
	}
	compiler := jsonschema.NewCompiler()
	compiler.DefaultDraft(jsonschema.Draft2020)
	// A schema of a Contrat stands alone: no $ref out of it is ever fetched.
	compiler.UseLoader(noLoader{})
	if err := compiler.AddResource(schemaURL, document); err != nil {
		return nil, fmt.Errorf("schema: %w", err)
	}
	schema, err := compiler.Compile(schemaURL)
	if err != nil {
		return nil, fmt.Errorf("schema: %w", err)
	}
	return schema, nil
}

type noLoader struct{}

func (noLoader) Load(url string) (any, error) {
	return nil, fmt.Errorf("a Contrat's schema loads nothing, not %s", url)
}

// matchesSchema says whether the JSON `data` is valid against `raw`.
func matchesSchema(raw json.RawMessage, data []byte) (bool, error) {
	schema, err := compileSchema(raw)
	if err != nil {
		return false, err
	}
	value, err := jsonschema.UnmarshalJSON(bytes.NewReader(data))
	if err != nil {
		return false, nil
	}
	return schema.Validate(value) == nil, nil
}
