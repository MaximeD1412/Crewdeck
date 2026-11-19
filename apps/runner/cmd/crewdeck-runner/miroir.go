package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/itchyny/gojq"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mirror"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
	"github.com/spf13/cobra"
)

// miroirNow is the clock of the freshness lines; a test sets it.
var miroirNow = time.Now

// notStarted is the line of a command that needs the running Runner.
const notStarted = "Le Runner n'est pas démarré : crewdeck-runner start."

// newMiroirCommand is `crewdeck-runner miroir` (ADR 0010, « The agents'
// commands »; ADR 0012): the agents' reads of the copy, in gh's shapes, for
// every Source. They run in the agent's process and never write the copy
// nor hold a token: what does is asked of the running Runner on runner.sock.
func newMiroirCommand() *cobra.Command {
	command := &cobra.Command{
		Use:   "miroir",
		Short: "Read the Runner's copy of the Projets' Sources (the Miroir), in gh's shapes",
	}
	var repo string
	command.PersistentFlags().StringVarP(&repo, "repo", "R", "", "the Projet's key, <owner>/<name> or local/<projectId> (default: the current directory's origin)")
	issue := &cobra.Command{Use: "issue", Short: "The Projet's Tickets, as gh issue"}
	issue.AddCommand(newMiroirView(&repo, false), newMiroirList(&repo, false))
	pr := &cobra.Command{Use: "pr", Short: "The Projet's changes of code, as gh pr"}
	pr.AddCommand(newMiroirView(&repo, true), newMiroirList(&repo, true))
	command.AddCommand(issue, pr, newMiroirReady(&repo), newMiroirSearch(&repo), newMiroirSQL(),
		newMiroirStatus(), newMiroirSync(&repo), newMiroirRebuild(),
		newGhCommand("gh", "Run gh with the Session's token, then refresh in the copy what it changed"))
	return command
}

// miroir is one command's view of the copy: miroir.db opened read-only,
// its keys, the Runner's state folder and socket.
type miroir struct {
	home     state.Store
	socket   string
	path     string
	store    *mirror.Store
	projects []mirror.Project
	stderr   io.Writer

	runner *runnerState // asked once
}

// runnerState is mirror.state's answer, or none when no Runner runs.
type runnerState struct {
	running bool
	reply   mirror.StateReply
}

// keyFreshness is a key's state as the command sees it.
type keyFreshness struct {
	running  bool
	state    mirror.FreshnessState
	syncedAt string
}

func openMiroir(cmd *cobra.Command) (*miroir, error) { return openMiroirTo(cmd.ErrOrStderr()) }

func openMiroirTo(stderr io.Writer) (*miroir, error) {
	home, err := state.Default()
	if err != nil {
		return nil, err
	}
	path := filepath.Join(home.Dir, mirror.FileName)
	if _, err := os.Stat(path); err != nil {
		return nil, errors.New("Le Miroir n'existe pas encore : crewdeck-runner start le remplit.")
	}
	store, err := mirror.OpenReadOnly(path)
	if err != nil {
		return nil, fmt.Errorf("Le Miroir ne s'ouvre pas : %w", err)
	}
	projects, err := store.Projects()
	if err != nil {
		store.Close()
		return nil, fmt.Errorf("Le Miroir ne se lit pas : %w", err)
	}
	return &miroir{home: home, socket: filepath.Join(home.Dir, localsock.SocketName), path: path, store: store,
		projects: projects, stderr: stderr}, nil
}

func (m *miroir) Close() error { return m.store.Close() }

// call asks the running Runner op.
func (m *miroir) call(ctx context.Context, op string, request, reply any) error {
	ctx, cancel := context.WithTimeout(ctx, localsock.Timeout+5*time.Second)
	defer cancel()
	return localsock.Call(ctx, m.socket, op, request, reply)
}

func (m *miroir) state(ctx context.Context) *runnerState {
	if m.runner == nil {
		m.runner = &runnerState{}
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		if err := localsock.Call(ctx, m.socket, mirror.OpState, nil, &m.runner.reply); err == nil {
			m.runner.running = true
		}
	}
	return m.runner
}

