package migration

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

// pass is one comparison of the old place with the new: what it read of
// the old, and how many writes it took to make the new one match.
type pass struct {
	tickets    []source.CopiedTicket
	milestones []source.Milestone
	writes     int
}

// syncPass makes `to` match `from`: the milestones by title, each Ticket
// found by its marker (`<kind>#<n>`) and written when it differs, its
// comments found by theirs, then, every Ticket existing, the parents and
// blockers renumbered. late, when not nil, limits its writes to the old
// numbers of the Tickets and milestones it names (the finish's: the new
// Source has the others). It records each new number in p, and calls each
// after each Ticket.
func syncPass(ctx context.Context, from, to source.Copier, p *progress, late *lateSet, each func(done, total int)) (pass, error) {
	var only map[int]bool
	if late != nil {
		only = late.tickets
	}
	src, srcMilestones, err := from.ReadAll(ctx)
	if err != nil {
		return pass{}, err
	}
	dst, dstMilestones, err := to.ReadAll(ctx)
	if err != nil {
		return pass{}, err
	}
	out := pass{tickets: src, milestones: srcMilestones}

	// The milestones, by title, with their due date.
	milestones := map[string]source.Milestone{}
	for _, m := range dstMilestones {
		if _, ok := milestones[m.Title]; !ok {
			milestones[m.Title] = m
		}
	}
	for _, m := range srcMilestones {
		found, ok := milestones[m.Title]
		if late != nil && !late.milestones[m.Number] {
			if ok {
				p.Milestones[m.Number] = found.Number
			}
			continue
		}
		if !ok || due(found) != due(m) {
			number, err := to.PutMilestone(ctx, found.Number, m)
			if err != nil {
				return out, err
			}
			found = source.Milestone{Number: number, Title: m.Title, DueOn: m.DueOn}
			milestones[m.Title] = found
			out.writes++
		}
		p.Milestones[m.Number] = found.Number
	}

	// The Tickets, by their marker.
	byFrom := map[string]source.CopiedTicket{}
	for _, t := range dst {
		if t.From != "" {
			byFrom[t.From] = t
		}
	}
	current := map[int]source.CopiedTicket{}
	for i, t := range src {
		key := keyOf(from.Kind(), t.Number)
		was, exists := byFrom[key]
		if only != nil && !only[t.Number] {
			if exists {
				p.Tickets[t.Number] = was.Number
			}
			continue
		}
		want := t.Ticket
		want.Milestone = nil
		if t.Milestone != nil {
			if m, ok := milestones[t.Milestone.Title]; ok { // none when the new Source removed it since the switch
				want.Milestone = &m
			}
		}
		number := 0
		if exists {
			number = was.Number
		}
		if !exists || !same(was.Ticket, want) {
			if number, err = to.PutTicket(ctx, number, want, key); err != nil {
				return out, err
			}
			out.writes++
		}
		p.Tickets[t.Number] = number
		if !exists {
			was = source.CopiedTicket{Ticket: source.Ticket{Number: number, BlockedBy: []int{}}}
		}
		current[t.Number] = was
		copied := map[string]bool{}
		for _, c := range was.Comments {
			copied[c.From] = true
		}
		for _, c := range t.Comments {
			marker := key + "/comment/" + c.ID
			if copied[marker] {
				continue
			}
			if err := to.AddComment(ctx, number, c.Comment, marker); err != nil {
				return out, err
			}
			out.writes++
		}
		if each != nil {
			each(i+1, len(src))
		}
	}

	// The parents and blockers, every Ticket existing.
	for _, t := range src {
		was, ok := current[t.Number]
		if !ok {
			continue
		}
		parent := 0
		if t.Parent != nil {
			parent = p.Tickets[*t.Parent]
		}
		blockedBy := []int{}
		for _, b := range t.BlockedBy {
			if n, ok := p.Tickets[b]; ok {
				blockedBy = append(blockedBy, n)
			}
		}
		slices.Sort(blockedBy)
		parentNow := 0
		if was.Parent != nil {
			parentNow = *was.Parent
		}
		had := slices.Clone(was.BlockedBy)
		slices.Sort(had)
		if parent == parentNow && slices.Equal(blockedBy, had) {
			continue
		}
		if err := to.Link(ctx, was, parent, blockedBy); err != nil {
			return out, err
		}
		out.writes++
	}
	return out, nil
}

