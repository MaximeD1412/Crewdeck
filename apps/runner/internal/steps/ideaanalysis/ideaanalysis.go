// Package ideaanalysis is what the Runner does itself for the Étape
// `idea-analysis` (IDEE-2, US-48), beside its Skill: before the Moteur runs,
// it writes in the Session's scratch folder the context the Skill reads (the
// Idée, the Projets and their open Tickets, the other open Idées), every text
// opened on the machine; once the Contrat passed on the report the Skill
// wrote, it reads the figures the server may read and the sentences it seals
// under "<ideaId>:analysis".
package ideaanalysis

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mirror"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
)

// The files of the scratch folder (IDEA_ANALYSIS_CONTEXT_PATH,
// IDEA_ANALYSIS_REPORT_PATH).
const (
	ContextPath = ".crewdeck/context.json"
	ReportPath  = ".crewdeck/report.json"
)

// ticketsMax is how many open Tickets of a Projet the context lists, the
// newest first.
const ticketsMax = 100

// Store is the Miroir's copy as the context reads it (*mirror.Store).
type Store interface {
	Projects() ([]mirror.Project, error)
	List(key string, f mirror.Filter) ([]map[string]any, error)
}

// Opener opens an item sealed under the vault key (the held vault).
type Opener interface {
	OpenItem(item keys.SealedItem, aad []byte) ([]byte, error)
}

// Context is `.crewdeck/context.json`.
type Context struct {
	Idea      Idea       `json:"idea"`
	Projects  []Project  `json:"projects"`
	OpenIdeas []OpenIdea `json:"openIdeas"`
}

// Idea is the Idée analysed, its text opened.
type Idea struct {
	ID     string `json:"id"`
	Number int    `json:"number"`
	Text   string `json:"text"`
}

// Project is a Projet of the Pilote and its open Tickets.
type Project struct {
	ID      string           `json:"id"`
	Name    string           `json:"name"`
	Tickets []map[string]any `json:"tickets"`
}