// freshness is the key's: the Runner's when it runs and follows it, else the
// copy's marks (filled: late, else filling).
func (m *miroir) freshness(ctx context.Context, key string) keyFreshness {
	r := m.state(ctx)
	if r.running {
		for k, s := range r.reply.Keys {
			if strings.EqualFold(k, key) {
				f := keyFreshness{running: true, state: s.State}
				if s.SyncedAt != nil {
					f.syncedAt = *s.SyncedAt
				}
				return f
			}
		}
	}
	f := keyFreshness{running: r.running, state: mirror.FreshnessFilling}
	filled, synced, err := m.store.Marks(key)
	if err == nil && filled {
		f.state = mirror.FreshnessLate
	}
	f.syncedAt = synced
	return f
}

// warn says on stderr that the key's answer is not live: « en retard »
// with the last synchronization, « en remplissage » when there was none.
func (m *miroir) warn(p mirror.Project, f keyFreshness) {
	if f.state == mirror.FreshnessFilling || f.syncedAt == "" {
		fmt.Fprintf(m.stderr, "Miroir en remplissage pour %s\n", p.DisplayName)
		return
	}
	fmt.Fprintf(m.stderr, "Miroir en retard pour %s : dernière synchro il y a %s\n", p.DisplayName, since(f.syncedAt))
}

// since is the time from an RFC 3339 instant to now, in French, rounded down.
func since(at string) string {
	t, err := time.Parse(time.RFC3339Nano, at)
	if err != nil {
		return "un temps inconnu"
	}
	return duration(miroirNow().Sub(t))
}

func duration(d time.Duration) string {
	switch {
	case d < time.Minute:
		return "moins d'une minute"
	case d < time.Hour:
		return fmt.Sprintf("%d min", int(d/time.Minute))
	case d < 24*time.Hour:
		return fmt.Sprintf("%d h", int(d/time.Hour))
	}
	return fmt.Sprintf("%d j", int(d/(24*time.Hour)))
}

// The Projet

var githubRemote = regexp.MustCompile(`^(?:https?://(?:[^@/]+@)?github\.com/|git@github\.com:|ssh://git@github\.com/)([^/]+)/([^/]+?)(?:\.git)?/?$`)

// projectID is the Projet that --repo names, else the current directory's
// origin: a GitHub URL names its repository, a path the Local Projet whose
// folder or clone it is.
func (m *miroir) projectID(ctx context.Context, repo string) (string, error) {
	if repo != "" {
		for _, p := range m.projects {
			if strings.EqualFold(p.Repository, repo) {
				return p.ProjectID, nil
			}
		}
		return "", fmt.Errorf("%s n'est pas un Projet de ce Runner.", repo)
	}
	out, err := exec.CommandContext(ctx, "git", "remote", "get-url", "origin").Output()
	if err != nil {
		return "", errors.New("Ce dossier n'est pas un Projet de ce Runner : précise --repo <dépôt>.")
	}
	remote := strings.TrimSpace(string(out))
	if match := githubRemote.FindStringSubmatch(remote); match != nil {
		key := match[1] + "/" + match[2]
		for _, p := range m.projects {
			if p.Source == mirror.SourceGitHub && strings.EqualFold(p.Repository, key) {
				return p.ProjectID, nil
			}
		}
		return "", fmt.Errorf("%s n'est pas un Projet de ce Runner.", key)
	}
	if id, ok := m.localOf(remote); ok {
		return id, nil
	}
	return "", fmt.Errorf("%s n'est pas un Projet de ce Runner.", remote)
}

// localOf is the Local Projet a path names: its folder (runner.json), or its
// clone (<state>/repos/local/<projectId>).
func (m *miroir) localOf(remote string) (string, bool) {
	folders := map[string]string{}
	if s, err := m.home.Load(); err == nil {
		for id, path := range s.Projects {
			folders[id] = path
		}
	}
	for _, p := range m.projects {
		if p.Source == mirror.SourceLocal && p.Folder != "" {
			if _, ok := folders[p.ProjectID]; !ok {
				folders[p.ProjectID] = p.Folder
			}
		}
	}
	id, ok := local.ProjectOfRemote(folders, remote)
	if !ok {
		clones := map[string]string{}
		for _, p := range m.projects {
			clones[p.ProjectID] = (&local.Origin{Home: m.home.Dir, ProjectID: p.ProjectID}).Dir()
		}
		id, ok = local.ProjectOfRemote(clones, remote)
	}
	if !ok {
		return "", false
	}
	for _, p := range m.projects {
		if p.ProjectID == id {
			return id, true
		}
	}
	return "", false
}

