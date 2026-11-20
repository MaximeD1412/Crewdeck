package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"

	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mirror"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	ghsource "github.com/maximed1412/crewdeck/apps/runner/internal/source/github"
	"github.com/spf13/cobra"
)

// The agents' writes (MIROIR-7, ADR 0012, « The agents' one channel, for
// every Source »): `miroir issue create|edit|comment|close|reopen` and `miroir
// pr create|edit|comment|review|close|reopen`, with gh's flags, from a
// Session only. A GitHub key is written here with the Session's token, then
// the object fetched in the copy; a Local key's write goes to the running
// Runner (source.write), which alone writes the folder and local.db and
// refreshes the copy before it answers. Either way the agent that wrote
// reads its write.

// miroirGitHubAPI is GitHub's REST API, a fake's in the tests.
var miroirGitHubAPI = github.API

// createFields are what `create --json` prints.
var createFields = []string{"number", "url"}

// addIssueWrites adds the issue's writes to `miroir issue`.
func addIssueWrites(issue *cobra.Command, repo *string) {
	issue.AddCommand(newIssueCreate(repo), newIssueEdit(repo), newWriteComment(repo, false),
		newIssueState(repo, true), newIssueState(repo, false))
	refuseOthers(issue)
}

// addPullWrites adds the pull request's writes to `miroir pr`.
func addPullWrites(pr *cobra.Command, repo *string) {
	pr.AddCommand(newPullCreate(repo), newPullEdit(repo), newWriteComment(repo, true), newPullReview(repo),
		newPullState(repo, true), newPullState(repo, false), &cobra.Command{
			Use:                "merge",
			Short:              "Not provided: merging is a gate of the Process",
			DisableFlagParsing: true,
			RunE: func(cmd *cobra.Command, _ []string) error {
				fmt.Fprintln(cmd.ErrOrStderr(), "Le merge passe par Crewdeck.")
				return silentExit(1)
			},
		})
	refuseOthers(pr)
}

// refuseOthers makes a gh subcommand the Miroir does not provide exit 1.
func refuseOthers(group *cobra.Command) {
	group.Args = cobra.ArbitraryArgs
	group.FParseErrWhitelist.UnknownFlags = true
	group.RunE = func(cmd *cobra.Command, args []string) error {
		if len(args) == 0 {
			return cmd.Help()
		}
		fmt.Fprintf(cmd.ErrOrStderr(), "miroir %s %s n'existe pas : le Miroir a %s.\n", group.Name(), args[0], strings.Join(subcommands(group), ", "))
		return silentExit(1)
	}
}

func subcommands(group *cobra.Command) []string {
	var names []string
	for _, c := range group.Commands() {
		if c.Name() != "merge" && !c.Hidden {
			names = append(names, c.Name())
		}
	}
	return names
}

// body is the -b/--body and -F/--body-file pair of a command.
type body struct {
	text, file string
}

func (b *body) add(cmd *cobra.Command, short bool) {
	if short {
		cmd.Flags().StringVarP(&b.text, "body", "b", "", "the body")
		cmd.Flags().StringVarP(&b.file, "body-file", "F", "", "read the body from the file (\"-\" for stdin)")
	} else {
		cmd.Flags().StringVar(&b.text, "body", "", "the body")
		cmd.Flags().StringVar(&b.file, "body-file", "", "read the body from the file (\"-\" for stdin)")
	}
	cmd.MarkFlagsMutuallyExclusive("body", "body-file")
}

// value is the body given, nil when neither flag is.
func (b *body) value(cmd *cobra.Command) (*string, error) {
	if cmd.Flags().Changed("body-file") {
		var in io.Reader = cmd.InOrStdin()
		if b.file != "-" {
			f, err := os.Open(b.file)
			if err != nil {
				return nil, &exitError{code: 1, err: fmt.Errorf("%s ne s'ouvre pas.", b.file)}
			}
			defer f.Close()
			in = f
		}
		data, err := io.ReadAll(io.LimitReader(in, 1<<20))
		if err != nil {
			return nil, &exitError{code: 1, err: errors.New("Le corps ne se lit pas.")}
		}
		text := string(data)
		return &text, nil
	}
	if cmd.Flags().Changed("body") {
		return &b.text, nil
	}
	return nil, nil
}

