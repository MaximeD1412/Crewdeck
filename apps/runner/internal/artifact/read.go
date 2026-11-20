// Package artifact answers the page's reads of what lives on the Pilote's
// machine (SOURCE-4, ADR 0012 « Reading content in the page »): a file of a
// Local Projet's code at a branch or a SHA, a Ticket, a change of code, a
// diff, a Commande's output. Each answer is sealed for the one Appareil the
// tab named, once it is among the authenticated holders; the server only
// forwards it. Nothing of a content is ever in a log or an error.
package artifact

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/maximed1412/crewdeck/apps/runner/internal/command"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mirror"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/relay"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

// PlaintextMax is the most bytes of an answer's plaintext (its JSON), as
// packages/contracts' ARTIFACT_PLAINTEXT_MAX: a larger one is
// `artifact.too-large`.
const PlaintextMax = 4 << 20

// Timeout bounds one read: the server stops waiting after 30 s.
const Timeout = 30 * time.Second

var (
	errNotFound = errors.New("artifact: not found")
	errTooLarge = errors.New("artifact: too large")
)

// Project is a Projet this Runner holds the content of: its Source of
// Tickets and changes (SOURCE-2's Reader, nil when it has none here), and
// its clone, fetched from its folder before each read of code.
type Project struct {
	Source source.Reader
	Clone  func(ctx context.Context) (string, error)
}

// Reader answers `artifact.read`.
type Reader struct {
	// Home is the Runner's directory: the Commandes' logs are under it.
	Home string
	// Keys seal the answers, Keys.Holders the authenticated holders.
	Keys *relay.Keys
	// Projects is the Projet projectID, false when this Runner holds none such.
	Projects func(projectID string) (Project, bool)
	Send     func(ctx context.Context, message any) error
	// Warn says a read that failed for another reason than its absence: its
	// kind and the error, never a content.
	Warn func(kind string, err error)
}

// Register answers each `artifact.read` of client, one goroutine each.
func (r *Reader) Register(ctx context.Context, client *protocol.Client) {
	protocol.On(client, protocol.TypeArtifactRead, func(_ context.Context, message contracts.RunnerArtifactRead) error {
		go r.Handle(ctx, message)
		return nil
	})
}

// Handle reads the artefact message asks and sends the answer: its content
// sealed for message.HolderId, or `artifact.error`. An untrusted holder is
// refused before anything is read.
func (r *Reader) Handle(ctx context.Context, message contracts.RunnerArtifactRead) {
	ctx, cancel := context.WithTimeout(ctx, Timeout)
	defer cancel()
	refuse := func(code contracts.RunnerArtifactErrorCode) {
		_ = r.Send(ctx, protocol.NewArtifactError(message.RequestId, message.TabId, code))
	}
	if _, err := r.Keys.Trusted(message.HolderId); err != nil {
		refuse(contracts.RunnerArtifactErrorCodeArtifactUntrustedDevice)
		return
	}
	value, err := r.read(ctx, message)
	var plain []byte
	if err == nil {
		plain, err = json.Marshal(value)
	}
	if err == nil && len(plain) > PlaintextMax {
		err = errTooLarge
	}
	switch {
	case errors.Is(err, errTooLarge):
		refuse(contracts.RunnerArtifactErrorCodeArtifactTooLarge)
		return
	case err != nil:
		if !errors.Is(err, errNotFound) && !errors.Is(err, source.ErrNotFound) && r.Warn != nil {
			r.Warn(string(message.Kind), err)
		}
		refuse(contracts.RunnerArtifactErrorCodeArtifactNotFound)
		return
	}
	wrap, nonce, ciphertext, err := seal(r.Keys, message.RequestId, message.HolderId, plain)
	clear(plain)
	if errors.Is(err, relay.ErrUntrusted) {
		refuse(contracts.RunnerArtifactErrorCodeArtifactUntrustedDevice)
		return
	}
	if err != nil {
		if r.Warn != nil {
			r.Warn(string(message.Kind), err)
		}
		refuse(contracts.RunnerArtifactErrorCodeArtifactNotFound)
		return
	}
	_ = r.Send(ctx, protocol.NewArtifactContent(message.RequestId, message.TabId, wrap, nonce, ciphertext))
}