// key is the key holding the group of the Projet --repo or the directory names.
func (m *miroir) key(ctx context.Context, repo, group string) (mirror.Project, error) {
	id, err := m.projectID(ctx, repo)
	if err != nil {
		return mirror.Project{}, err
	}
	p, ok := mirror.KeyOf(m.projects, id, group)
	if !ok {
		what := "ses Tickets"
		if group == mirror.GroupCode {
			what = "son code"
		}
		return mirror.Project{}, fmt.Errorf("Ce Projet n'a pas %s dans le Miroir (sa Source n'est pas encore reliée).", what)
	}
	return p, nil
}

// Read-through (ADR 0010, « Freshness »)

// beforeView makes the object's answer fresh: a Local key or a key not live
// fetches it first; the line on stderr only when that read failed, or when
// no Runner runs.
func (m *miroir) beforeView(ctx context.Context, p mirror.Project, number int) {
	f := m.freshness(ctx, p.Repository)
	if !f.running {
		m.warn(p, f)
		return
	}
	if f.state == mirror.FreshnessLive && p.Source != mirror.SourceLocal {
		return
	}
	if err := m.call(ctx, mirror.OpFetch, mirror.FetchRequest{Repository: p.Repository, Number: number}, nil); err != nil {
		m.warn(p, f)
	}
}

// listing is how a list's answer comes: from the copy, or GitHub's passed through.
type listing int

const (
	fromCopy listing = iota
	fromGitHub
)

// beforeList makes the key's list fresh: a Local key synchronizes, a late
// key walks its open objects; a GitHub key filling lists from GitHub, or,
// for `ready`, exits 3; without a Runner a filling key exits 3.
func (m *miroir) beforeList(ctx context.Context, p mirror.Project, ready bool) (listing, error) {
	f := m.freshness(ctx, p.Repository)
	if !f.running {
		if f.state == mirror.FreshnessFilling {
			fmt.Fprintf(m.stderr, "Miroir en remplissage pour %s\n%s\n", p.DisplayName, notStarted)
			return fromCopy, silentExit(3)
		}
		m.warn(p, f)
		return fromCopy, nil
	}
	switch {
	case p.Source == mirror.SourceLocal:
		if err := m.call(ctx, mirror.OpSync, mirror.SyncRequest{Repository: p.Repository}, nil); err != nil {
			if f.state == mirror.FreshnessFilling {
				fmt.Fprintf(m.stderr, "Miroir en remplissage pour %s\n", p.DisplayName)
				return fromCopy, silentExit(3)
			}
			m.warn(p, f)
		}
	case f.state == mirror.FreshnessLive:
	case f.state == mirror.FreshnessLate:
		if err := m.call(ctx, mirror.OpSync, mirror.SyncRequest{Repository: p.Repository, OpenOnly: true}, nil); err != nil {
			m.warn(p, f)
		}
	default: // a GitHub key filling
		if ready {
			fmt.Fprintf(m.stderr, "Miroir en remplissage pour %s\n", p.DisplayName)
			return fromCopy, silentExit(3)
		}
		return fromGitHub, nil
	}
	return fromCopy, nil
}

// Output, as gh's

// jsonFlags are --json and --jq.
type jsonFlags struct {
	fields string
	jq     string
	set    bool
}

func (j *jsonFlags) add(cmd *cobra.Command, available []string) {
	cmd.Flags().StringVar(&j.fields, "json", "", "output JSON with the specified fields")
	cmd.Flags().StringVarP(&j.jq, "jq", "q", "", "filter JSON output using a jq expression")
	cmd.SetFlagErrorFunc(func(c *cobra.Command, err error) error {
		if strings.Contains(err.Error(), "flag needs an argument: --json") {
			printFields(c.ErrOrStderr(), available)
			return silentExit(1)
		}
		return &exitError{code: 2, err: err}
	})
}

func printFields(w io.Writer, available []string) {
	fmt.Fprintln(w, "Précise un ou plusieurs champs séparés par des virgules pour --json :")
	for _, f := range available {
		fmt.Fprintf(w, "  %s\n", f)
	}
}

// parse checks the fields against those available.
func (j *jsonFlags) parse(cmd *cobra.Command, available []string) ([]string, error) {
	j.set = cmd.Flags().Changed("json")
	if !j.set {
		if j.jq != "" {
			return nil, errors.New("--jq demande --json et ses champs.")
		}
		return nil, nil
	}
	known := map[string]bool{}
	for _, f := range available {
		known[f] = true
	}
	var fields []string
	for _, f := range strings.Split(j.fields, ",") {
		f = strings.TrimSpace(f)
		if f == "" {
			continue
		}
		if !known[f] {
			fmt.Fprintf(cmd.ErrOrStderr(), "Champ inconnu pour --json : %q\n", f)
			printFields(cmd.ErrOrStderr(), available)
			return nil, silentExit(1)
		}
		fields = append(fields, f)
	}
	if len(fields) == 0 {
		printFields(cmd.ErrOrStderr(), available)
		return nil, silentExit(1)
	}
	return fields, nil
}

