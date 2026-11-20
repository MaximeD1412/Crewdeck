package local

import (
	"bytes"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	"gopkg.in/yaml.v3"
)

// ErrFrontMatter: a Ticket's file whose front matter does not parse, or
// lacks its title (ADR 0012): the file is skipped, SOURCE-3 raises
// `ticket.local-unreadable`.
var ErrFrontMatter = errors.New("local: the front matter does not parse")

// TicketFile is a Local Ticket's file, `tickets/<n>-<slug>.md`: its front
// matter (ADR 0012) and its body. Format writes back the Pilote's own keys,
// their order and their comments.
type TicketFile struct {
	// Number is 0 when the file has none yet.
	Number      int
	Title       string
	State       source.TicketState
	StateReason source.StateReason
	Ready       bool
	Labels      []string
	BlockedBy   []int
	Parent      *int
	// Milestone is a milestone's title, "" for none.
	Milestone string
	// From is the issue a migration copied it from (`github#57`, SOURCE-8), "" for none.
	From string
	Body string

	// What was read: the front matter's text and document, the fields as
	// they parsed, and the blank lines between the front matter and the body.
	raw    string
	doc    *yaml.Node
	parsed *TicketFile
	gap    string
}

const delimiter = "---"

// Parse reads a Ticket's file: a front matter between `---` lines and its
// body; or, with no front matter, a first line `# <title>` and the rest as
// the body.
func Parse(data []byte) (TicketFile, error) {
	text := strings.ReplaceAll(string(data), "\r\n", "\n")
	if !strings.HasPrefix(text, delimiter+"\n") {
		return parseHeading(text)
	}
	rest := text[len(delimiter)+1:]
	var raw, after string
	switch {
	case strings.HasPrefix(rest, delimiter+"\n"):
		after = rest[len(delimiter)+1:]
	case rest == delimiter:
	default:
		end := strings.Index(rest, "\n"+delimiter+"\n")
		if end < 0 {
			if !strings.HasSuffix(rest, "\n"+delimiter) {
				return TicketFile{}, ErrFrontMatter
			}
			end = len(rest) - len(delimiter) - 1
			raw = rest[:end+1]
		} else {
			raw, after = rest[:end+1], rest[end+len(delimiter)+2:]
		}
	}
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(raw), &doc); err != nil {
		return TicketFile{}, ErrFrontMatter
	}
	if doc.Kind == 0 { // an empty front matter
		doc = yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{{Kind: yaml.MappingNode, Tag: "!!map"}}}
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) != 1 || doc.Content[0].Kind != yaml.MappingNode {
		return TicketFile{}, ErrFrontMatter
	}
	f := TicketFile{State: source.TicketOpen, raw: raw, doc: &doc}
	if err := f.read(doc.Content[0]); err != nil {
		return TicketFile{}, err
	}
	body := strings.TrimLeft(after, "\n")
	f.gap, f.Body = after[:len(after)-len(body)], body
	parsed := f.fields()
	f.parsed = &parsed
	return f, nil
}

func parseHeading(text string) (TicketFile, error) {
	first, rest, _ := strings.Cut(text, "\n")
	title, ok := strings.CutPrefix(first, "# ")
	title = strings.TrimSpace(title)
	if !ok || title == "" {
		return TicketFile{}, ErrFrontMatter
	}
	return TicketFile{Title: title, State: source.TicketOpen, Body: strings.TrimLeft(rest, "\n"), gap: "\n"}, nil
}