// labelled are the labels, assignees and milestone of an edit.
type labelled struct {
	addLabels, removeLabels, addAssignees, removeAssignees []string
	milestone                                              string
	removeMilestone                                        bool
}

func (l *labelled) add(cmd *cobra.Command) {
	f := cmd.Flags()
	f.StringSliceVar(&l.addLabels, "add-label", nil, "add labels")
	f.StringSliceVar(&l.removeLabels, "remove-label", nil, "remove labels")
	f.StringSliceVar(&l.addAssignees, "add-assignee", nil, "add assignees by their login")
	f.StringSliceVar(&l.removeAssignees, "remove-assignee", nil, "remove assignees by their login")
	f.StringVarP(&l.milestone, "milestone", "m", "", "the milestone, by its title")
	f.BoolVar(&l.removeMilestone, "remove-milestone", false, "remove the milestone")
	cmd.MarkFlagsMutuallyExclusive("milestone", "remove-milestone")
}

func (l *labelled) fields(cmd *cobra.Command, f *source.WriteFields) {
	f.AddLabels, f.RemoveLabels, f.AddAssignees, f.RemoveAssignees = l.addLabels, l.removeLabels, l.addAssignees, l.removeAssignees
	if cmd.Flags().Changed("milestone") {
		f.Milestone = &l.milestone
	}
	if l.removeMilestone {
		none := ""
		f.Milestone = &none
	}
}

// changed is the flag's value when the command line gives it.
func changed(cmd *cobra.Command, name string, value *string) *string {
	if cmd.Flags().Changed(name) {
		return value
	}
	return nil
}

func newIssueCreate(repo *string) *cobra.Command {
	var b body
	var title, milestone, jsonFields string
	var labels, assignees []string
	var blockedBy []int
	var parent int
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a Ticket, as gh issue create",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if strings.TrimSpace(title) == "" {
				return &exitError{code: 2, err: errors.New("Donne le titre : --title.")}
			}
			text, err := b.value(cmd)
			if err != nil {
				return err
			}
			fields := source.WriteFields{Title: &title, Body: text, Labels: labels, Assignees: assignees,
				Milestone: changed(cmd, "milestone", &milestone), BlockedBy: blockedBy}
			if parent > 0 {
				fields.Parent = &parent
			}
			return runWrite(cmd, *repo, writeOf{op: source.IssueCreate, fields: fields, json: jsonFields, jsonSet: cmd.Flags().Changed("json")})
		},
	}
	f := cmd.Flags()
	f.StringVarP(&title, "title", "t", "", "the title")
	b.add(cmd, true)
	f.StringSliceVarP(&labels, "label", "l", nil, "add labels (ready-for-agent sets the Ticket ready)")
	f.StringSliceVarP(&assignees, "assignee", "a", nil, "assign people by their login")
	f.StringVarP(&milestone, "milestone", "m", "", "the milestone, by its title")
	f.IntSliceVar(&blockedBy, "blocked-by", nil, "the Tickets this one is blocked by, N,…")
	f.IntVar(&parent, "parent", 0, "the parent Ticket")
	f.StringVar(&jsonFields, "json", "", "print the created Ticket's fields: number,url")
	return cmd
}

