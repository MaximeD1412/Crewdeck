package rules

import (
	"context"
	"errors"
	"strings"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
)

// `sections`: the Markdown file at `path` has `headings` in this order, other
// headings allowed between them; only the headings of `level` count when it is given.

func validateSections(r Rule) error {
	if err := validatePath(r.Path); err != nil {
		return err
	}
	if len(r.Headings) == 0 {
		return errors.New("at least one heading")
	}
	if r.Level < 0 || r.Level > 6 {
		return errors.New("a level from 1 to 6")
	}
	return nil
}

func evaluateSections(_ context.Context, t target.Target, r Rule) (bool, error) {
	source, err := readFile(t, r.Path)
	if source == nil || err != nil {
		return false, err
	}
	next := 0
	for _, heading := range headings(source, r.Level) {
		if next < len(r.Headings) && heading == r.Headings[next] {
			next++
		}
	}
	return next == len(r.Headings), nil
}

// headings are the text of the Markdown headings of `source`, of `level` unless it is 0, in order.
func headings(source []byte, level int) []string {
	document := goldmark.DefaultParser().Parse(text.NewReader(source))
	var found []string
	_ = ast.Walk(document, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		heading, ok := node.(*ast.Heading)
		if !entering || !ok {
			return ast.WalkContinue, nil
		}
		if level == 0 || heading.Level == level {
			found = append(found, strings.TrimSpace(plainText(heading, source)))
		}
		return ast.WalkSkipChildren, nil
	})
	return found
}

// plainText is the text of a node's inline content, without its Markdown marks.
func plainText(node ast.Node, source []byte) string {
	var b strings.Builder
	_ = ast.Walk(node, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch n := n.(type) {
		case *ast.Text:
			b.Write(n.Segment.Value(source))
			if n.SoftLineBreak() || n.HardLineBreak() {
				b.WriteByte(' ')
			}
		case *ast.String:
			b.Write(n.Value)
		}
		return ast.WalkContinue, nil
	})
	return b.String()
}
