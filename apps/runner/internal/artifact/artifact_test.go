package artifact_test

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"encoding/json"
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/artifact"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/relay"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
)

// go test ./internal/artifact -run TestTheRecordedAnswer -update rewrites
// packages/contracts/fixtures/crypto/artifact.json from a fresh answer.
var update = flag.Bool("update", false, "rewrite packages/contracts/fixtures/crypto/artifact.json")

const (
	projectID = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d21"
	tabID     = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6aa1"
	requestID = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d11"
	runID     = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01"
)

var vectorPath = filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "crypto", "artifact.json")

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

// testVault is a vault of its own key, which a Local Projet hashes its Tickets with.
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

func commit(t *testing.T, dir, message string, files map[string]string) string {
	t.Helper()
	for name, content := range files {
		write(t, dir, name, content)
	}
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "--quiet", "--allow-empty", "-m", message)
	return git(t, dir, "rev-parse", "HEAD")
}

// sent is the fake server: every message the reader sends.
type sent struct {
	mu       sync.Mutex
	messages []any
}

func (s *sent) send(_ context.Context, message any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.messages = append(s.messages, message)
	return nil
}

func (s *sent) only(t *testing.T) any {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.messages) != 1 {
		t.Fatalf("sent %d messages, want 1: %+v", len(s.messages), s.messages)
	}
	m := s.messages[0]
	s.messages = nil
	return m
}

type harness struct {
	t       *testing.T
	home    string
	folder  string
	clone   string
	project *local.Project
	runner  *ecdh.PrivateKey
	device  *ecdh.PrivateKey
	reader  *artifact.Reader
	sent    *sent
}