// OpenIdea is another open Idée: its analysis's title and summary, else its
// text's first line and the rest.
type OpenIdea struct {
	ID      string `json:"id"`
	Number  int    `json:"number"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
}

// Report is `.crewdeck/report.json`, as its Contrat passed it.
type Report struct {
	Title      string      `json:"title"`
	Summary    string      `json:"summary"`
	ProjectID  string      `json:"projectId"`
	ProjectWhy string      `json:"projectWhy"`
	Impact     int         `json:"impact"`
	ImpactWhy  string      `json:"impactWhy"`
	Effort     int         `json:"effort"`
	EffortWhy  string      `json:"effortWhy"`
	Duplicates []Duplicate `json:"duplicates"`
	Questions  []string    `json:"questions"`
}

// Duplicate is an open Idée the Idée may repeat, and why.
type Duplicate struct {
	ID  string `json:"id"`
	Why string `json:"why"`
}

// content is the sealed part of a report (zIdeaAnalysisContent).
type content struct {
	Title      string      `json:"title"`
	Summary    string      `json:"summary"`
	ProjectWhy string      `json:"projectWhy"`
	ImpactWhy  string      `json:"impactWhy"`
	EffortWhy  string      `json:"effortWhy"`
	Duplicates []Duplicate `json:"duplicates"`
	Questions  []string    `json:"questions"`
}

// Filling is what says when the copy holds every Projet: the Miroir's
// follower, filling the copies the Runner's first hello asks for.
type Filling interface {
	WaitFilled(ctx context.Context) error
}

// FillWait is how long a Session waits for the copy's first fill before
// failing, rather than analyse an Idée against Projets half copied.
var FillWait = 5 * time.Minute

// Kind is the session.StepKind of idea-analysis.
type Kind struct {
	store Store
	vault Opener
	fill  Filling
}

var _ session.StepKind = (*Kind)(nil)

// New is the kind reading the Projets from store, once fill says the copy
// holds them all (nil: at once), and opening the Idées with vault.
func New(store Store, vault Opener, fill Filling) *Kind {
	return &Kind{store: store, vault: vault, fill: fill}
}

// ErrNoIdea is the error of a step without its Idées.
var ErrNoIdea = errors.New("ideaanalysis: the step has no Idée")

// Prepare writes the context in dir, once the copy was filled: the file
// stays as it is for the whole Session. A copy still filling after FillWait,
// or a Session stopped meanwhile (ctx), fails it.
func (k *Kind) Prepare(ctx context.Context, dir string, step *contracts.RunnerSessionStartStep) error {
	if k.fill != nil {
		waiting, cancel := context.WithTimeout(ctx, FillWait)
		err := k.fill.WaitFilled(waiting)
		cancel()
		if err != nil {
			return fmt.Errorf("ideaanalysis: the Miroir's copy: %w", err)
		}
	}
	c, err := k.Context(step)
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(dir, filepath.FromSlash(ContextPath))
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}

// Context is what the Skill reads: the Idée (an error when its text does not
// open), every Projet of the copy with its open Tickets, and the other open
// Idées that open.
func (k *Kind) Context(step *contracts.RunnerSessionStartStep) (Context, error) {
	if step == nil || step.Ideas == nil {
		return Context{}, ErrNoIdea
	}
	idea := step.Ideas.Idea
	text, err := k.open(idea.Text.Key, idea.Text.Ciphertext, idea.Id+":text")
	if err != nil {
		return Context{}, fmt.Errorf("ideaanalysis: the Idée's text: %w", err)
	}
	projects, err := k.projects()
	if err != nil {
		return Context{}, err
	}
	c := Context{Idea: Idea{ID: idea.Id, Number: idea.Number, Text: text}, Projects: projects, OpenIdeas: []OpenIdea{}}
	for _, open := range step.Ideas.Open {
		if open.Id == idea.Id {
			continue
		}
		var sealed *[2]string
		if open.Analysis != nil {
			sealed = &[2]string{open.Analysis.Key, open.Analysis.Ciphertext}
		}
		if o, ok := k.openIdea(open.Id, open.Number, [2]string{open.Text.Key, open.Text.Ciphertext}, sealed); ok {
			c.OpenIdeas = append(c.OpenIdeas, o)
		}
	}
	return c, nil
}

// projects are the copy's Projets, one per ProjectID whatever its keys, in
// the copy's order, each with the open Tickets of its key of Tickets.
func (k *Kind) projects() ([]Project, error) {
	keys, err := k.store.Projects()
	if err != nil {
		return nil, err
	}
	out := []Project{}
	seen := map[string]bool{}
	for _, key := range keys {
		if seen[key.ProjectID] {
			continue
		}
		seen[key.ProjectID] = true
		p := Project{ID: key.ProjectID, Name: nameOf(keys, key.ProjectID), Tickets: []map[string]any{}}
		if tickets, ok := mirror.KeyOf(keys, key.ProjectID, mirror.GroupTicket); ok {
			listed, err := k.store.List(tickets.Repository, mirror.Filter{State: "open", Limit: ticketsMax})
			if err != nil {
				return nil, err
			}
			for _, ticket := range listed {
				p.Tickets = append(p.Tickets, map[string]any{"number": ticket["number"], "title": ticket["title"]})
			}
		}
		out = append(out, p)
	}
	return out, nil
}

// nameOf is the Projet's name: its key of Tickets's, else any of its keys',
// else its repository.
func nameOf(keys []mirror.Project, projectID string) string {
	if key, ok := mirror.KeyOf(keys, projectID, mirror.GroupTicket); ok && key.DisplayName != "" {
		return key.DisplayName
	}
	for _, key := range keys {
		if key.ProjectID == projectID && key.DisplayName != "" {
			return key.DisplayName
		}
	}
	for _, key := range keys {
		if key.ProjectID == projectID {
			return key.Repository
		}
	}
	return projectID
}

// openIdea is an open Idée as the context lists it: its analysis's title and
// summary when it opens, else its text's; false when neither opens.
func (k *Kind) openIdea(id string, number int, text [2]string, analysis *[2]string) (OpenIdea, bool) {
	o := OpenIdea{ID: id, Number: number}
	if analysis != nil {
		if plain, err := k.open(analysis[0], analysis[1], id+":analysis"); err == nil {
			var c content
			if json.Unmarshal([]byte(plain), &c) == nil && c.Title != "" {
				o.Title, o.Summary = c.Title, c.Summary
				return o, true
			}
		}
	}
	plain, err := k.open(text[0], text[1], id+":text")
	if err != nil {
		return OpenIdea{}, false
	}
	o.Title, o.Summary = splitText(plain)
	return o, true
}

// splitText is a text's first line, and the rest (the text itself when it
// is one line).
func splitText(text string) (title, summary string) {
	text = strings.TrimSpace(text)
	first, rest, _ := strings.Cut(text, "\n")
	title, summary = strings.TrimSpace(first), strings.TrimSpace(rest)
	if summary == "" {
		summary = text
	}
	return title, summary
}

// open opens the base64url item under aad.
func (k *Kind) open(key, ciphertext, aad string) (string, error) {
	if k.vault == nil {
		return "", errors.New("ideaanalysis: no vault")
	}
	rawKey, err := base64.RawURLEncoding.DecodeString(key)
	if err != nil {
		return "", err
	}
	rawCiphertext, err := base64.RawURLEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", err
	}
	plain, err := k.vault.OpenItem(keys.SealedItem{Key: rawKey, Ciphertext: rawCiphertext}, []byte(aad))
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

// Report reads the report in dir: the figures the server reads, the
// sentences sealed under "<ideaId>:analysis".
func (k *Kind) Report(dir string, step *contracts.RunnerSessionStartStep) (session.StepReport, error) {
	if step == nil || step.Ideas == nil {
		return session.StepReport{}, ErrNoIdea
	}
	data, ok, err := target.Target{Dir: dir}.ReadFile(ReportPath)
	if err != nil {
		return session.StepReport{}, err
	}
	if !ok {
		return session.StepReport{}, errors.New("ideaanalysis: no report")
	}
	var r Report
	if err := json.Unmarshal(data, &r); err != nil {
		return session.StepReport{}, fmt.Errorf("ideaanalysis: the report: %w", err)
	}
	duplicates := r.Duplicates
	if duplicates == nil {
		duplicates = []Duplicate{}
	}
	questions := r.Questions
	if questions == nil {
		questions = []string{}
	}
	ids := make([]string, 0, len(duplicates))
	for _, d := range duplicates {
		ids = append(ids, d.ID)
	}
	sealed, err := json.Marshal(content{
		Title: r.Title, Summary: r.Summary, ProjectWhy: r.ProjectWhy, ImpactWhy: r.ImpactWhy, EffortWhy: r.EffortWhy,
		Duplicates: duplicates, Questions: questions,
	})
	if err != nil {
		return session.StepReport{}, err
	}
	return session.StepReport{
		Figures: map[string]any{"impact": r.Impact, "effort": r.Effort, "projectId": r.ProjectID, "duplicateIds": ids},
		Content: sealed,
		AAD:     step.Ideas.Idea.Id + ":analysis",
	}, nil
}