func (r *Reader) read(ctx context.Context, m contracts.RunnerArtifactRead) (any, error) {
	if m.Kind == contracts.RunnerArtifactReadKindCommandOutput {
		if m.Ref.RunId == nil {
			return nil, errNotFound
		}
		return r.commandOutput(*m.Ref.RunId)
	}
	p, ok := r.Projects(m.ProjectId)
	if !ok {
		return nil, errNotFound
	}
	switch m.Kind {
	case contracts.RunnerArtifactReadKindFile:
		if m.Ref.Path == nil {
			return nil, errNotFound
		}
		at := "HEAD"
		if m.Ref.At != nil {
			at = *m.Ref.At
		}
		return readFile(ctx, p, *m.Ref.Path, at)
	case contracts.RunnerArtifactReadKindTicket:
		if m.Ref.Number == nil || p.Source == nil {
			return nil, errNotFound
		}
		return readTicket(ctx, p.Source, *m.Ref.Number)
	case contracts.RunnerArtifactReadKindChange:
		if m.Ref.Number == nil || p.Source == nil {
			return nil, errNotFound
		}
		return readChange(ctx, p.Source, *m.Ref.Number)
	case contracts.RunnerArtifactReadKindDiff:
		return readDiff(ctx, p, m.Ref)
	}
	return nil, errNotFound
}

// --- The plaintexts, the shapes of packages/contracts' runner/artifact.ts.

type actor struct {
	Login string `json:"login"`
}

func actorOf(login string) *actor {
	if login == "" {
		return nil
	}
	return &actor{Login: login}
}

