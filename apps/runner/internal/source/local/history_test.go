package local_test

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalTicketURLIsItsFile(t *testing.T) {
	dir := folder(t, map[string]string{"tickets/12-x.md": "---\nnumber: 12\ntitle: Douze\n---\n"})
	p := open(t, dir)
	ticket, err := p.Ticket(context.Background(), 12)
	if err != nil {
		t.Fatal(err)
	}
	if want := "file://" + filepath.ToSlash(filepath.Join(dir, "tickets", "12-x.md")); ticket.URL != want {
		t.Fatalf("URL %q, want %q", ticket.URL, want)
	}
}

func TestLocalHistoryReadsTheBranchInTheCloneFirst(t *testing.T) {
	dir := folder(t, map[string]string{"README.md": "x"})
	base := git(t, dir, "rev-parse", "HEAD")
	p := open(t, dir)
	if _, err := p.db.SQL().Exec(`INSERT INTO changes (project_id, number, title, head_ref, head_oid, base_ref, author, created_at, updated_at)
		VALUES (?, 7, 'Sept', 'feat/12-x', 'recorded', 'main', 'developpeur', '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z')`, projectID); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	// No such branch yet: the head local.db recorded, no commit.
	h, err := p.History(ctx, 7)
	if err != nil {
		t.Fatal(err)
	}
	if h.HeadOid != "recorded" || len(h.Commits) != 0 {
		t.Fatalf("history %+v", h)
	}

	// Pushed to the folder.
	git(t, dir, "checkout", "--quiet", "-b", "feat/12-x")
	write(t, dir, "a.txt", "a")
	git(t, dir, "add", "a.txt")
	git(t, dir, "commit", "--quiet", "-m", "Premier\n\nSon corps.")
	pushed := git(t, dir, "rev-parse", "HEAD")
	git(t, dir, "checkout", "--quiet", "main")
	if h, err = p.History(ctx, 7); err != nil {
		t.Fatal(err)
	}
	if h.HeadOid != pushed || len(h.Commits) != 1 || h.Commits[0].Oid != pushed || h.Commits[0].Message != "Premier\n\nSon corps." {
		t.Fatalf("history %+v", h)
	}

	// The clone has a later commit on the branch: it wins.
	clone := filepath.Join(t.TempDir(), "clone")
	git(t, filepath.Dir(clone), "clone", "--quiet", dir, clone)
	git(t, clone, "checkout", "--quiet", "feat/12-x")
	write(t, clone, "b.txt", "b")
	git(t, clone, "add", "b.txt")
	git(t, clone, "commit", "--quiet", "-m", "Second")
	later := git(t, clone, "rev-parse", "HEAD")
	p.SetClone(clone)
	if h, err = p.History(ctx, 7); err != nil {
		t.Fatal(err)
	}
	if h.HeadOid != later || len(h.Commits) != 2 || h.Commits[0].Oid != pushed || h.Commits[1].Message != "Second" {
		t.Fatalf("history %+v", h)
	}
	if strings.Contains(h.HeadOid, base) {
		t.Fatal("the base is not the head")
	}
}