// lateSet is what changed in the old place since the switch's fingerprints:
// Tickets and milestones by their old number.
type lateSet struct {
	tickets    map[int]bool
	milestones map[int]bool
}

func keyOf(kind string, number int) string { return kind + "#" + strconv.Itoa(number) }

// same is whether the copy holds what the Ticket says: its title, text,
// state, readiness, labels and milestone.
func same(a, b source.Ticket) bool {
	if strings.TrimSpace(a.Title) != strings.TrimSpace(b.Title) || text(a.Body) != text(b.Body) || a.State != b.State || reason(a) != reason(b) || a.Ready != b.Ready {
		return false
	}
	if !slices.Equal(sorted(a.Labels), sorted(b.Labels)) {
		return false
	}
	return milestoneTitle(a) == milestoneTitle(b)
}

func text(body string) string {
	return strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(body, "\r\n", "\n"), "\r", "\n"))
}

func reason(t source.Ticket) source.StateReason {
	if t.State != source.TicketClosed {
		return source.ReasonNone
	}
	if t.StateReason == source.ReasonNone {
		return source.ReasonCompleted
	}
	return t.StateReason
}

func sorted(labels []string) []string {
	out := slices.Clone(labels)
	slices.Sort(out)
	return slices.Compact(out)
}

// due is the milestone's due date as both Sources hold it: a day ("" for none).
func due(m source.Milestone) string {
	if m.DueOn == nil {
		return ""
	}
	return m.DueOn.UTC().Format(time.DateOnly)
}

func milestoneTitle(t source.Ticket) string {
	if t.Milestone == nil {
		return ""
	}
	return t.Milestone.Title
}

// fingerprintLabel derives the key of the migrations' fingerprints.
const fingerprintLabel = "crewdeck/v1/migration-fingerprint"

// fingerprint is the Ticket as the switch saw it, without its content: its
// key, its state and an HMAC of all a pass compares, under a key of the
// vault (the server cannot guess a title from it).
func fingerprint(vault *keys.Vault, kind string, t source.CopiedTicket) (key, state, hash string) {
	var b strings.Builder
	b.WriteString(strings.TrimSpace(t.Title) + "\x00" + text(t.Body) + "\x00" + string(t.State) + "\x00" + string(reason(t.Ticket)) + "\x00")
	b.WriteString(strconv.FormatBool(t.Ready) + "\x00" + strings.Join(sorted(t.Labels), "\x01") + "\x00" + milestoneTitle(t.Ticket) + "\x00")
	if t.Parent != nil {
		b.WriteString(strconv.Itoa(*t.Parent))
	}
	blockers := slices.Clone(t.BlockedBy)
	slices.Sort(blockers)
	for _, n := range blockers {
		b.WriteString("\x00" + strconv.Itoa(n))
	}
	b.WriteString("\x00" + strconv.Itoa(len(t.Comments)))
	for _, c := range t.Comments {
		b.WriteString("\x01" + c.ID)
	}
	mac := hmac.New(sha256.New, vault.DeriveKey(fingerprintLabel))
	mac.Write([]byte(b.String()))
	return keyOf(kind, t.Number), string(t.State), hex.EncodeToString(mac.Sum(nil))
}

// milestoneFingerprint is the milestone as the switch saw it: its key
// (`<kind>#milestone/<n>`) and an HMAC of its title and due date.
func milestoneFingerprint(vault *keys.Vault, kind string, m source.Milestone) (key, hash string) {
	mac := hmac.New(sha256.New, vault.DeriveKey(fingerprintLabel))
	mac.Write([]byte("milestone\x00" + strings.TrimSpace(m.Title) + "\x00" + due(m)))
	return kind + "#milestone/" + strconv.Itoa(m.Number), hex.EncodeToString(mac.Sum(nil))
}