func (f *TicketFile) read(mapping *yaml.Node) error {
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		value := mapping.Content[i+1]
		var err error
		switch mapping.Content[i].Value {
		case "number":
			err = value.Decode(&f.Number)
			if err == nil && f.Number < 1 {
				err = ErrFrontMatter
			}
		case "title":
			if value.Kind != yaml.ScalarNode || value.Tag == "!!null" {
				return ErrFrontMatter
			}
			f.Title = strings.TrimSpace(value.Value)
		case "state":
			var s string
			if err = value.Decode(&s); err == nil {
				f.State = source.TicketState(s)
				if f.State != source.TicketOpen && f.State != source.TicketClosed {
					err = ErrFrontMatter
				}
			}
		case "state_reason":
			var s *string
			if err = value.Decode(&s); err == nil && s != nil {
				f.StateReason = source.StateReason(*s)
				if f.StateReason != source.ReasonCompleted && f.StateReason != source.ReasonNotPlanned {
					err = ErrFrontMatter
				}
			}
		case "ready":
			var ready *bool
			if err = value.Decode(&ready); err == nil && ready != nil {
				f.Ready = *ready
			}
		case "labels":
			err = decodeList(value, &f.Labels)
		case "blocked_by":
			err = decodeList(value, &f.BlockedBy)
		case "parent":
			err = value.Decode(&f.Parent)
			if err == nil && f.Parent != nil && *f.Parent < 1 {
				err = ErrFrontMatter
			}
		case "from":
			if value.Kind != yaml.ScalarNode {
				return ErrFrontMatter
			}
			if value.Tag != "!!null" {
				f.From = strings.TrimSpace(value.Value)
			}
		case "milestone":
			if value.Kind != yaml.ScalarNode {
				return ErrFrontMatter
			}
			if value.Tag != "!!null" {
				f.Milestone = strings.TrimSpace(value.Value)
			}
		}
		if err != nil {
			return ErrFrontMatter
		}
	}
	if f.Title == "" {
		return ErrFrontMatter
	}
	if f.State == source.TicketOpen {
		f.StateReason = source.ReasonNone
	}
	return nil
}

func decodeList[T any](value *yaml.Node, into *[]T) error {
	if value.Tag == "!!null" {
		return nil
	}
	if value.Kind != yaml.SequenceNode {
		return ErrFrontMatter
	}
	return value.Decode(into)
}

// fields is the file's values alone, for telling what changed.
func (f TicketFile) fields() TicketFile {
	return TicketFile{
		Number: f.Number, Title: f.Title, State: f.State, StateReason: f.StateReason, Ready: f.Ready,
		Labels: slices.Clone(f.Labels), BlockedBy: slices.Clone(f.BlockedBy), Parent: f.Parent, Milestone: f.Milestone, From: f.From,
	}
}

func (f TicketFile) sameFields(o TicketFile) bool {
	return f.Number == o.Number && f.Title == o.Title && f.State == o.State && f.StateReason == o.StateReason && f.Ready == o.Ready &&
		slices.Equal(f.Labels, o.Labels) && slices.Equal(f.BlockedBy, o.BlockedBy) && equalPtr(f.Parent, o.Parent) && f.Milestone == o.Milestone && f.From == o.From
}

func equalPtr(a, b *int) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }

// field is one key of the front matter: its value, whether that value is
// the default a file may leave out, and the style it takes when new.
type field struct {
	key    string
	value  any
	absent bool
}

func (f TicketFile) frontFields() []field {
	var reason any
	if f.StateReason != source.ReasonNone {
		reason = string(f.StateReason)
	}
	var milestone any
	if f.Milestone != "" {
		milestone = f.Milestone
	}
	var parent any
	if f.Parent != nil {
		parent = *f.Parent
	}
	var from any
	if f.From != "" {
		from = f.From
	}
	return []field{
		{"number", f.Number, f.Number == 0},
		{"title", f.Title, false},
		{"state", string(f.State), f.State == source.TicketOpen || f.State == ""},
		{"state_reason", reason, reason == nil},
		{"ready", f.Ready, !f.Ready},
		{"labels", f.Labels, len(f.Labels) == 0},
		{"blocked_by", f.BlockedBy, len(f.BlockedBy) == 0},
		{"parent", parent, parent == nil},
		{"milestone", milestone, milestone == nil},
		{"from", from, from == nil},
	}
}