func newIssueEdit(repo *string) *cobra.Command {
	var b body
	var l labelled
	var title string
	var addBlockedBy, removeBlockedBy []int
	var parent int
	var removeParent bool
	cmd := &cobra.Command{
		Use:   "edit <number>",
		Short: "Edit a Ticket, as gh issue edit",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			number, err := writeNumber(args[0])
			if err != nil {
				return err
			}
			text, err := b.value(cmd)
			if err != nil {
				return err
			}
			fields := source.WriteFields{Title: changed(cmd, "title", &title), Body: text, AddBlockedBy: addBlockedBy, RemoveBlockedBy: removeBlockedBy}
			l.fields(cmd, &fields)
			if cmd.Flags().Changed("parent") {
				fields.Parent = &parent
			}
			if removeParent {
				none := 0
				fields.Parent = &none
			}
			return runWrite(cmd, *repo, writeOf{op: source.IssueEdit, number: number, fields: fields})
		},
	}
	f := cmd.Flags()
	f.StringVarP(&title, "title", "t", "", "the title")
	b.add(cmd, false)
	l.add(cmd)
	f.IntSliceVar(&addBlockedBy, "add-blocked-by", nil, "add Tickets this one is blocked by, N,…")
	f.IntSliceVar(&removeBlockedBy, "remove-blocked-by", nil, "remove Tickets this one is blocked by, N,…")
	f.IntVar(&parent, "parent", 0, "the parent Ticket")
	f.BoolVar(&removeParent, "remove-parent", false, "remove the parent Ticket")
	cmd.MarkFlagsMutuallyExclusive("parent", "remove-parent")
	return cmd
}

func newWriteComment(repo *string, pulls bool) *cobra.Command {
	var b body
	use, what, op := "comment <number>", "a Ticket, as gh issue comment", source.IssueComment
	if pulls {
		use, what, op = "comment [<number>]", "a pull request, as gh pr comment", source.PrComment
	}
	cmd := &cobra.Command{
		Use:   use,
		Short: "Comment " + what,
		Args:  numberArgs(pulls),
		RunE: func(cmd *cobra.Command, args []string) error {
			text, err := b.value(cmd)
			if err != nil {
				return err
			}
			if text == nil || strings.TrimSpace(*text) == "" {
				return &exitError{code: 2, err: errors.New("Donne le commentaire : --body ou --body-file.")}
			}
			return runWrite(cmd, *repo, writeOf{op: op, arg: firstArg(args), fields: source.WriteFields{Body: text}})
		},
	}
	b.add(cmd, true)
	return cmd
}

func newIssueState(repo *string, closing bool) *cobra.Command {
	var reason, comment string
	use, short, op := "reopen <number>", "Reopen a Ticket, as gh issue reopen", source.IssueReopen
	if closing {
		use, short, op = "close <number>", "Close a Ticket, as gh issue close", source.IssueClose
	}
	cmd := &cobra.Command{
		Use:   use,
		Short: short,
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			number, err := writeNumber(args[0])
			if err != nil {
				return err
			}
			fields := source.WriteFields{Comment: comment}
			if closing {
				switch reason {
				case "", "completed":
					fields.Reason = source.ReasonCompleted
				case "not planned", "not_planned":
					fields.Reason = source.ReasonNotPlanned
				default:
					return &exitError{code: 2, err: fmt.Errorf("La raison %q n'existe pas : completed ou \"not planned\".", reason)}
				}
			}
			return runWrite(cmd, *repo, writeOf{op: op, number: number, fields: fields})
		},
	}
	if closing {
		cmd.Flags().StringVarP(&reason, "reason", "r", "", `why: completed or "not planned"`)
	}
	cmd.Flags().StringVarP(&comment, "comment", "c", "", "leave a comment first")
	return cmd
}

func newPullCreate(repo *string) *cobra.Command {
	var b body
	var title, base, head, milestone, jsonFields string
	var draft bool
	var labels, assignees []string
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Open a change of code, as gh pr create",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if strings.TrimSpace(title) == "" {
				return &exitError{code: 2, err: errors.New("Donne le titre : --title.")}
			}
			text, err := b.value(cmd)
			if err != nil {
				return err
			}
			fields := source.WriteFields{Title: &title, Body: text, Head: head, Draft: draft, Labels: labels, Assignees: assignees,
				Milestone: changed(cmd, "milestone", &milestone), Base: changed(cmd, "base", &base)}
			return runWrite(cmd, *repo, writeOf{op: source.PrCreate, fields: fields, json: jsonFields, jsonSet: cmd.Flags().Changed("json")})
		},
	}
	f := cmd.Flags()
	f.StringVarP(&title, "title", "t", "", "the title")
	b.add(cmd, true)
	f.StringVarP(&base, "base", "B", "", "the branch to merge into (default: the Projet's integration branch)")
	f.StringVarP(&head, "head", "H", "", "the branch of the change (default: the current branch)")
	f.BoolVarP(&draft, "draft", "d", false, "open it as a draft")
	f.StringSliceVarP(&labels, "label", "l", nil, "add labels")
	f.StringSliceVarP(&assignees, "assignee", "a", nil, "assign people by their login")
	f.StringVarP(&milestone, "milestone", "m", "", "the milestone, by its title")
	f.StringVar(&jsonFields, "json", "", "print the created pull request's fields: number,url")
	return cmd
}

