package local_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
)

const projectID = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a92"

func testVault(t *testing.T) *keys.Vault {
	t.Helper()
	runner, _ := keys.GenerateKeyPair()
	device, _ := keys.GenerateKeyPair()
	vaultKey, _ := keys.GenerateAESKey()
	w, err := keys.SealWrap(device, keys.PublicKeyBytes(runner), vaultKey, []byte(keys.InfoVaultWrap), keys.VaultWrapAAD("run_1", 1))
	if err != nil {
		t.Fatal(err)
	}
	v, err := keys.Unlock(runner, keys.PublicKeyBytes(device), "run_1", 1, w)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

// git runs git in dir, as the Pilote, and gives its output.
func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "user.name=Pilote", "-c", "user.email=pilote@example.test", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false"}, args...)...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

// folder is a Local Projet's folder: a git repository whose files are
// committed on main.
func folder(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	git(t, dir, "init", "--quiet")
	for name, content := range files {
		write(t, dir, name, content)
	}
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "--quiet", "--allow-empty", "-m", "Les Tickets")
	return dir
}

func write(t *testing.T, dir, name, content string) {
	t.Helper()
	path := filepath.Join(dir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, dir, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(name)))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

type opened struct {
	*local.Project
	db      *local.DB
	changes *[]source.Changed
}