func pick(object map[string]any, fields []string) map[string]any {
	out := make(map[string]any, len(fields))
	for _, f := range fields {
		out[f] = object[f]
	}
	return out
}

// write prints value as gh does without a terminal: one line of JSON, or
// each result of --jq, a string raw.
func (j *jsonFlags) write(w io.Writer, value any) error {
	data, err := marshalJSON(value)
	if err != nil {
		return err
	}
	if j.jq == "" {
		_, err := w.Write(data)
		return err
	}
	query, err := gojq.Parse(j.jq)
	if err != nil {
		return fmt.Errorf("Expression --jq invalide : %v", err)
	}
	var input any
	if err := json.Unmarshal(data, &input); err != nil {
		return err
	}
	iter := query.Run(input)
	for {
		v, ok := iter.Next()
		if !ok {
			return nil
		}
		if err, ok := v.(error); ok {
			var halt *gojq.HaltError
			if errors.As(err, &halt) && halt.Value() == nil {
				return nil
			}
			return fmt.Errorf("--jq : %v", err)
		}
		if s, ok := v.(string); ok {
			fmt.Fprintln(w, s)
			continue
		}
		line, err := marshalJSON(v)
		if err != nil {
			return err
		}
		if _, err := w.Write(line); err != nil {
			return err
		}
	}
}

// marshalJSON is one line of JSON, HTML not escaped (as gh).
func marshalJSON(v any) ([]byte, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(v); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// The commands

func newMiroirView(repo *string, pulls bool) *cobra.Command {
	var flags jsonFlags
	available, group, what := mirror.IssueFields, mirror.GroupTicket, "issue"
	if pulls {
		available, group, what = mirror.PullFields, mirror.GroupCode, "pull request"
	}
	cmd := &cobra.Command{
		Use:   "view <number>",
		Short: "Print one " + what + " of the copy, as gh " + strings.Fields(what)[0] + " view",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			number, err := strconv.Atoi(strings.TrimPrefix(args[0], "#"))
			if err != nil || number <= 0 {
				return &exitError{code: 2, err: fmt.Errorf("%q n'est pas un numéro.", args[0])}
			}
			fields, err := flags.parse(cmd, available)
			if err != nil {
				return err
			}
			m, err := openMiroir(cmd)
			if err != nil {
				return err
			}
			defer m.Close()
			p, err := m.key(cmd.Context(), *repo, group)
			if err != nil {
				return err
			}
			m.beforeView(cmd.Context(), p, number)
			object, err := m.store.View(p.Repository, number, pulls)
			if errors.Is(err, mirror.ErrNotFound) {
				return fmt.Errorf("#%d n'existe pas dans %s.", number, p.DisplayName)
			}
			if err != nil {
				return err
			}
			if !flags.set {
				printView(cmd.OutOrStdout(), object)
				return nil
			}
			return flags.write(cmd.OutOrStdout(), pick(object, fields))
		},
	}
	flags.add(cmd, available)
	return cmd
}

// printView is gh's view without a terminal.
func printView(w io.Writer, object map[string]any) {
	var o map[string]any
	data, _ := json.Marshal(object)
	_ = json.Unmarshal(data, &o)
	author := ""
	if a, ok := o["author"].(map[string]any); ok {
		author, _ = a["login"].(string)
	}
	milestone := ""
	if ms, ok := o["milestone"].(map[string]any); ok {
		milestone, _ = ms["title"].(string)
	}
	comments := 0
	if c, ok := o["comments"].([]any); ok {
		comments = len(c)
	}
	fmt.Fprintf(w, "title:\t%v\n", o["title"])
	fmt.Fprintf(w, "state:\t%v\n", o["state"])
	fmt.Fprintf(w, "author:\t%s\n", author)
	fmt.Fprintf(w, "labels:\t%s\n", strings.Join(names(o["labels"], "name"), ", "))
	fmt.Fprintf(w, "comments:\t%d\n", comments)
	fmt.Fprintf(w, "assignees:\t%s\n", strings.Join(names(o["assignees"], "login"), ", "))
	fmt.Fprintf(w, "milestone:\t%s\n", milestone)
	fmt.Fprintf(w, "number:\t%v\n", o["number"])
	fmt.Fprintln(w, "--")
	fmt.Fprintln(w, o["body"])
}