// Format writes the file: the front matter as it was read when no field
// changed, else with each changed key rewritten in place (a new key last,
// `number` first), the Pilote's other keys and comments kept; then the body.
func Format(f TicketFile) []byte {
	var out bytes.Buffer
	out.WriteString(delimiter + "\n")
	if f.doc != nil && f.parsed != nil && f.sameFields(*f.parsed) {
		out.WriteString(f.raw)
	} else {
		out.Write(f.encodeFrontMatter())
	}
	out.WriteString(delimiter + "\n")
	out.WriteString(f.gap)
	out.WriteString(f.Body)
	return out.Bytes()
}

// rewrite is Format checked: the file as it is written and as it reads
// back, ErrUnwritable when it would not parse, before anything is written.
func rewrite(f TicketFile) ([]byte, TicketFile, error) {
	data := Format(f)
	written, err := Parse(data)
	if err != nil {
		return nil, TicketFile{}, fmt.Errorf("%w: %v", ErrUnwritable, err)
	}
	return data, written, nil
}

func (f TicketFile) encodeFrontMatter() []byte {
	var doc *yaml.Node
	if f.doc != nil {
		doc = cloneNode(f.doc)
	} else {
		doc = &yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{{Kind: yaml.MappingNode, Tag: "!!map"}}}
	}
	mapping := doc.Content[0]
	var before TicketFile
	if f.parsed != nil {
		before = *f.parsed
	}
	old := map[string]any{}
	for _, fd := range before.frontFields() {
		old[fd.key] = fd.value
	}
	for _, fd := range f.frontFields() {
		at := keyIndex(mapping, fd.key)
		if at >= 0 {
			if f.parsed == nil || !equalValue(old[fd.key], fd.value) {
				setValue(mapping.Content[at+1], fd.value)
			}
			continue
		}
		if fd.absent {
			continue
		}
		key := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: fd.key}
		value := &yaml.Node{}
		setValue(value, fd.value)
		if fd.key == "number" {
			mapping.Content = append([]*yaml.Node{key, value}, mapping.Content...)
		} else {
			mapping.Content = append(mapping.Content, key, value)
		}
	}
	var out bytes.Buffer
	enc := yaml.NewEncoder(&out)
	enc.SetIndent(2)
	if err := enc.Encode(doc); err != nil {
		panic(err) // nodes this package built
	}
	enc.Close()
	return out.Bytes()
}

func equalValue(a, b any) bool {
	switch av := a.(type) {
	case []string:
		bv, _ := b.([]string)
		return slices.Equal(av, bv)
	case []int:
		bv, _ := b.([]int)
		return slices.Equal(av, bv)
	}
	return a == b
}

func keyIndex(mapping *yaml.Node, key string) int {
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		if mapping.Content[i].Value == key {
			return i
		}
	}
	return -1
}

// setValue gives node the value, keeping its comments, its anchor (a
// Pilote's alias of it still resolves) and, for a list, its flow or block
// style.
func setValue(node *yaml.Node, value any) {
	var fresh yaml.Node
	if err := fresh.Encode(value); err != nil {
		panic(err)
	}
	fresh.Style |= node.Style & yaml.FlowStyle
	if fresh.Kind == yaml.SequenceNode && len(fresh.Content) == 0 {
		fresh.Style |= yaml.FlowStyle
	}
	fresh.HeadComment, fresh.LineComment, fresh.FootComment = node.HeadComment, node.LineComment, node.FootComment
	if node.Kind != yaml.AliasNode {
		fresh.Anchor = node.Anchor
	}
	*node = fresh
}

func cloneNode(n *yaml.Node) *yaml.Node {
	c := *n
	c.Content = make([]*yaml.Node, len(n.Content))
	for i, child := range n.Content {
		c.Content[i] = cloneNode(child)
	}
	return &c
}
