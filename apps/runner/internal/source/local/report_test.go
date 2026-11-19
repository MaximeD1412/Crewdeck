package local_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
)

// sent records the reports as the server would get them, encoded then decoded.
type sent struct {
	messages []contracts.RunnerLocalChanged
	fail     error
}

func (s *sent) send(_ context.Context, m contracts.RunnerLocalChanged) error {
	if s.fail != nil {
		return s.fail
	}
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	var back contracts.RunnerLocalChanged
	if err := json.Unmarshal(data, &back); err != nil {
		return err
	}
	s.messages = append(s.messages, back)
	return nil
}

func (s *sent) last(t *testing.T) contracts.RunnerLocalChanged {
	t.Helper()
	if len(s.messages) == 0 {
		t.Fatal("nothing sent")
	}
	return s.messages[len(s.messages)-1]
}

func unb64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// openText opens a sealed text of the report under `local:<projectId>:<place>`.
func openText(t *testing.T, v *keys.Vault, key, ciphertext, place string) (string, error) {
	t.Helper()
	plain, err := v.OpenItem(keys.SealedItem{Key: unb64(t, key), Ciphertext: unb64(t, ciphertext)}, []byte("local:"+projectID+":"+place))
	return string(plain), err
}

func ticketItem(t *testing.T, m contracts.RunnerLocalChanged, number int) *contracts.LocalItemTicket {
	t.Helper()
	for _, item := range m.Items {
		if item.Ticket != nil && item.Ticket.Number == number {
			return item.Ticket
		}
	}
	t.Fatalf("no ticket %d in %+v", number, m.Items)
	return nil
}

func kinds(m contracts.RunnerLocalChanged) []string {
	var out []string
	for _, item := range m.Items {
		out = append(out, item.Kind())
	}
	slices.Sort(out)
	return out
}

func TestReportSendsATicketItsProductLabelsReadableAndItsTextsSealed(t *testing.T) {
	dir := folder(t, map[string]string{
		"tickets/milestones.yml": "- title: Bêta\n  due_on: 2026-12-15\n- title: V1\n",
		"tickets/12-panier.md":   "---\nnumber: 12\ntitle: Panier partagé\nready: true\nlabels: [priority:P1, type:fix, revue-visuelle, ready-for-agent, backend]\nmilestone: V1\nblocked_by: [7]\n---\nLe corps secret.\n",
		"tickets/13-autre.md":    "---\nnumber: 13\ntitle: Autre\n---\n",
	})
	p := open(t, dir)
	var s sent
	if ok, err := p.Report(context.Background(), false, s.send); err != nil || !ok {
		t.Fatalf("report: %v, %v", ok, err)
	}
	m := s.last(t)
	if m.Type != "local.changed" || m.ProjectId != projectID || m.Full {
		t.Fatalf("message %+v", m)
	}
	if got := kinds(m); !slices.Equal(got, []string{"milestone", "milestone", "ticket", "ticket"}) {
		t.Fatalf("items %v", got)
	}
	ticket := ticketItem(t, m, 12)
	if !slices.Equal(ticket.Labels, []string{"priority:P1", "ready-for-agent"}) || ticket.BranchPrefix != "fix" || !ticket.VisualReview || !ticket.ReadyMark {
		t.Errorf("ticket 12 %+v", ticket)
	}
	if ticket.MilestoneRank != float64(2) || !slices.Equal(ticket.BlockedBy, []int{7}) || ticket.Parent != nil || ticket.ClosedAt != nil || !strings.HasPrefix(ticket.ContentHash, "v1.") {
		t.Errorf("ticket 12 %+v", ticket)
	}
	if !ticket.ObservedAt.Equal(ticket.UpdatedAt) {
		t.Errorf("observedAt %v, the file's modification time %v", ticket.ObservedAt, ticket.UpdatedAt)
	}
	v := p.vault
	if title, err := openText(t, v, ticket.TitleSealed.Key, ticket.TitleSealed.Ciphertext, "ticket:12:title"); err != nil || title != "Panier partagé" {
		t.Errorf("title %q, %v", title, err)
	}
	if _, err := openText(t, v, ticket.TitleSealed.Key, ticket.TitleSealed.Ciphertext, "ticket:13:title"); err == nil {
		t.Error("the title opened as Ticket 13's")
	}
	if ticket.LabelsSealed == nil {
		t.Fatal("no sealed labels")
	}
	if labels, err := openText(t, v, ticket.LabelsSealed.Key, ticket.LabelsSealed.Ciphertext, "ticket:12:labels"); err != nil || labels != `["type:fix","revue-visuelle","backend"]` {
		t.Errorf("labels %q, %v", labels, err)
	}
	other := ticketItem(t, m, 13)
	if other.LabelsSealed != nil || other.BranchPrefix != "feat" || other.VisualReview || other.MilestoneRank != nil || len(other.Labels) != 0 {
		t.Errorf("ticket 13 %+v", other)
	}
	for _, item := range m.Items {
		if item.Milestone == nil || item.Milestone.Rank != 1 {
			continue
		}
		if item.Milestone.DueOn == nil || *item.Milestone.DueOn != "2026-12-15" {
			t.Errorf("milestone 1 due %v", item.Milestone.DueOn)
		}
		if title, err := openText(t, v, item.Milestone.TitleSealed.Key, item.Milestone.TitleSealed.Ciphertext, "milestone:1:title"); err != nil || title != "Bêta" {
			t.Errorf("milestone title %q, %v", title, err)
		}
	}
	raw, _ := json.Marshal(m)
	for _, secret := range []string{"Panier", "corps", "backend", "type:fix", "panier.md", "Bêta"} {
		if strings.Contains(string(raw), secret) {
			t.Errorf("the report holds %q in clear", secret)
		}
	}
}