// names are the key of each object of a list of the copy's shapes.
func names(list any, key string) []string {
	var items []map[string]any
	data, _ := json.Marshal(list)
	_ = json.Unmarshal(data, &items)
	out := []string{}
	for _, item := range items {
		if s, ok := item[key].(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func newMiroirList(repo *string, pulls bool) *cobra.Command {
	var flags jsonFlags
	var filter mirror.Filter
	var search string
	available, group, what := mirror.IssueFields, mirror.GroupTicket, "issues"
	if pulls {
		available, group, what = mirror.PullFields, mirror.GroupCode, "pull requests"
	}
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List the " + what + " of the copy, as gh " + map[bool]string{false: "issue", true: "pr"}[pulls] + " list",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if cmd.Flags().Changed("search") {
				return errors.New("--search n'est pas pris en charge : utilise crewdeck-runner miroir search.")
			}
			state := strings.ToLower(filter.State)
			if state != "open" && state != "closed" && state != "merged" && state != "all" {
				return &exitError{code: 2, err: fmt.Errorf("--state vaut open, closed, merged ou all, pas %q.", filter.State)}
			}
			fields, err := flags.parse(cmd, available)
			if err != nil {
				return err
			}
			m, err := openMiroir(cmd)
			if err != nil {
				return err
			}
			defer m.Close()
			p, err := m.key(cmd.Context(), *repo, group)
			if err != nil {
				return err
			}
			filter.Pulls = pulls
			from, err := m.beforeList(cmd.Context(), p, false)
			if err != nil {
				return err
			}
			var items []map[string]any
			if from == fromGitHub {
				kind := "issue"
				if pulls {
					kind = "pull"
				}
				var reply mirror.ListReply
				request := mirror.ListRequest{Repository: p.Repository, Kind: kind, State: filter.State, Labels: filter.Labels,
					Author: filter.Author, Head: filter.Head, Limit: filter.Limit}
				if err := m.call(cmd.Context(), mirror.OpList, request, &reply); err != nil {
					fmt.Fprintf(m.stderr, "Miroir en remplissage pour %s\n", p.DisplayName)
					return silentExit(3)
				}
				items = reply.Items
			} else if items, err = m.store.List(p.Repository, filter); err != nil {
				return err
			}
			if items == nil {
				items = []map[string]any{}
			}
			if !flags.set {
				printList(cmd.OutOrStdout(), items, pulls)
				return nil
			}
			picked := make([]map[string]any, len(items))
			for i, item := range items {
				picked[i] = pick(item, fields)
			}
			return flags.write(cmd.OutOrStdout(), picked)
		},
	}
	cmd.Flags().StringVarP(&filter.State, "state", "s", "open", "filter by state: {open|closed|merged|all}")
	cmd.Flags().StringSliceVarP(&filter.Labels, "label", "l", nil, "filter by label (all of them)")
	cmd.Flags().StringVarP(&filter.Author, "author", "A", "", "filter by author")
	if pulls {
		cmd.Flags().StringVarP(&filter.Head, "head", "H", "", "filter by head branch")
	}
	cmd.Flags().IntVarP(&filter.Limit, "limit", "L", 30, "maximum number of items to fetch")
	cmd.Flags().StringVarP(&search, "search", "S", "", "not supported: crewdeck-runner miroir search")
	flags.add(cmd, available)
	return cmd
}

// printList is gh's list without a terminal: tab-separated columns.
func printList(w io.Writer, items []map[string]any, pulls bool) {
	for _, o := range items {
		if pulls {
			fmt.Fprintf(w, "%v\t%v\t%v\t%v\t%v\n", o["number"], o["title"], o["headRefName"], o["state"], o["createdAt"])
			continue
		}
		fmt.Fprintf(w, "%v\t%v\t%v\t%s\t%v\n", o["number"], o["state"], o["title"], strings.Join(names(o["labels"], "name"), ", "), o["updatedAt"])
	}
}