// newHarness is a Local Projet (a git folder with Ticket 12 and docs/prd.md
// on main), its Runner, and one authenticated Appareil.
func newHarness(t *testing.T) *harness {
	t.Helper()
	home := t.TempDir()
	folder := t.TempDir()
	git(t, folder, "init", "--quiet")
	commit(t, folder, "Les Tickets", map[string]string{
		"tickets/12-le-panier.md": "---\nnumber: 12\ntitle: Le panier\nlabels: [front]\nready: true\nblocked_by: [3]\n---\nLe panier garde MARQUEUR-7f3a9c.\n",
		"docs/prd.md":             "# PRD v1\n",
	})
	db, err := local.OpenDB(filepath.Join(home, "local.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	runner, _ := keys.GenerateKeyPair()
	device, _ := keys.GenerateKeyPair()
	v := testVault(t)
	vault := func() *keys.Vault { return v }
	project := local.Open(db, vault, projectID, folder)
	origin := &local.Origin{Home: home, ProjectID: projectID, Folder: func(string) (string, bool) { return folder, true }}
	project.SetClone(origin.Dir())
	h := &harness{t: t, home: home, folder: folder, clone: origin.Dir(), project: project, runner: runner, device: device, sent: &sent{}}
	h.reader = &artifact.Reader{
		Home: home,
		Keys: &relay.Keys{Runner: runner, Holders: func() ([][]byte, error) { return [][]byte{keys.PublicKeyBytes(device)}, nil }},
		Projects: func(id string) (artifact.Project, bool) {
			if id != projectID {
				return artifact.Project{}, false
			}
			return artifact.Project{Source: project, Clone: func(ctx context.Context) (string, error) {
				dir, _, err := origin.Clone(ctx)
				return dir, err
			}}, true
		},
		Send: h.sent.send,
	}
	return h
}

func (h *harness) holderID() string { return relay.B64.EncodeToString(keys.PublicKeyBytes(h.device)) }

func (h *harness) read(kind contracts.RunnerArtifactReadKind, ref contracts.RunnerArtifactReadRef) contracts.RunnerArtifactRead {
	return contracts.RunnerArtifactRead{Type: "artifact.read", Id: requestID, At: time.Now(), RequestId: requestID, TabId: tabID,
		ProjectId: projectID, HolderId: h.holderID(), Kind: kind, Ref: ref}
}

// answer reads and gives what the reader sent.
func (h *harness) answer(kind contracts.RunnerArtifactReadKind, ref contracts.RunnerArtifactReadRef) any {
	h.t.Helper()
	h.reader.Handle(context.Background(), h.read(kind, ref))
	return h.sent.only(h.t)
}

// open is the plaintext of a content, opened as the page does.
func open(t *testing.T, device *ecdh.PrivateKey, runnerPublic []byte, content contracts.RunnerArtifactContent) []byte {
	t.Helper()
	dec := func(s string) []byte {
		b, err := relay.B64.Strict().DecodeString(s)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	holderID := relay.B64.EncodeToString(keys.PublicKeyBytes(device))
	if content.Wrap.HolderId != holderID {
		t.Fatalf("wrapped for %s, not %s", content.Wrap.HolderId, holderID)
	}
	key, err := keys.OpenWrap(device, runnerPublic, keys.Wrap{Enc: dec(content.Wrap.Enc), Ciphertext: dec(content.Wrap.WrappedKey), Tag: dec(content.Wrap.Tag)},
		[]byte(keys.InfoSessionKey), []byte("artifact:"+content.RequestId+":"+holderID))
	if err != nil {
		t.Fatalf("open the wrap: %v", err)
	}
	plain, err := relay.Open(key, content.Nonce, content.Ciphertext, "artifact:"+content.RequestId)
	if err != nil {
		t.Fatalf("open the content: %v", err)
	}
	return plain
}

func (h *harness) content(kind contracts.RunnerArtifactReadKind, ref contracts.RunnerArtifactReadRef, into any) {
	h.t.Helper()
	m := h.answer(kind, ref)
	content, ok := m.(contracts.RunnerArtifactContent)
	if !ok {
		h.t.Fatalf("answered %+v, not a content", m)
	}
	if content.RequestId != requestID || content.TabId != tabID || content.Type != "artifact.content" {
		h.t.Fatalf("content %+v", content)
	}
	plain := open(h.t, h.device, keys.PublicKeyBytes(h.runner), content)
	if strings.Contains(content.Ciphertext, "MARQUEUR") {
		h.t.Fatal("the ciphertext holds the plaintext")
	}
	if err := json.Unmarshal(plain, into); err != nil {
		h.t.Fatalf("plaintext %s: %v", plain, err)
	}
}

func (h *harness) error(kind contracts.RunnerArtifactReadKind, ref contracts.RunnerArtifactReadRef) contracts.RunnerArtifactErrorCode {
	h.t.Helper()
	m := h.answer(kind, ref)
	e, ok := m.(contracts.RunnerArtifactError)
	if !ok {
		h.t.Fatalf("answered %+v, not an error", m)
	}
	if e.RequestId != requestID || e.TabId != tabID {
		h.t.Fatalf("error %+v", e)
	}
	return e.Code
}

func ptr[T any](v T) *T { return &v }

type ticket struct {
	Number      int                     `json:"number"`
	Title       string                  `json:"title"`
	Body        string                  `json:"body"`
	State       string                  `json:"state"`
	StateReason string                  `json:"stateReason"`
	Labels      []struct{ Name string } `json:"labels"`
	Milestone   *struct{ Title string } `json:"milestone"`
	Comments    []json.RawMessage       `json:"comments"`
	BlockedBy   []int                   `json:"blockedBy"`
	Parent      *int                    `json:"parent"`
}

func TestTicket12OfALocalProjetIsAnsweredSealedForTheAppareil(t *testing.T) {
	h := newHarness(t)
	var got ticket
	h.content(contracts.RunnerArtifactReadKindTicket, contracts.RunnerArtifactReadRef{Number: ptr(12)}, &got)
	if got.Number != 12 || got.Title != "Le panier" || got.Body != "Le panier garde MARQUEUR-7f3a9c.\n" || got.State != "OPEN" || got.StateReason != "" ||
		got.Milestone != nil || got.Parent != nil || len(got.BlockedBy) != 1 || got.BlockedBy[0] != 3 || got.Comments == nil || len(got.Comments) != 0 {
		t.Errorf("ticket %+v", got)
	}
	var labels []string
	for _, l := range got.Labels {
		labels = append(labels, l.Name)
	}
	if strings.Join(labels, ",") != "front,ready-for-agent" {
		t.Errorf("labels %v", labels)
	}
	if code := h.error(contracts.RunnerArtifactReadKindTicket, contracts.RunnerArtifactReadRef{Number: ptr(99)}); code != contracts.RunnerArtifactErrorCodeArtifactNotFound {
		t.Errorf("Ticket 99: %s", code)
	}
}

// A jalon typed in a Ticket's file, which milestones.yml does not hold, has
// no number: null, never a 0 the page would refuse.
func TestAMilestoneMilestonesYmlDoesNotHoldHasNoNumber(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t)
	commit(t, h.folder, "Le jalon", map[string]string{"tickets/14-le-jalon.md": "---\nnumber: 14\ntitle: Le jalon\nmilestone: M1\n---\nCorps.\n"})
	if _, err := h.project.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	h.content(contracts.RunnerArtifactReadKindTicket, contracts.RunnerArtifactReadRef{Number: ptr(14)}, &got)
	milestone, _ := got["milestone"].(map[string]any)
	if number, held := milestone["number"]; !held || number != nil || milestone["title"] != "M1" {
		t.Errorf("milestone %#v", got["milestone"])
	}
}

type file struct {
	Path    string `json:"path"`
	Sha     string `json:"sha"`
	Content string `json:"content"`
	Binary  *bool  `json:"binary"`
}

func TestAFileAnswersTheVersionOfItsBranchOrItsSha(t *testing.T) {
	h := newHarness(t)
	first := git(t, h.folder, "rev-parse", "HEAD")
	git(t, h.folder, "checkout", "--quiet", "-b", "develop")
	commit(t, h.folder, "PRD v2", map[string]string{"docs/prd.md": "# PRD v2\n"})
	git(t, h.folder, "checkout", "--quiet", "main")

	var got file
	h.content(contracts.RunnerArtifactReadKindFile, contracts.RunnerArtifactReadRef{Path: ptr("docs/prd.md"), At: ptr("develop")}, &got)
	if got.Path != "docs/prd.md" || got.Content != "# PRD v2\n" || got.Binary != nil || got.Sha != git(t, h.folder, "rev-parse", "develop:docs/prd.md") {
		t.Errorf("at develop %+v", got)
	}
	h.content(contracts.RunnerArtifactReadKindFile, contracts.RunnerArtifactReadRef{Path: ptr("docs/prd.md"), At: ptr(first)}, &got)
	if got.Content != "# PRD v1\n" {
		t.Errorf("at %s %+v", first, got)
	}
	// A branch moved since: the next read fetches it.
	git(t, h.folder, "checkout", "--quiet", "develop")
	commit(t, h.folder, "PRD v3", map[string]string{"docs/prd.md": "# PRD v3\n"})
	h.content(contracts.RunnerArtifactReadKindFile, contracts.RunnerArtifactReadRef{Path: ptr("docs/prd.md"), At: ptr("develop")}, &got)
	if got.Content != "# PRD v3\n" {
		t.Errorf("after a commit %+v", got)
	}
	commit(t, h.folder, "binaire", map[string]string{"logo.png": "\x89PNG\x00\x01"})
	h.content(contracts.RunnerArtifactReadKindFile, contracts.RunnerArtifactReadRef{Path: ptr("logo.png"), At: ptr("develop")}, &got)
	if got.Binary == nil || !*got.Binary || got.Content != "iVBORwABAQ==" && got.Content != relay.B64.EncodeToString([]byte("\x89PNG\x00\x01")) {
		t.Errorf("a binary %+v", got)
	}
}

func TestAFileOutsideTheRepositoryOrTooLargeIsNotRead(t *testing.T) {
	h := newHarness(t)
	commit(t, h.folder, "gros", map[string]string{"big.txt": strings.Repeat("a", 5<<20)})
	for _, ref := range []contracts.RunnerArtifactReadRef{
		{Path: ptr("../x")},
		{Path: ptr("docs/../../x"), At: ptr("main")},
		{Path: ptr("/etc/passwd"), At: ptr("main")},
		{Path: ptr("absent.md"), At: ptr("main")},
		{Path: ptr("docs"), At: ptr("main")},
		{Path: ptr("docs/prd.md"), At: ptr("nowhere")},
		{Path: ptr("docs/prd.md"), At: ptr("--output=/tmp/x")},
	} {
		if code := h.error(contracts.RunnerArtifactReadKindFile, ref); code != contracts.RunnerArtifactErrorCodeArtifactNotFound {
			t.Errorf("%s at %v: %s", *ref.Path, ref.At, code)
		}
	}
	if code := h.error(contracts.RunnerArtifactReadKindFile, contracts.RunnerArtifactReadRef{Path: ptr("big.txt"), At: ptr("main")}); code != contracts.RunnerArtifactErrorCodeArtifactTooLarge {
		t.Errorf("5 MiB: %s", code)
	}
}

type diff struct {
	Base  string `json:"base"`
	Head  string `json:"head"`
	Patch string `json:"patch"`
}

type change struct {
	Number      int    `json:"number"`
	Title       string `json:"title"`
	State       string `json:"state"`
	HeadRefName string `json:"headRefName"`
	HeadRefOid  string `json:"headRefOid"`
	BaseRefName string `json:"baseRefName"`
	Reviews     []struct {
		Author *struct{ Login string } `json:"author"`
		State  string                  `json:"state"`
		Body   string                  `json:"body"`
		Commit *struct{ Oid string }   `json:"commit"`
	} `json:"reviews"`
	Comments []struct {
		Author *struct{ Login string } `json:"author"`
		Body   string                  `json:"body"`
	} `json:"comments"`
}

func TestADiffGivesTheChangesPatchAndAChangeItsReviews(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t)
	git(t, h.folder, "checkout", "--quiet", "-b", "feat/13-x")
	head := commit(t, h.folder, "feat : x", map[string]string{"x.txt": "x\n"})
	git(t, h.folder, "checkout", "--quiet", "main")
	commit(t, h.folder, "ailleurs", map[string]string{"y.txt": "y\n"})
	if _, err := h.project.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	created, err := h.project.CreateChange(ctx, source.NewChange{Title: "Le x", Body: "Closes #12", Head: "feat/13-x", Base: "main", Author: "code"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.project.Review(ctx, created.Number, source.NewReview{State: source.ReviewApproved, Body: "Bien", Author: "revue"}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.project.CommentChange(ctx, created.Number, "code", "Prêt", "s-1"); err != nil {
		t.Fatal(err)
	}

	var got diff
	h.content(contracts.RunnerArtifactReadKindDiff, contracts.RunnerArtifactReadRef{Number: ptr(created.Number)}, &got)
	if got.Base != "main" || got.Head != "feat/13-x" || !strings.Contains(got.Patch, "+++ b/x.txt") || strings.Contains(got.Patch, "y.txt") {
		t.Errorf("diff of the change %+v", got)
	}
	h.content(contracts.RunnerArtifactReadKindDiff, contracts.RunnerArtifactReadRef{Base: ptr("main"), Head: ptr("feat/13-x")}, &got)
	if !strings.Contains(got.Patch, "+x") {
		t.Errorf("diff of two branches %+v", got)
	}

	var c change
	h.content(contracts.RunnerArtifactReadKindChange, contracts.RunnerArtifactReadRef{Number: ptr(created.Number)}, &c)
	if c.Number != created.Number || c.Title != "Le x" || c.State != "OPEN" || c.HeadRefName != "feat/13-x" || c.HeadRefOid != head || c.BaseRefName != "main" ||
		len(c.Reviews) != 1 || c.Reviews[0].State != "APPROVED" || c.Reviews[0].Body != "Bien" || c.Reviews[0].Author == nil || c.Reviews[0].Author.Login != "revue" ||
		len(c.Comments) != 1 || c.Comments[0].Body != "Prêt" {
		t.Errorf("change %+v", c)
	}
	for _, kind := range []contracts.RunnerArtifactReadKind{contracts.RunnerArtifactReadKindChange, contracts.RunnerArtifactReadKindDiff} {
		if code := h.error(kind, contracts.RunnerArtifactReadRef{Number: ptr(77)}); code != contracts.RunnerArtifactErrorCodeArtifactNotFound {
			t.Errorf("%s 77: %s", kind, code)
		}
	}
}

// A Session's branch committed in the clone at A, the Pilote's folder moved
// on to B: the change and its diff name the same head, the Source's.
func TestAChangeAndItsDiffReadTheSameHead(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t)
	git(t, h.folder, "checkout", "--quiet", "-b", "feat/13-x")
	a := commit(t, h.folder, "feat : x", map[string]string{"x.txt": "x\n"})
	git(t, h.folder, "checkout", "--quiet", "main")
	if _, err := h.project.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	created, err := h.project.CreateChange(ctx, source.NewChange{Title: "Le x", Body: "Closes #12", Head: "feat/13-x", Base: "main", Author: "code"})
	if err != nil {
		t.Fatal(err)
	}
	var got diff
	h.content(contracts.RunnerArtifactReadKindDiff, contracts.RunnerArtifactReadRef{Number: ptr(created.Number)}, &got)
	git(t, h.clone, "branch", "feat/13-x", "refs/remotes/origin/feat/13-x")
	git(t, h.folder, "checkout", "--quiet", "feat/13-x")
	b := commit(t, h.folder, "feat : z", map[string]string{"z.txt": "z\n"})
	git(t, h.folder, "checkout", "--quiet", "main")

	var c change
	h.content(contracts.RunnerArtifactReadKindChange, contracts.RunnerArtifactReadRef{Number: ptr(created.Number)}, &c)
	h.content(contracts.RunnerArtifactReadKindDiff, contracts.RunnerArtifactReadRef{Number: ptr(created.Number)}, &got)
	if c.HeadRefOid != a || a == b {
		t.Fatalf("change's head %s, want the clone's %s", c.HeadRefOid, a)
	}
	if !strings.Contains(got.Patch, "+++ b/x.txt") || strings.Contains(got.Patch, "z.txt") {
		t.Errorf("diff of another head than the change's %s:\n%s", a, got.Patch)
	}
}

func TestACommandOutputReplaysItsRunsLog(t *testing.T) {
	h := newHarness(t)
	if code := h.error(contracts.RunnerArtifactReadKindCommandOutput, contracts.RunnerArtifactReadRef{RunId: ptr(runID)}); code != contracts.RunnerArtifactErrorCodeArtifactNotFound {
		t.Errorf("no log: %s", code)
	}
	at := time.Date(2026, 11, 17, 9, 1, 0, 0, time.UTC)
	write(t, h.home, "commands/"+runID+".log",
		`{"seq":1,"at":"2026-11-17T09:01:00Z","stream":"stdout","text":"ok 1\n"}`+"\n"+
			`{"seq":2,"at":"2026-11-17T09:01:00Z","stream":"stderr","text":"FAIL 2\n"}`+"\n")
	var got struct {
		Chunks []struct {
			Seq    int       `json:"seq"`
			At     time.Time `json:"at"`
			Stream string    `json:"stream"`
			Text   string    `json:"text"`
		} `json:"chunks"`
	}
	h.content(contracts.RunnerArtifactReadKindCommandOutput, contracts.RunnerArtifactReadRef{RunId: ptr(runID)}, &got)
	if len(got.Chunks) != 2 || got.Chunks[0].Text != "ok 1\n" || got.Chunks[1].Stream != "stderr" || got.Chunks[1].Seq != 2 || !got.Chunks[0].At.Equal(at) {
		t.Errorf("chunks %+v", got)
	}
}

func TestAnUntrustedHolderIsRefusedAndNothingSealed(t *testing.T) {
	h := newHarness(t)
	other, _ := keys.GenerateKeyPair()
	read := h.read(contracts.RunnerArtifactReadKindTicket, contracts.RunnerArtifactReadRef{Number: ptr(12)})
	read.HolderId = relay.B64.EncodeToString(keys.PublicKeyBytes(other))
	h.reader.Handle(context.Background(), read)
	m, ok := h.sent.only(t).(contracts.RunnerArtifactError)
	if !ok || m.Code != contracts.RunnerArtifactErrorCodeArtifactUntrustedDevice {
		t.Fatalf("answered %+v", m)
	}
	// Nor when the list cannot be read: the server's word is never enough.
	h.reader.Keys.Holders = func() ([][]byte, error) { return nil, os.ErrDeadlineExceeded }
	if code := h.error(contracts.RunnerArtifactReadKindTicket, contracts.RunnerArtifactReadRef{Number: ptr(12)}); code != contracts.RunnerArtifactErrorCodeArtifactUntrustedDevice {
		t.Errorf("no list: %s", code)
	}
}

func TestAProjetNotOfThisRunnerIsNotFound(t *testing.T) {
	h := newHarness(t)
	read := h.read(contracts.RunnerArtifactReadKindTicket, contracts.RunnerArtifactReadRef{Number: ptr(12)})
	read.ProjectId = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6fff"
	h.reader.Handle(context.Background(), read)
	if m, ok := h.sent.only(t).(contracts.RunnerArtifactError); !ok || m.Code != contracts.RunnerArtifactErrorCodeArtifactNotFound {
		t.Fatalf("answered %+v", m)
	}
}

// vector is packages/contracts/fixtures/crypto/artifact.json: an answer of
// the Runner, Ticket 12 of newHarness, which the page's test opens.
type vector struct {
	Description      string          `json:"description"`
	RunnerPrivateKey string          `json:"runnerPrivateKey"`
	RunnerPublicKey  string          `json:"runnerPublicKey"`
	DevicePrivateKey string          `json:"devicePrivateKey"`
	DevicePublicKey  string          `json:"devicePublicKey"`
	Frame            json.RawMessage `json:"frame"`
	Plaintext        json.RawMessage `json:"plaintext"`
}

func TestTheRecordedAnswerOpensAsTheRunnerSealedIt(t *testing.T) {
	h := newHarness(t)
	if *update {
		m := h.answer(contracts.RunnerArtifactReadKindTicket, contracts.RunnerArtifactReadRef{Number: ptr(12)})
		content := m.(contracts.RunnerArtifactContent)
		plain := open(t, h.device, keys.PublicKeyBytes(h.runner), content)
		frame, _ := json.Marshal(map[string]any{"type": content.Type, "requestId": content.RequestId, "wrap": content.Wrap, "nonce": content.Nonce, "ciphertext": content.Ciphertext})
		v := vector{
			Description:      "An answer of the Runner to `artifact.read` (docs/security/e2e.md « Contenu lu par la page »): Ticket 12 of a Local Projet sealed for an Appareil, the frame as the tab gets it. Written by `go test ./internal/artifact -run TestTheRecordedAnswer -update`; byte strings are base64url without padding.",
			RunnerPrivateKey: relay.B64.EncodeToString(h.runner.Bytes()),
			RunnerPublicKey:  relay.B64.EncodeToString(keys.PublicKeyBytes(h.runner)),
			DevicePrivateKey: relay.B64.EncodeToString(h.device.Bytes()),
			DevicePublicKey:  h.holderID(),
			Frame:            frame,
			Plaintext:        plain,
		}
		data, _ := json.MarshalIndent(v, "", "  ")
		if err := os.WriteFile(vectorPath, append(data, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(vectorPath)
	if err != nil {
		t.Fatal(err)
	}
	var v vector
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	devicePrivate, _ := relay.B64.DecodeString(v.DevicePrivateKey)
	device, err := ecdh.X25519().NewPrivateKey(devicePrivate)
	if err != nil {
		t.Fatal(err)
	}
	runnerPublic, _ := relay.B64.DecodeString(v.RunnerPublicKey)
	var frame struct {
		RequestId  string                              `json:"requestId"`
		Wrap       contracts.RunnerArtifactContentWrap `json:"wrap"`
		Nonce      string                              `json:"nonce"`
		Ciphertext string                              `json:"ciphertext"`
	}
	if err := json.Unmarshal(v.Frame, &frame); err != nil {
		t.Fatal(err)
	}
	plain := open(t, device, runnerPublic, contracts.RunnerArtifactContent{RequestId: frame.RequestId, Wrap: frame.Wrap, Nonce: frame.Nonce, Ciphertext: frame.Ciphertext})
	// The same Ticket read again gives the same plaintext.
	var fresh ticket
	h.content(contracts.RunnerArtifactReadKindTicket, contracts.RunnerArtifactReadRef{Number: ptr(12)}, &fresh)
	var recorded ticket
	if err := json.Unmarshal(plain, &recorded); err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(recorded)
	b, _ := json.Marshal(fresh)
	var compact bytes.Buffer
	if err := json.Compact(&compact, v.Plaintext); err != nil {
		t.Fatal(err)
	}
	if string(a) != string(b) || string(plain) != compact.String() {
		t.Errorf("recorded %s, read %s", a, b)
	}
}