func newPullEdit(repo *string) *cobra.Command {
	var b body
	var l labelled
	var title, base string
	cmd := &cobra.Command{
		Use:   "edit [<number>]",
		Short: "Edit a pull request, as gh pr edit",
		Args:  numberArgs(true),
		RunE: func(cmd *cobra.Command, args []string) error {
			text, err := b.value(cmd)
			if err != nil {
				return err
			}
			fields := source.WriteFields{Title: changed(cmd, "title", &title), Body: text, Base: changed(cmd, "base", &base)}
			l.fields(cmd, &fields)
			return runWrite(cmd, *repo, writeOf{op: source.PrEdit, arg: firstArg(args), fields: fields})
		},
	}
	cmd.Flags().StringVarP(&title, "title", "t", "", "the title")
	b.add(cmd, false)
	l.add(cmd)
	cmd.Flags().StringVarP(&base, "base", "B", "", "the branch to merge into")
	return cmd
}

func newPullReview(repo *string) *cobra.Command {
	var b body
	var approve, request, comment bool
	cmd := &cobra.Command{
		Use:   "review [<number>]",
		Short: "Review a pull request, as gh pr review",
		Args:  numberArgs(true),
		RunE: func(cmd *cobra.Command, args []string) error {
			var state source.ReviewState
			switch {
			case approve:
				state = source.ReviewApproved
			case request:
				state = source.ReviewChangesRequested
			case comment:
				state = source.ReviewCommented
			default:
				return &exitError{code: 2, err: errors.New("Donne le verdict : --approve, --request-changes ou --comment.")}
			}
			text, err := b.value(cmd)
			if err != nil {
				return err
			}
			if state != source.ReviewApproved && (text == nil || strings.TrimSpace(*text) == "") {
				return &exitError{code: 2, err: errors.New("Ce verdict demande un corps : --body ou --body-file.")}
			}
			return runWrite(cmd, *repo, writeOf{op: source.PrReview, arg: firstArg(args), fields: source.WriteFields{Review: state, Body: text}})
		},
	}
	f := cmd.Flags()
	f.BoolVarP(&approve, "approve", "a", false, "approve the pull request")
	f.BoolVarP(&request, "request-changes", "r", false, "request changes")
	f.BoolVarP(&comment, "comment", "c", false, "comment without a verdict")
	cmd.MarkFlagsMutuallyExclusive("approve", "request-changes", "comment")
	b.add(cmd, true)
	return cmd
}

func newPullState(repo *string, closing bool) *cobra.Command {
	var comment string
	var deleteBranch bool
	use, short, op := "reopen [<number>]", "Reopen a pull request, as gh pr reopen", source.PrReopen
	if closing {
		use, short, op = "close [<number>]", "Close a pull request, as gh pr close", source.PrClose
	}
	cmd := &cobra.Command{
		Use:   use,
		Short: short,
		Args:  numberArgs(true),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runWrite(cmd, *repo, writeOf{op: op, arg: firstArg(args), fields: source.WriteFields{Comment: comment, DeleteBranch: deleteBranch}})
		},
	}
	cmd.Flags().StringVarP(&comment, "comment", "c", "", "leave a comment first")
	if closing {
		cmd.Flags().BoolVarP(&deleteBranch, "delete-branch", "d", false, "delete the branch once closed")
	}
	return cmd
}

func numberArgs(optional bool) cobra.PositionalArgs {
	if optional {
		return cobra.MaximumNArgs(1)
	}
	return cobra.ExactArgs(1)
}