func newMiroirReady(repo *string) *cobra.Command {
	var all bool
	var numbers []int
	cmd := &cobra.Command{
		Use:   "ready",
		Short: "Print the open ready-for-agent issues an agent may take, one JSON object per line",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			m, err := openMiroir(cmd)
			if err != nil {
				return err
			}
			defer m.Close()
			tickets, err := m.key(cmd.Context(), *repo, mirror.GroupTicket)
			if err != nil {
				return err
			}
			codeKey := ""
			keys := []mirror.Project{tickets}
			if code, ok := mirror.KeyOf(m.projects, tickets.ProjectID, mirror.GroupCode); ok {
				codeKey = code.Repository
				if code.Repository != tickets.Repository {
					keys = append(keys, code)
				}
			}
			for _, p := range keys {
				if _, err := m.beforeList(cmd.Context(), p, true); err != nil {
					return err
				}
			}
			issues, err := m.store.Ready(tickets.Repository, codeKey, mirror.ReadyOptions{All: all, Numbers: numbers})
			if err != nil {
				return err
			}
			for _, issue := range issues {
				line, err := marshalJSON(issue)
				if err != nil {
					return err
				}
				if _, err := cmd.OutOrStdout().Write(line); err != nil {
					return err
				}
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&all, "all", false, "also the unavailable ones, after the available ones")
	cmd.Flags().IntSliceVar(&numbers, "numbers", nil, "only these issues (N,N…)")
	return cmd
}

// freshnessOf is the answer's freshness of keys: `{ key: { state, syncedAt } }`.
func (m *miroir) freshnessOf(ctx context.Context, keys []string) map[string]mirror.KeyState {
	out := map[string]mirror.KeyState{}
	for _, k := range keys {
		f := m.freshness(ctx, k)
		s := mirror.KeyState{State: f.state}
		if f.syncedAt != "" {
			at := f.syncedAt
			s.SyncedAt = &at
		}
		out[k] = s
	}
	return out
}

func (m *miroir) allKeys() []string {
	keys := make([]string, 0, len(m.projects))
	for _, p := range m.projects {
		keys = append(keys, p.Repository)
	}
	return keys
}

func newMiroirSearch(repo *string) *cobra.Command {
	var kind string
	var limit int
	cmd := &cobra.Command{
		Use:   "search <text>",
		Short: "Search the copy's issues, PRs, comments, reviews and documents (every word required)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if kind != "" && !contains(mirror.SearchKinds, kind) {
				return &exitError{code: 2, err: fmt.Errorf("--kind vaut %s, pas %q.", strings.Join(mirror.SearchKinds, ", "), kind)}
			}
			m, err := openMiroir(cmd)
			if err != nil {
				return err
			}
			defer m.Close()
			// The Projet's keys when --repo or the directory names one, else every key.
			keys := m.allKeys()
			id, err := m.projectID(cmd.Context(), *repo)
			if err != nil && *repo != "" {
				return err
			}
			if err == nil {
				keys = nil
				for _, p := range m.projects {
					if p.ProjectID == id {
						keys = append(keys, p.Repository)
					}
				}
			}
			if kind == "" || kind == "doc" {
				m.syncLocalDocs(cmd.Context(), keys)
			}
			rows, err := m.store.Search(args[0], kind, keys, limit)
			if errors.Is(err, mirror.ErrBadQuery) {
				return errors.New("La recherche demande au moins un mot.")
			}
			if err != nil {
				return err
			}
			return writeJSON(cmd.OutOrStdout(), map[string]any{"freshness": m.freshnessOf(cmd.Context(), keys), "rows": rows})
		},
	}
	cmd.Flags().StringVar(&kind, "kind", "", "only rows of this kind: issue, comment or doc")
	cmd.Flags().IntVarP(&limit, "limit", "L", 20, "maximum number of rows")
	return cmd
}

// syncLocalDocs synchronizes each Local key of keys holding a Projet's code
// while the Runner runs, its documents with it (MIROIR-5): a search finds
// what was committed on its integration branch just before. A failed one
// warns, the copy answers.
func (m *miroir) syncLocalDocs(ctx context.Context, keys []string) {
	for _, p := range m.projects {
		if p.Source != mirror.SourceLocal || !p.Has(mirror.GroupCode) || !contains(keys, p.Repository) {
			continue
		}
		f := m.freshness(ctx, p.Repository)
		if !f.running {
			continue
		}
		if err := m.call(ctx, mirror.OpSync, mirror.SyncRequest{Repository: p.Repository}, nil); err != nil {
			m.warn(p, f)
		}
	}
}

func contains(list []string, s string) bool {
	for _, item := range list {
		if item == s {
			return true
		}
	}
	return false
}