func open(t *testing.T, dir string) opened {
	t.Helper()
	db, err := local.OpenDB(filepath.Join(t.TempDir(), "local.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	v := testVault(t)
	p := local.Open(db, func() *keys.Vault { return v }, projectID, dir)
	var changes []source.Changed
	p.OnChange(func(c source.Changed) { changes = append(changes, c) })
	return opened{Project: p, db: db, changes: &changes}
}

func TestLocalScanNumbersANewFileAndRenamesItWithoutACommit(t *testing.T) {
	dir := folder(t, map[string]string{
		"tickets/a.md":   "---\n# Ajouté à la main\ntitle: Paiement par carte Été\nestimate: 2 # jours\nlabels: [size:S]\n---\n\nLe corps.\n",
		"tickets/7-x.md": "---\nnumber: 7\ntitle: Le panier\n---\nCorps\n",
	})
	head := git(t, dir, "rev-parse", "HEAD")
	p := open(t, dir)
	scan, err := p.Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(scan.Unreadable) != 0 || len(scan.Tickets) != 2 {
		t.Fatalf("scan %+v", scan)
	}
	renamed := "tickets/8-paiement-par-carte-ete.md"
	// yaml.v3 quotes a value with a colon in a flow list when it writes the front matter again.
	want := "---\nnumber: 8\n# Ajouté à la main\ntitle: Paiement par carte Été\nestimate: 2 # jours\nlabels: ['size:S']\n---\n\nLe corps.\n"
	if got := read(t, dir, renamed); got != want {
		t.Errorf("%s:\n%s", renamed, got)
	}
	if _, err := os.Stat(filepath.Join(dir, "tickets", "a.md")); !os.IsNotExist(err) {
		t.Errorf("tickets/a.md still there: %v", err)
	}
	if got := git(t, dir, "status", "--porcelain", "--untracked-files=all"); got != "D tickets/a.md\n?? "+renamed && got != " D tickets/a.md\n?? "+renamed {
		t.Errorf("git status:\n%s", got)
	}
	if git(t, dir, "rev-parse", "HEAD") != head {
		t.Error("a commit was made")
	}
	ticket, err := p.Ticket(context.Background(), 8)
	if err != nil || ticket.Title != "Paiement par carte Été" || ticket.Body != "Le corps.\n" || ticket.CreatedAt.IsZero() || ticket.UpdatedAt.IsZero() {
		t.Errorf("Ticket 8: %+v, %v", ticket, err)
	}
	if next, err := p.NextNumber(context.Background()); err != nil || next != 9 {
		t.Errorf("next number %d, %v", next, err)
	}
}

func TestLocalScanReportsADuplicateNumberAndAFrontMatterThatDoesNotParse(t *testing.T) {
	dir := folder(t, map[string]string{
		"tickets/3-a.md":    "---\nnumber: 3\ntitle: Le premier\n---\n",
		"tickets/3-b.md":    "---\nnumber: 3\ntitle: Le second\n---\n",
		"tickets/4-bad.md":  "---\ntitle: [Le panier\n---\n",
		"tickets/5-good.md": "---\nnumber: 5\ntitle: Lisible\n---\n",
		"tickets/notes.txt": "pas un Ticket",
	})
	p := open(t, dir)
	scan, err := p.Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := []local.Unreadable{{Path: "tickets/3-b.md", Reason: local.ReasonDuplicateNumber}, {Path: "tickets/4-bad.md", Reason: local.ReasonFrontMatter}}
	if len(scan.Unreadable) != 2 || scan.Unreadable[0] != want[0] || scan.Unreadable[1] != want[1] {
		t.Errorf("unreadable %+v", scan.Unreadable)
	}
	if len(scan.Tickets) != 2 || scan.Tickets[0].Title != "Le premier" || scan.Tickets[1].Number != 5 {
		t.Errorf("tickets %+v", scan.Tickets)
	}
	if read(t, dir, "tickets/3-b.md") != "---\nnumber: 3\ntitle: Le second\n---\n" {
		t.Error("a duplicate was renumbered")
	}
	if next, _ := p.NextNumber(context.Background()); next != 6 {
		t.Errorf("next number %d, want 6", next)
	}
}

func TestLocalWritesTicketsInPlaceAndCallOnChange(t *testing.T) {
	dir := folder(t, map[string]string{
		"tickets/milestones.yml": "- title: M1\n  due_on: 2026-12-01\n- title: M2\n",
		"tickets/7-x.md":         "---\nnumber: 7\ntitle: Le panier\nestimate: 3\nlabels: [size:S]\n---\nCorps\n",
	})
	head := git(t, dir, "rev-parse", "HEAD")
	p := open(t, dir)
	ctx := context.Background()
	if _, err := p.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	*p.changes = nil

	parent := 7
	created, err := p.CreateTicket(ctx, source.NewTicket{Title: "Connexion par lien", Body: "Le corps.\n", Labels: []string{"size:M"}, Milestone: "M2", Parent: &parent})
	if err != nil {
		t.Fatal(err)
	}
	if created.Number != 8 || created.Milestone == nil || created.Milestone.Number != 2 {
		t.Errorf("created %+v", created)
	}
	if got := read(t, dir, "tickets/8-connexion-par-lien.md"); got != "---\nnumber: 8\ntitle: Connexion par lien\nlabels:\n  - size:M\nparent: 7\nmilestone: M2\n---\n\nLe corps.\n" {
		t.Errorf("created file:\n%s", got)
	}
	change, err := p.NextNumber(ctx)
	if err != nil || change != 9 {
		t.Errorf("a change's number %d, %v", change, err)
	}
	if next, _ := p.CreateTicket(ctx, source.NewTicket{Title: "Après le changement"}); next.Number != 10 {
		t.Errorf("the next Ticket after a change: %d", next.Number)
	}

	ready, title := true, "Le panier garde les articles"
	if _, err := p.EditTicket(ctx, 7, source.TicketEdit{Title: &title, Ready: &ready, AddLabels: []string{"priority:P1"}, RemoveLabels: []string{"size:S"}}); err != nil {
		t.Fatal(err)
	}
	if got := read(t, dir, "tickets/7-x.md"); got != "---\nnumber: 7\ntitle: Le panier garde les articles\nestimate: 3\nlabels: ['priority:P1']\nready: true\n---\nCorps\n" {
		t.Errorf("edited file:\n%s", got)
	}
	closed, err := p.SetTicketState(ctx, 7, source.TicketClosed, source.ReasonNotPlanned)
	if err != nil || closed.ClosedAt == nil || closed.State != source.TicketClosed || closed.StateReason != source.ReasonNotPlanned || closed.Title != title {
		t.Errorf("closed %+v, %v", closed, err)
	}
	if got := read(t, dir, "tickets/7-x.md"); got != "---\nnumber: 7\ntitle: Le panier garde les articles\nestimate: 3\nlabels: ['priority:P1']\nready: true\nstate: closed\nstate_reason: not_planned\n---\nCorps\n" {
		t.Errorf("closed file:\n%s", got)
	}

	comment, err := p.Comment(ctx, 7, "agent", "Fait dans feat/7-x.", "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a91")
	if err != nil {
		t.Fatal(err)
	}
	var session string
	if err := p.db.SQL().QueryRow(`SELECT session_id FROM comments WHERE id = ?`, comment.ID).Scan(&session); err != nil || session != "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a91" {
		t.Errorf("comment row: %q, %v", session, err)
	}
	comments, err := p.Comments(ctx, 7)
	if err != nil || len(comments) != 1 || comments[0].Body != "Fait dans feat/7-x." || comments[0].Author != "agent" {
		t.Errorf("comments %+v, %v", comments, err)
	}

	var numbers []int
	for _, c := range *p.changes {
		if c.ProjectID != projectID || c.Kind != source.KindTicket {
			t.Errorf("change %+v", c)
		}
		numbers = append(numbers, c.Number)
	}
	if got := fmt.Sprint(numbers); got != "[8 10 7 7 7]" {
		t.Errorf("OnChange numbers %s, want [8 10 7 7 7]", got)
	}
	*p.changes = nil
	if _, err := p.Scan(ctx); err != nil || len(*p.changes) != 0 {
		t.Errorf("a scan after the writes reports %+v, %v", *p.changes, err)
	}
	if git(t, dir, "rev-parse", "HEAD") != head || !strings.Contains(git(t, dir, "status", "--porcelain"), "tickets/7-x.md") {
		t.Error("the writes were committed, or not left in the working tree")
	}
}

func TestLocalRefusesAnUnknownMilestoneAndAMissingTicket(t *testing.T) {
	dir := folder(t, map[string]string{"tickets/milestones.yml": "- title: M1\n", "tickets/1-a.md": "---\nnumber: 1\ntitle: A\n---\n"})
	p := open(t, dir)
	ctx := context.Background()
	if _, err := p.CreateTicket(ctx, source.NewTicket{Title: "B", Milestone: "M9"}); !errors.Is(err, source.ErrUnknownMilestone) {
		t.Errorf("CreateTicket: %v", err)
	}
	m := "M9"
	if _, err := p.EditTicket(ctx, 1, source.TicketEdit{Milestone: &m}); !errors.Is(err, source.ErrUnknownMilestone) {
		t.Errorf("EditTicket: %v", err)
	}
	if _, err := p.Comment(ctx, 2, "agent", "?", ""); !errors.Is(err, source.ErrNotFound) {
		t.Errorf("Comment: %v", err)
	}
	if _, err := p.SetTicketState(ctx, 1, source.TicketOpen, source.ReasonCompleted); !errors.Is(err, local.ErrInvalidState) {
		t.Errorf("SetTicketState: %v", err)
	}
	if read(t, dir, "tickets/1-a.md") != "---\nnumber: 1\ntitle: A\n---\n" {
		t.Error("a refused write changed the file")
	}
}

func TestLocalMilestonesAreTheFilesInItsOrder(t *testing.T) {
	dir := folder(t, map[string]string{"tickets/milestones.yml": "- title: M1 Fondations\n  due_on: 2026-12-01\n- title: M0\n"})
	milestones, err := open(t, dir).Milestones(context.Background())
	if err != nil || len(milestones) != 2 {
		t.Fatalf("milestones %+v, %v", milestones, err)
	}
	if milestones[0].Number != 1 || milestones[0].Title != "M1 Fondations" || milestones[0].DueOn == nil || milestones[0].DueOn.Format(time.DateOnly) != "2026-12-01" || milestones[1].Number != 2 || milestones[1].DueOn != nil {
		t.Errorf("milestones %+v", milestones)
	}
}

func TestLocalSlug(t *testing.T) {
	for title, want := range map[string]string{
		"Paiement par carte Été":       "paiement-par-carte-ete",
		"  ¿Qué?  ":                    "que",
		"!!!":                          "ticket",
		strings.Repeat("abcdefgh ", 8): "abcdefgh-abcdefgh-abcdefgh-abcdefgh-abcdefgh",
		strings.Repeat("x", 60):        strings.Repeat("x", 50),
	} {
		if got := local.Slug(title); got != want {
			t.Errorf("Slug(%q) = %q, want %q", title, got, want)
		}
	}
}

func TestLocalScanNamesANewFileApartFromOneTaken(t *testing.T) {
	dir := folder(t, map[string]string{
		"tickets/2-a.md":   "---\nnumber: 2\ntitle: A\n---\n",
		"tickets/4-b.md":   "---\ntitle: [\n---\n",
		"tickets/new.md":   "# B\n",
		"tickets/other.md": "---\nnumber: 3\ntitle: Pris\n---\n",
	})
	if _, err := open(t, dir).Scan(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := read(t, dir, "tickets/4-b-2.md"); got != "---\nnumber: 4\ntitle: B\n---\n\n" {
		t.Errorf("4-b-2.md:\n%q", got)
	}
	if read(t, dir, "tickets/4-b.md") != "---\ntitle: [\n---\n" {
		t.Error("the unreadable 4-b.md was overwritten")
	}
}

func TestLocalRefusesAnEditThatWouldLeaveTheFileUnreadableAndLeavesItAsItWas(t *testing.T) {
	// The Pilote's key aliases a label: replacing the labels would drop its anchor.
	data := "---\nnumber: 1\ntitle: A\nlabels: [&taille size:S]\ncustom: *taille\n---\nCorps\n"
	dir := folder(t, map[string]string{"tickets/1-a.md": data})
	p := open(t, dir)
	ctx := context.Background()
	if _, err := p.EditTicket(ctx, 1, source.TicketEdit{AddLabels: []string{"priority:P1"}, RemoveLabels: []string{"size:S"}}); !errors.Is(err, local.ErrUnwritable) {
		t.Errorf("EditTicket: %v, want ErrUnwritable", err)
	}
	if got := read(t, dir, "tickets/1-a.md"); got != data {
		t.Errorf("the refused edit wrote:\n%s", got)
	}
	s, err := p.Scan(ctx)
	if err != nil || len(s.Unreadable) != 0 {
		t.Fatalf("scan after the refused edit: %+v, %v", s.Unreadable, err)
	}
	if ticket, err := p.Ticket(ctx, 1); err != nil || ticket.Title != "A" {
		t.Errorf("the Ticket after the refused edit: %+v, %v", ticket, err)
	}
}