func firstArg(args []string) string {
	if len(args) == 0 {
		return ""
	}
	return args[0]
}

func writeNumber(arg string) (int, error) {
	number, err := strconv.Atoi(strings.TrimPrefix(arg, "#"))
	if err != nil || number <= 0 {
		return 0, &exitError{code: 2, err: fmt.Errorf("%q n'est pas un numéro.", arg)}
	}
	return number, nil
}

// writeOf is one write as its command parsed it.
type writeOf struct {
	op     source.WriteOp
	number int
	// arg is a pull request's number as given, "" for the current branch's.
	arg     string
	fields  source.WriteFields
	json    string
	jsonSet bool
}

func (w writeOf) pulls() bool { return strings.HasPrefix(string(w.op), "pr.") }

func (w writeOf) creates() bool { return w.op == source.IssueCreate || w.op == source.PrCreate }

// runWrite does the write from the Session the environment names, then
// prints the object's URL, or the fields --json asks.
func runWrite(cmd *cobra.Command, repo string, w writeOf) error {
	var fields []string
	if w.jsonSet {
		for _, field := range strings.Split(w.json, ",") {
			field = strings.TrimSpace(field)
			if !slices.Contains(createFields, field) {
				return &exitError{code: 2, err: fmt.Errorf("Champ inconnu %q : --json prend %s.", field, strings.Join(createFields, ","))}
			}
			fields = append(fields, field)
		}
	}
	sessionID := os.Getenv(session.SessionEnv)
	if sessionID == "" {
		sessionID = os.Getenv(github.AskpassSessionEnv)
	}
	if sessionID == "" {
		fmt.Fprintln(cmd.ErrOrStderr(), notInSession)
		return silentExit(1)
	}
	m, err := openMiroir(cmd)
	if err != nil {
		return err
	}
	defer m.Close()
	ctx := cmd.Context()
	group := mirror.GroupTicket
	if w.pulls() {
		group = mirror.GroupCode
	}
	p, err := m.key(ctx, repo, group)
	if err != nil {
		return err
	}
	if err := m.complete(ctx, p, &w); err != nil {
		return err
	}
	number, err := m.writeTo(ctx, cmd, p, w, sessionID)
	if err != nil {
		return err
	}
	url := ""
	if object, err := m.store.View(p.Repository, number, w.pulls()); err == nil {
		url, _ = object["url"].(string)
	}
	if url == "" {
		url = fmt.Sprintf("%s#%d", p.Repository, number)
	}
	if !w.jsonSet {
		fmt.Fprintln(cmd.OutOrStdout(), url)
		return nil
	}
	out := map[string]any{}
	for _, field := range fields {
		switch field {
		case "number":
			out["number"] = number
		case "url":
			out["url"] = url
		}
	}
	data, _ := json.Marshal(out)
	fmt.Fprintln(cmd.OutOrStdout(), string(data))
	return nil
}

// complete gives a write its defaults: the head and base of a create, the
// current branch's pull request when no number is given.
func (m *miroir) complete(ctx context.Context, p mirror.Project, w *writeOf) error {
	switch {
	case w.op == source.PrCreate:
		if w.fields.Head == "" {
			branch, err := currentBranch(ctx)
			if err != nil {
				return err
			}
			w.fields.Head = branch
		}
		if w.fields.Base == nil {
			base := p.IntegrationBranch
			w.fields.Base = &base
		}
	case w.pulls() && w.arg == "":
		branch, err := currentBranch(ctx)
		if err != nil {
			return err
		}
		pulls, err := m.store.List(p.Repository, mirror.Filter{Pulls: true, State: "open", Head: branch, Limit: 1})
		if err != nil {
			return err
		}
		if len(pulls) == 0 {
			return fmt.Errorf("Aucun changement ouvert pour %s dans %s : donne son numéro.", branch, p.DisplayName)
		}
		w.number, _ = pulls[0]["number"].(int)
	case w.number == 0 && !w.creates():
		number, err := writeNumber(w.arg)
		if err != nil {
			return err
		}
		w.number = number
	}
	return nil
}