func writeJSON(w io.Writer, v any) error {
	data, err := marshalJSON(v)
	if err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

func newMiroirSQL() *cobra.Command {
	return &cobra.Command{
		Use:   "sql <select>",
		Short: "Run one SELECT or WITH statement on the copy, read-only",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			m, err := openMiroir(cmd)
			if err != nil {
				return err
			}
			defer m.Close()
			rows, err := m.store.Query(args[0])
			if errors.Is(err, mirror.ErrBadQuery) {
				return fmt.Errorf("Le Miroir ne répond qu'à une instruction SELECT ou WITH : %v", errors.Unwrap(err))
			}
			if err != nil {
				return err
			}
			return writeJSON(cmd.OutOrStdout(), map[string]any{"freshness": m.freshnessOf(cmd.Context(), m.allKeys()), "rows": rows})
		},
	}
}

// MiroirKeyStatus is one key in `miroir status --json`.
type MiroirKeyStatus struct {
	Repository string                `json:"repository"`
	Name       string                `json:"name"`
	Source     string                `json:"source"`
	Groups     []string              `json:"groups"`
	State      mirror.FreshnessState `json:"state"`
	SyncedAt   *string               `json:"syncedAt"`
	Issues     int                   `json:"issues"`
	Pulls      int                   `json:"pulls"`
}

// MiroirStatus is `miroir status --json`.
type MiroirStatus struct {
	Keys []MiroirKeyStatus `json:"keys"`
	// Runner: whether the Runner answers on the socket, Connected whether it is connected to the server.
	Socket struct {
		Path      string `json:"path"`
		Runner    bool   `json:"runner"`
		Connected bool   `json:"connected"`
	} `json:"socket"`
	File struct {
		Path string `json:"path"`
		Size int64  `json:"size"`
	} `json:"file"`
}

func newMiroirStatus() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "status",
		Short: "Print each key of the copy: its Projet, Source, state, last synchronization and counts",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			m, err := openMiroir(cmd)
			if err != nil {
				return err
			}
			defer m.Close()
			var s MiroirStatus
			s.Keys = []MiroirKeyStatus{}
			for _, p := range m.projects {
				f := m.freshness(cmd.Context(), p.Repository)
				issues, pulls, err := m.store.Count(p.Repository)
				if err != nil {
					return err
				}
				k := MiroirKeyStatus{Repository: p.Repository, Name: p.DisplayName, Source: p.Source, Groups: p.Groups,
					State: f.state, Issues: issues, Pulls: pulls}
				if f.syncedAt != "" {
					at := f.syncedAt
					k.SyncedAt = &at
				}
				s.Keys = append(s.Keys, k)
			}
			r := m.state(cmd.Context())
			s.Socket.Path, s.Socket.Runner, s.Socket.Connected = m.socket, r.running, r.reply.Connected
			s.File.Path = m.path
			if info, err := os.Stat(m.path); err == nil {
				s.File.Size = info.Size()
			}
			if asJSON {
				return writeJSON(cmd.OutOrStdout(), s)
			}
			printMiroirStatus(cmd.OutOrStdout(), s)
			return nil
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "print the status as JSON")
	return cmd
}

var (
	freshnessNames = map[mirror.FreshnessState]string{
		mirror.FreshnessLive: "à jour", mirror.FreshnessLate: "en retard", mirror.FreshnessFilling: "en remplissage",
	}
	sourceNames = map[string]string{mirror.SourceGitHub: "GitHub", mirror.SourceLocal: "Local"}
)

func printMiroirStatus(w io.Writer, s MiroirStatus) {
	if len(s.Keys) == 0 {
		fmt.Fprintln(w, "Aucun Projet dans le Miroir.")
	}
	for _, k := range s.Keys {
		synced := "jamais synchronisé"
		if k.SyncedAt != nil {
			synced = "synchro il y a " + since(*k.SyncedAt)
		}
		fmt.Fprintf(w, "%s (%s) · %s · %s · %s · %d tickets, %d PR\n", k.Name, k.Repository, sourceNames[k.Source],
			freshnessNames[k.State], synced, k.Issues, k.Pulls)
	}
	switch {
	case !s.Socket.Runner:
		fmt.Fprintf(w, "Runner : non démarré (%s)\n", s.Socket.Path)
	case s.Socket.Connected:
		fmt.Fprintf(w, "Runner : démarré, connecté au serveur (%s)\n", s.Socket.Path)
	default:
		fmt.Fprintf(w, "Runner : démarré, déconnecté du serveur (%s)\n", s.Socket.Path)
	}
	fmt.Fprintf(w, "Fichier : %s (%s)\n", s.File.Path, size(s.File.Size))
}

