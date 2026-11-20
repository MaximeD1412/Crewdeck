package local_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
)

const adrTicket = `---
number: 12
title: Connexion par lien envoyé par e-mail
state: open            # open | closed
state_reason: null     # completed | not_planned, when closed
ready: true
labels: [priority:P1, size:S]
blocked_by: [7, 9]
parent: null
milestone: M1
---

The body, as plan-backlog writes it.
`

func TestLocalTicketFileParsesTheFrontMatterOfTheADR(t *testing.T) {
	f, err := local.Parse([]byte(adrTicket))
	if err != nil {
		t.Fatal(err)
	}
	if f.Number != 12 || f.Title != "Connexion par lien envoyé par e-mail" || f.State != source.TicketOpen || f.StateReason != source.ReasonNone || !f.Ready {
		t.Errorf("parsed %+v", f)
	}
	if strings.Join(f.Labels, ",") != "priority:P1,size:S" || len(f.BlockedBy) != 2 || f.BlockedBy[1] != 9 || f.Parent != nil || f.Milestone != "M1" {
		t.Errorf("parsed %+v", f)
	}
	if f.Body != "The body, as plan-backlog writes it.\n" {
		t.Errorf("body %q", f.Body)
	}
	if got := string(local.Format(f)); got != adrTicket {
		t.Errorf("a rewrite without a change:\n%s", got)
	}
}

func TestLocalTicketFileDefaultsToOpenAndNotReady(t *testing.T) {
	f, err := local.Parse([]byte("---\ntitle: Le panier\nparent: 3\n---\nGarder.\n"))
	if err != nil {
		t.Fatal(err)
	}
	if f.Number != 0 || f.State != source.TicketOpen || f.Ready || f.Milestone != "" || f.Parent == nil || *f.Parent != 3 || f.Body != "Garder.\n" {
		t.Errorf("parsed %+v", f)
	}
}

func TestLocalTicketFileWithoutFrontMatterReadsItsHeadingAsTheTitle(t *testing.T) {
	f, err := local.Parse([]byte("# Le panier garde les articles\n\nAprès un rechargement.\n"))
	if err != nil {
		t.Fatal(err)
	}
	if f.Title != "Le panier garde les articles" || f.Body != "Après un rechargement.\n" || f.State != source.TicketOpen {
		t.Errorf("parsed %+v", f)
	}
	f.Number = 4
	want := "---\nnumber: 4\ntitle: Le panier garde les articles\n---\n\nAprès un rechargement.\n"
	if got := string(local.Format(f)); got != want {
		t.Errorf("formatted:\n%s", got)
	}
}

func TestLocalTicketFileRefusesAFrontMatterThatDoesNotParse(t *testing.T) {
	for name, data := range map[string]string{
		"no title":             "---\nnumber: 3\n---\nCorps\n",
		"not yaml":             "---\ntitle: [Le panier\n---\n",
		"not closed":           "---\ntitle: Le panier\n",
		"a state of none":      "---\ntitle: Le panier\nstate: done\n---\n",
		"a reason of none":     "---\ntitle: Le panier\nstate: closed\nstate_reason: wontfix\n---\n",
		"a number not a count": "---\nnumber: trois\ntitle: Le panier\n---\n",
		"labels not a list":    "---\ntitle: Le panier\nlabels: P1\n---\n",
		"no heading":           "Le panier\n",
	} {
		if _, err := local.Parse([]byte(data)); !errors.Is(err, local.ErrFrontMatter) {
			t.Errorf("%s: %v, want ErrFrontMatter", name, err)
		}
	}
}

func TestLocalTicketFileRewriteKeepsTheKeysOrderThePilotesKeysAndComments(t *testing.T) {
	data := "---\n# Écrit à la main\ntitle: Le panier\nestimate: 3 # jours\nlabels:\n  - size:S\nready: false\n---\nCorps\n"
	f, err := local.Parse([]byte(data))
	if err != nil {
		t.Fatal(err)
	}
	f.Number = 8
	f.Ready = true
	f.Labels = append(f.Labels, "priority:P1")
	f.State, f.StateReason = source.TicketClosed, source.ReasonNotPlanned
	want := "---\nnumber: 8\n# Écrit à la main\ntitle: Le panier\nestimate: 3 # jours\nlabels:\n  - size:S\n  - priority:P1\nready: true\nstate: closed\nstate_reason: not_planned\n---\nCorps\n"
	if got := string(local.Format(f)); got != want {
		t.Errorf("formatted:\n%s\nwant:\n%s", got, want)
	}
}

func TestLocalTicketFileRewriteKeepsTheAnchorOfAKeyItChangesForThePilotesAlias(t *testing.T) {
	data := "---\nnumber: 3\ntitle: &titre Ancien\ncustom: *titre\n---\nCorps\n"
	f, err := local.Parse([]byte(data))
	if err != nil {
		t.Fatal(err)
	}
	f.Title = "Nouveau"
	want := "---\nnumber: 3\ntitle: &titre Nouveau\ncustom: *titre\n---\nCorps\n"
	got := local.Format(f)
	if string(got) != want {
		t.Errorf("formatted:\n%s\nwant:\n%s", got, want)
	}
	if reread, err := local.Parse(got); err != nil || reread.Title != "Nouveau" {
		t.Errorf("reread %+v, %v", reread, err)
	}
}

func TestLocalTicketFileKeepsTheIssueAMigrationCopiedItFrom(t *testing.T) {
	f, err := local.Parse([]byte("---\nnumber: 3\ntitle: Le panier\n---\nGarder.\n"))
	if err != nil {
		t.Fatal(err)
	}
	f.From = "github#57"
	written := string(local.Format(f))
	if !strings.Contains(written, "from: github#57\n") {
		t.Fatalf("written:\n%s", written)
	}
	again, err := local.Parse([]byte(written))
	if err != nil || again.From != "github#57" {
		t.Fatalf("read again %+v, %v", again, err)
	}
	if _, err := local.Parse([]byte("---\ntitle: Le panier\nfrom: [1]\n---\n")); err == nil {
		t.Error("a from that is not a scalar parsed")
	}
}