func TestReportSendsOnlyWhatChangedAndAgainWhatASendLost(t *testing.T) {
	dir := folder(t, map[string]string{"tickets/12-panier.md": "---\nnumber: 12\ntitle: Panier\n---\n", "tickets/13-autre.md": "---\nnumber: 13\ntitle: Autre\n---\n"})
	p := open(t, dir)
	var s sent
	ctx := context.Background()
	if _, err := p.Report(ctx, false, s.send); err != nil {
		t.Fatal(err)
	}
	if ok, err := p.Report(ctx, false, s.send); err != nil || ok || len(s.messages) != 1 {
		t.Fatalf("a report that found nothing new sent: %v, %v, %d", ok, err, len(s.messages))
	}
	write(t, dir, "tickets/13-autre.md", "---\nnumber: 13\ntitle: Autre, renommé\n---\n")
	s.fail = errors.New("hors ligne")
	if _, err := p.Report(ctx, false, s.send); err == nil {
		t.Fatal("a failed send said nothing")
	}
	s.fail = nil
	if ok, err := p.Report(ctx, false, s.send); err != nil || !ok {
		t.Fatalf("the lost change was not sent again: %v, %v", ok, err)
	}
	if got := kinds(s.last(t)); !slices.Equal(got, []string{"ticket"}) || ticketItem(t, s.last(t), 13) == nil {
		t.Fatalf("items %v", got)
	}
}

func TestReportFullSendsEveryItemAsLastSent(t *testing.T) {
	dir := folder(t, map[string]string{"tickets/12-panier.md": "---\nnumber: 12\ntitle: Panier\n---\n", "tickets/milestones.yml": "- title: Bêta\n"})
	p := open(t, dir)
	var s sent
	ctx := context.Background()
	if _, err := p.Report(ctx, false, s.send); err != nil {
		t.Fatal(err)
	}
	first := s.last(t)
	if ok, err := p.Report(ctx, true, s.send); err != nil || !ok {
		t.Fatalf("full report: %v, %v", ok, err)
	}
	full := s.last(t)
	if !full.Full || !slices.Equal(kinds(full), []string{"milestone", "ticket"}) {
		t.Fatalf("full %+v", full)
	}
	// The same sealed texts: the server sees nothing changed.
	if a, b := ticketItem(t, first, 12).TitleSealed, ticketItem(t, full, 12).TitleSealed; a != b {
		t.Errorf("the title was sealed again: %v, %v", a, b)
	}
}

func TestReportSaysWhatIsGone(t *testing.T) {
	dir := folder(t, map[string]string{
		"tickets/7-courses.md": "---\nnumber: 7\ntitle: Courses\n---\n", "tickets/12-panier.md": "---\nnumber: 12\ntitle: Panier\n---\n",
		"tickets/milestones.yml": "- title: Bêta\n- title: V1\n",
	})
	p := open(t, dir)
	var s sent
	ctx := context.Background()
	if _, err := p.Report(ctx, false, s.send); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dir, "tickets", "7-courses.md")); err != nil {
		t.Fatal(err)
	}
	write(t, dir, "tickets/milestones.yml", "- title: Bêta\n")
	if _, err := p.Report(ctx, false, s.send); err != nil {
		t.Fatal(err)
	}
	m := s.last(t)
	if got := kinds(m); !slices.Equal(got, []string{"milestone-removed", "ticket-removed"}) {
		t.Fatalf("items %v", got)
	}
	for _, item := range m.Items {
		if (item.TicketRemoved != nil && item.TicketRemoved.Number != 7) || (item.MilestoneRemoved != nil && item.MilestoneRemoved.Rank != 2) {
			t.Errorf("item %+v", item)
		}
	}
	if ok, _ := p.Report(ctx, false, s.send); ok {
		t.Error("what is gone was said twice")
	}
}