func timeOf(t time.Time) *string {
	if t.IsZero() {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}

type label struct {
	Name string `json:"name"`
}

type milestone struct {
	Number      int     `json:"number"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	DueOn       *string `json:"dueOn"`
}

type comment struct {
	Author    *actor  `json:"author"`
	Body      string  `json:"body"`
	CreatedAt *string `json:"createdAt"`
}

type ticket struct {
	Number      int        `json:"number"`
	Title       string     `json:"title"`
	Body        string     `json:"body"`
	State       string     `json:"state"`
	StateReason string     `json:"stateReason"`
	Labels      []label    `json:"labels"`
	Milestone   *milestone `json:"milestone"`
	Comments    []comment  `json:"comments"`
	BlockedBy   []int      `json:"blockedBy"`
	Parent      *int       `json:"parent"`
}

type oid struct {
	Oid string `json:"oid"`
}

type review struct {
	Author      *actor  `json:"author"`
	State       string  `json:"state"`
	Body        string  `json:"body"`
	SubmittedAt *string `json:"submittedAt"`
	Commit      *oid    `json:"commit"`
}

type change struct {
	Number      int       `json:"number"`
	Title       string    `json:"title"`
	Body        string    `json:"body"`
	State       string    `json:"state"`
	HeadRefName string    `json:"headRefName"`
	HeadRefOid  string    `json:"headRefOid"`
	BaseRefName string    `json:"baseRefName"`
	Reviews     []review  `json:"reviews"`
	Comments    []comment `json:"comments"`
}

type file struct {
	Path    string `json:"path"`
	Sha     string `json:"sha"`
	Content string `json:"content"`
	Binary  bool   `json:"binary,omitempty"`
}

type diff struct {
	Base  string `json:"base"`
	Head  string `json:"head"`
	Patch string `json:"patch"`
}

type chunk struct {
	Seq    int       `json:"seq"`
	At     time.Time `json:"at"`
	Stream string    `json:"stream"`
	Text   string    `json:"text"`
}

type output struct {
	Chunks []chunk `json:"chunks"`
}

func comments(ctx context.Context, r source.Reader, number int) ([]comment, error) {
	found, err := r.Comments(ctx, number)
	if err != nil {
		return nil, err
	}
	out := []comment{}
	for _, c := range found {
		out = append(out, comment{Author: actorOf(c.Author), Body: c.Body, CreatedAt: timeOf(c.CreatedAt)})
	}
	return out, nil
}

// readTicket is the Ticket in gh's shape, as the Miroir writes it: its
// state upper case, the ready label among its labels.
func readTicket(ctx context.Context, r source.Reader, number int) (ticket, error) {
	t, err := r.Ticket(ctx, number)
	if err != nil {
		return ticket{}, err
	}
	out := ticket{
		Number: t.Number, Title: t.Title, Body: t.Body,
		State: strings.ToUpper(string(t.State)), StateReason: strings.ToUpper(string(t.StateReason)),
		Labels: []label{}, BlockedBy: []int{}, Parent: t.Parent,
	}
	if out.State == "" {
		out.State = "OPEN"
	}
	seen := map[string]bool{}
	for _, l := range t.Labels {
		if !seen[l] {
			seen[l] = true
			out.Labels = append(out.Labels, label{Name: l})
		}
	}
	if t.Ready && !seen[mirror.ReadyLabel] {
		out.Labels = append(out.Labels, label{Name: mirror.ReadyLabel})
	}
	if t.Milestone != nil {
		var due *string
		if t.Milestone.DueOn != nil {
			due = timeOf(*t.Milestone.DueOn)
		}
		out.Milestone = &milestone{Number: t.Milestone.Number, Title: t.Milestone.Title, DueOn: due}
	}
	out.BlockedBy = append(out.BlockedBy, t.BlockedBy...)
	if out.Comments, err = comments(ctx, r, number); err != nil {
		return ticket{}, err
	}
	return out, nil
}

// readChange is the change in gh's shape: its head the branch's now, its
// reviews and its comments.
func readChange(ctx context.Context, r source.Reader, number int) (change, error) {
	c, err := r.Change(ctx, number)
	if err != nil {
		return change{}, err
	}
	out := change{
		Number: c.Number, Title: c.Title, Body: c.Body, State: strings.ToUpper(string(c.State)),
		HeadRefName: c.HeadRef, HeadRefOid: c.HeadOid, BaseRefName: c.BaseRef, Reviews: []review{},
	}
	if out.State == "" {
		out.State = "OPEN"
	}
	if history, err := r.History(ctx, number); err == nil && history.HeadOid != "" {
		out.HeadRefOid = history.HeadOid
	}
	reviews, err := r.Reviews(ctx, number)
	if err != nil {
		return change{}, err
	}
	for _, rv := range reviews {
		var commit *oid
		if rv.CommitOid != "" {
			commit = &oid{Oid: rv.CommitOid}
		}
		out.Reviews = append(out.Reviews, review{Author: actorOf(rv.Author), State: string(rv.State), Body: rv.Body, SubmittedAt: timeOf(rv.SubmittedAt), Commit: commit})
	}
	if out.Comments, err = comments(ctx, r, number); err != nil {
		return change{}, err
	}
	return out, nil
}

func (r *Reader) commandOutput(runID string) (output, error) {
	if runID == "" || strings.ContainsAny(runID, `/\.`) || !command.Logged(r.Home, runID) {
		return output{}, errNotFound
	}
	out := output{Chunks: []chunk{}}
	size := 0
	for c, err := range command.Replay(r.Home, runID, 1) {
		if err != nil {
			return output{}, err
		}
		if size += len(c.Text); size > PlaintextMax {
			return output{}, errTooLarge
		}
		out.Chunks = append(out.Chunks, chunk{Seq: c.Seq, At: c.At.UTC(), Stream: string(c.Stream), Text: c.Text})
	}
	return out, nil
}

// --- The code, in the Projet's clone.

// validRef is a branch or a SHA git reads as one: never an option.
func validRef(ref string) bool {
	if ref == "" || len(ref) > 255 || strings.HasPrefix(ref, "-") || strings.Contains(ref, "..") {
		return false
	}
	for _, c := range ref {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '.' || c == '_' || c == '/' || c == '-') {
			return false
		}
	}
	return true
}

// validPath is a path inside the repository: relative, without a « .. ».
func validPath(path string) bool {
	if path == "" || strings.HasPrefix(path, "/") || strings.ContainsAny(path, "\\\x00") {
		return false
	}
	for _, part := range strings.Split(path, "/") {
		if part == ".." {
			return false
		}
	}
	return true
}

// clone is the Projet's clone, fetched from its folder; a fetch that fails
// leaves the clone as it was, read as is.
func clone(ctx context.Context, p Project) (string, error) {
	if p.Clone == nil {
		return "", errNotFound
	}
	dir, err := p.Clone(ctx)
	if dir == "" {
		return "", errors.Join(errNotFound, err)
	}
	if _, statErr := os.Stat(dir); statErr != nil {
		return "", errors.Join(errNotFound, err)
	}
	return dir, nil
}

// git runs git in dir and gives its output, at most limit bytes (errTooLarge
// past them). Its errors never hold what git printed.
func git(ctx context.Context, dir string, limit int, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "LC_ALL=C")
	out := &limited{limit: limit}
	cmd.Stdout = out
	err := cmd.Run()
	if out.over {
		return nil, errTooLarge
	}
	if err != nil {
		return nil, errors.New("artifact: git " + args[0] + " failed")
	}
	return out.buf.Bytes(), nil
}

// limited keeps at most limit bytes, then fails the writes.
type limited struct {
	buf   bytes.Buffer
	limit int
	over  bool
}

func (l *limited) Write(p []byte) (int, error) {
	if l.buf.Len()+len(p) > l.limit {
		l.over = true
		return 0, errTooLarge
	}
	return l.buf.Write(p)
}

// resolve is the commit at names in the clone: the folder's branch
// (origin/<at>) first, else a commit or a branch of the clone.
func resolve(ctx context.Context, dir, at string) (string, error) {
	if !validRef(at) {
		return "", errNotFound
	}
	for _, candidate := range []string{"refs/remotes/origin/" + at, at} {
		out, err := git(ctx, dir, 1024, "rev-parse", "--verify", "--quiet", "--end-of-options", candidate+"^{commit}")
		if err == nil {
			return strings.TrimSpace(string(out)), nil
		}
	}
	return "", errNotFound
}

func readFile(ctx context.Context, p Project, path, at string) (file, error) {
	if !validPath(path) || !validRef(at) {
		return file{}, errNotFound
	}
	dir, err := clone(ctx, p)
	if err != nil {
		return file{}, err
	}
	commit, err := resolve(ctx, dir, at)
	if err != nil {
		return file{}, err
	}
	out, err := git(ctx, dir, 1024, "rev-parse", "--verify", "--quiet", "--end-of-options", commit+":"+path)
	if err != nil {
		return file{}, errNotFound
	}
	sha := strings.TrimSpace(string(out))
	kind, err := git(ctx, dir, 64, "cat-file", "-t", sha)
	if err != nil || strings.TrimSpace(string(kind)) != "blob" {
		return file{}, errNotFound
	}
	content, err := git(ctx, dir, PlaintextMax, "cat-file", "blob", sha)
	if err != nil {
		return file{}, err
	}
	if utf8.Valid(content) && !bytes.Contains(content, []byte{0}) {
		return file{Path: path, Sha: sha, Content: string(content)}, nil
	}
	return file{Path: path, Sha: sha, Content: base64.StdEncoding.EncodeToString(content), Binary: true}, nil
}

// readDiff is `git diff base...head`: a change's base and head (its head's
// commit once its branch is gone), or the two the tab named.
func readDiff(ctx context.Context, p Project, ref contracts.RunnerArtifactReadRef) (diff, error) {
	var base, head, headOid string
	switch {
	case ref.Number != nil:
		if p.Source == nil {
			return diff{}, errNotFound
		}
		c, err := p.Source.Change(ctx, *ref.Number)
		if err != nil {
			return diff{}, err
		}
		base, head, headOid = c.BaseRef, c.HeadRef, c.HeadOid
	case ref.Base != nil && ref.Head != nil:
		base, head = *ref.Base, *ref.Head
	default:
		return diff{}, errNotFound
	}
	dir, err := clone(ctx, p)
	if err != nil {
		return diff{}, err
	}
	from, err := resolve(ctx, dir, base)
	if err != nil {
		return diff{}, err
	}
	to, err := resolve(ctx, dir, head)
	if err != nil && headOid != "" {
		to, err = resolve(ctx, dir, headOid)
	}
	if err != nil {
		return diff{}, err
	}
	patch, err := git(ctx, dir, PlaintextMax, "diff", "--no-color", "--no-ext-diff", "--end-of-options", from+"..."+to)
	if err != nil {
		return diff{}, err
	}
	return diff{Base: base, Head: head, Patch: string(patch)}, nil
}