func size(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f Mo", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f Ko", float64(n)/(1<<10))
	}
	return fmt.Sprintf("%d o", n)
}

// runnerFailure says in French why the Runner did not do op.
func runnerFailure(err error, what string) error {
	if errors.Is(err, localsock.ErrNoRunner) {
		return errors.New(notStarted)
	}
	var failed *localsock.Failed
	if errors.As(err, &failed) {
		return fmt.Errorf("%s : le Runner répond %s.", what, failed.Code)
	}
	return fmt.Errorf("%s : %v", what, err)
}

func newMiroirSync(repo *string) *cobra.Command {
	return &cobra.Command{
		Use:   "sync",
		Short: "Ask the running Runner to reconcile the copy (every key without --repo)",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			m, err := openMiroir(cmd)
			if err != nil {
				return err
			}
			defer m.Close()
			var keys []string
			if *repo != "" {
				id, err := m.projectID(cmd.Context(), *repo)
				if err != nil {
					return err
				}
				for _, p := range m.projects {
					if p.ProjectID == id {
						keys = append(keys, p.Repository)
					}
				}
			} else {
				keys = []string{""}
			}
			var synced []string
			for _, k := range keys {
				var reply mirror.SyncReply
				if err := m.call(cmd.Context(), mirror.OpSync, mirror.SyncRequest{Repository: k}, &reply); err != nil {
					return runnerFailure(err, "La synchro du Miroir a échoué")
				}
				synced = append(synced, reply.Synced...)
			}
			for _, name := range m.projectNames(synced) {
				fmt.Fprintf(cmd.OutOrStdout(), "Miroir synchronisé : %s\n", name)
			}
			return nil
		},
	}
}

// projectNames are the names of the Projets of keys, each once, in order.
func (m *miroir) projectNames(keys []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, k := range keys {
		for _, p := range m.projects {
			if strings.EqualFold(p.Repository, k) && !seen[p.ProjectID] {
				seen[p.ProjectID] = true
				out = append(out, p.DisplayName)
			}
		}
	}
	sort.Strings(out)
	return out
}

func newMiroirRebuild() *cobra.Command {
	return &cobra.Command{
		Use:   "rebuild",
		Short: "Ask the running Runner to empty the copy and fill it again (local.db is never touched)",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			home, err := state.Default()
			if err != nil {
				return err
			}
			ctx, cancel := context.WithTimeout(cmd.Context(), localsock.Timeout+5*time.Second)
			defer cancel()
			if err := localsock.Call(ctx, filepath.Join(home.Dir, localsock.SocketName), mirror.OpRebuild, nil, nil); err != nil {
				return runnerFailure(err, "La reconstruction du Miroir a échoué")
			}
			fmt.Fprintln(cmd.OutOrStdout(), "Miroir reconstruit : remplissage en cours")
			return nil
		},
	}
}

// MirrorStatus is the Miroir in `crewdeck-runner status --json`: live when
// every key is, filling when one still fills, else late since the oldest
// last synchronization.
type MirrorStatus struct {
	State mirror.FreshnessState `json:"state"`
	Since *string               `json:"since,omitempty"`
}

// mirrorStatus is nil without a copy or a key in it.
func mirrorStatus(ctx context.Context) *MirrorStatus {
	m, err := openMiroirTo(io.Discard)
	if err != nil {
		return nil
	}
	defer m.Close()
	if len(m.projects) == 0 {
		return nil
	}
	status := &MirrorStatus{State: mirror.FreshnessLive}
	oldest := ""
	for _, p := range m.projects {
		f := m.freshness(ctx, p.Repository)
		switch f.state {
		case mirror.FreshnessFilling:
			return &MirrorStatus{State: mirror.FreshnessFilling}
		case mirror.FreshnessLate:
			status.State = mirror.FreshnessLate
			if f.syncedAt != "" && (oldest == "" || f.syncedAt < oldest) {
				oldest = f.syncedAt
			}
		}
	}
	if status.State == mirror.FreshnessLate && oldest != "" {
		status.Since = &oldest
	}
	return status
}

// mirrorLine is the status's line of the Miroir.
func mirrorLine(s *MirrorStatus) string {
	switch {
	case s.State == mirror.FreshnessLive:
		return "Miroir : à jour"
	case s.State == mirror.FreshnessFilling:
		return "Miroir : en remplissage"
	case s.Since != nil:
		return "Miroir : en retard depuis " + since(*s.Since)
	}
	return "Miroir : en retard"
}