func TestReportSendsTheWholeUnreadableSetKeyedAndSealed(t *testing.T) {
	dir := folder(t, map[string]string{"tickets/7-courses.md": "---\nnumber: [\n---\n", "tickets/12-panier.md": "---\nnumber: 12\ntitle: Panier\n---\n"})
	p := open(t, dir)
	var s sent
	ctx := context.Background()
	if _, err := p.Report(ctx, false, s.send); err != nil {
		t.Fatal(err)
	}
	m := s.last(t)
	if len(m.Unreadable) != 1 || m.Unreadable[0].Reason != "front-matter" || len(unb64(t, m.Unreadable[0].Key)) != 16 {
		t.Fatalf("unreadable %+v", m.Unreadable)
	}
	u := m.Unreadable[0]
	if path, err := openText(t, p.vault, u.PathSealed.Key, u.PathSealed.Ciphertext, "unreadable:"+u.Key+":path"); err != nil || path != "tickets/7-courses.md" {
		t.Errorf("path %q, %v", path, err)
	}
	// A change elsewhere carries the set again, whole.
	write(t, dir, "tickets/12-panier.md", "---\nnumber: 12\ntitle: Panier, renommé\n---\n")
	if _, err := p.Report(ctx, false, s.send); err != nil {
		t.Fatal(err)
	}
	if again := s.last(t); len(again.Unreadable) != 1 || again.Unreadable[0] != u {
		t.Errorf("unreadable again %+v", again.Unreadable)
	}
	// Fixed: the empty set is news.
	write(t, dir, "tickets/7-courses.md", "---\nnumber: 7\ntitle: Courses\n---\n")
	if ok, err := p.Report(ctx, false, s.send); err != nil || !ok {
		t.Fatalf("the fix was not sent: %v, %v", ok, err)
	}
	if fixed := s.last(t); len(fixed.Unreadable) != 0 || ticketItem(t, fixed, 7) == nil {
		t.Errorf("fixed %+v", fixed)
	}
}

func TestReportSendsTheChangesOfLocalDB(t *testing.T) {
	dir := folder(t, map[string]string{"tickets/12-panier.md": "---\nnumber: 12\ntitle: Panier\n---\n"})
	p := open(t, dir)
	_, err := p.db.SQL().Exec(`INSERT INTO changes (project_id, number, title, head_ref, head_oid, base_ref, state, is_draft, author, created_at, updated_at)
		VALUES (?, 31, 'Panier partagé', 'fix/12-panier-partage', '3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a', 'main', 'open', 1, 'agent', '2026-11-19T08:30:00Z', '2026-11-19T08:45:00Z'),
		       (?, 32, 'Essai', 'essai', '', 'main', 'merged', 0, 'agent', '2026-11-19T08:30:00Z', '2026-11-19T08:50:00Z')`, projectID, projectID)
	if err != nil {
		t.Fatal(err)
	}
	var s sent
	if _, err := p.Report(context.Background(), false, s.send); err != nil {
		t.Fatal(err)
	}
	var changes []*contracts.LocalItemChange
	for _, item := range s.last(t).Items {
		if item.Change != nil {
			changes = append(changes, item.Change)
		}
	}
	if len(changes) != 2 {
		t.Fatalf("changes %+v", changes)
	}
	draft, merged := changes[0], changes[1]
	if draft.Number != 31 || draft.State != "draft" || draft.TicketNumber != float64(12) || draft.BaseRef != "main" || draft.HeadSha != "3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a" {
		t.Errorf("change 31 %+v", draft)
	}
	if title, err := openText(t, p.vault, draft.TitleSealed.Key, draft.TitleSealed.Ciphertext, "change:31:title"); err != nil || title != "Panier partagé" {
		t.Errorf("title %q, %v", title, err)
	}
	if merged.State != "merged" || merged.TicketNumber != nil || merged.HeadSha != nil {
		t.Errorf("change 32 %+v", merged)
	}
	raw, _ := json.Marshal(s.last(t))
	if strings.Contains(string(raw), "panier-partage") {
		t.Error("the head branch's name is in clear")
	}
}