// currentBranch is the current directory's branch.
func currentBranch(ctx context.Context) (string, error) {
	out, err := exec.CommandContext(ctx, "git", "branch", "--show-current").Output()
	branch := strings.TrimSpace(string(out))
	if err != nil || branch == "" {
		return "", errors.New("Ce dossier n'est sur aucune branche : précise --head <branche>.")
	}
	return branch, nil
}

// writeTo writes on the key's Source; a refusal is printed in French, and
// the command exits 1.
func (m *miroir) writeTo(ctx context.Context, cmd *cobra.Command, p mirror.Project, w writeOf, sessionID string) (int, error) {
	refused := func(code string) error {
		fmt.Fprintln(cmd.ErrOrStderr(), writeRefusal(code, w.number, w.fields.Head, valueOf(w.fields.Milestone), p.DisplayName, p.Source == mirror.SourceLocal))
		return silentExit(1)
	}
	if p.Source == mirror.SourceLocal {
		var reply source.WriteReply
		err := m.call(ctx, source.OpWrite, source.WriteRequest{Key: p.Repository, Op: w.op, Number: w.number, Fields: w.fields, SessionID: sessionID}, &reply)
		var failed *localsock.Failed
		switch {
		case errors.Is(err, localsock.ErrNoRunner):
			fmt.Fprintln(cmd.ErrOrStderr(), notStarted)
			return 0, silentExit(1)
		case errors.As(err, &failed):
			return 0, refused(failed.Code)
		case err != nil:
			return 0, refused("")
		}
		return reply.Number, nil
	}

	tokenCtx, cancel := context.WithTimeout(ctx, localsock.Timeout)
	token, err := github.SessionTokenOf(tokenCtx, m.socket, sessionID)
	cancel()
	if err != nil {
		var failed *localsock.Failed
		if errors.As(err, &failed) && failed.Code == "not-found" {
			fmt.Fprintln(cmd.ErrOrStderr(), notInSession)
		} else {
			fmt.Fprintln(cmd.ErrOrStderr(), "Le jeton GitHub de cette Session n'est pas disponible : le Runner tourne-t-il ?")
		}
		return 0, silentExit(1)
	}
	owner, name, _ := strings.Cut(p.Repository, "/")
	writer := &ghsource.Writer{BaseURL: miroirGitHubAPI, Token: token, Owner: owner, Name: name, Copy: copyOf{m.store, p.Repository}}
	number, err := source.Apply(ctx, writer, w.op, w.number, w.fields, "", sessionID)
	var refusal *ghsource.HTTPError
	switch {
	case errors.As(err, &refusal):
		fmt.Fprintln(cmd.ErrOrStderr(), refusal.Error())
		return 0, silentExit(1)
	case refusalCode(err) != "":
		return 0, refused(refusalCode(err))
	case err != nil:
		fmt.Fprintf(cmd.ErrOrStderr(), "GitHub n'a pas répondu : %v\n", err)
		return 0, silentExit(1)
	}
	// The write is done: a failed refresh leaves it so, silent.
	fetchCtx, cancel := context.WithTimeout(ctx, localsock.Timeout)
	defer cancel()
	_ = localsock.Call(fetchCtx, m.socket, mirror.OpFetch, mirror.FetchRequest{Repository: p.Repository, Number: number}, nil)
	return number, nil
}

func valueOf(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// copyOf is what the GitHub writer reads of a key in the copy.
type copyOf struct {
	store *mirror.Store
	key   string
}

func (c copyOf) MilestoneNumber(title string) (int, bool) {
	milestones, err := c.store.Milestones(c.key)
	if err != nil {
		return 0, false
	}
	for number, m := range milestones {
		if m.Title == title {
			return number, true
		}
	}
	return 0, false
}

func (c copyOf) Parent(number int) int {
	o, err := c.store.Object(c.key, number)
	if err != nil {
		return 0
	}
	return o.Parent
}

func (c copyOf) HeadOid(number int) string {
	o, err := c.store.Object(c.key, number)
	if err != nil || o.Pull == nil {
		return ""
	}
	return o.Pull.HeadOid
}
