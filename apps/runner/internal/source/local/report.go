package local

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

// The labels of the keys derived from the vault key for a report.
const (
	reportDigestLabel = "crewdeck/v1/report-digest"
	pathKeyLabel      = "crewdeck/v1/path-key"
)

// ErrNoVault: no vault key is held, nothing can be sealed (the Runner waits
// for the Pilote's Appareil).
var ErrNoVault = errors.New("local: no vault key held, nothing is reported")

// readableLabel is a label the server reads in clear (`LOCAL_READABLE_LABEL`).
var readableLabel = regexp.MustCompile(`^(priority:.+|size:.+|ready-for-agent|needs-human)$`)

// deliveringBranch is a change's head branch that names its Ticket.
var deliveringBranch = regexp.MustCompile(`^(?:feat|fix|chore)/([1-9][0-9]{0,9})-`)

var sha = regexp.MustCompile(`^[0-9a-f]{40}$`)

// The kinds of reported's rows.
const (
	rowTicket     = "ticket"
	rowMilestone  = "milestone"
	rowChange     = "change"
	rowUnreadable = "unreadable"
)

type rowKey struct{ kind, id string }

type reportedRow struct {
	digest string
	item   string
}

// entry is an item of the folder as it is now: its digest, and how to make
// its item when it must be sent sealed again.
type entry struct {
	key    rowKey
	digest string
	build  func() (any, error)
}

// Report sends the server, through send, what changed in the folder since
// the last report that went through (`local.changed`, SOURCE-3): a scan of
// `tickets/` and the changes of local.db, each item whose digest differs
// from the one last sent, every text sealed under the vault key, the whole
// set of unreadable files whenever anything changed. full sends every item,
// as last sent when unchanged (a row absent from it is gone). sent says
// whether a message went out; what a failed send carried goes again next
// time. Reports of a Projet never overlap.
func (p *Project) Report(ctx context.Context, full bool, send func(context.Context, contracts.RunnerLocalChanged) error) (bool, error) {
	p.reporting.Lock()
	defer p.reporting.Unlock()
	vault := p.vault()
	if vault == nil {
		return false, ErrNoVault
	}
	scan, err := p.Scan(ctx)
	if err != nil {
		return false, err
	}
	changes, err := p.Changes(ctx)
	if err != nil {
		return false, err
	}
	last, err := p.reported(ctx)
	if err != nil {
		return false, err
	}
	r := reporter{p: p, vault: vault, digestKey: vault.DeriveKey(reportDigestLabel)}

	var entries []entry
	for _, t := range scan.Tickets {
		entries = append(entries, r.ticket(t))
	}
	milestonesAt := r.mtime(filepath.Join(p.folder, TicketsDir, MilestonesFile))
	for _, m := range scan.Milestones {
		entries = append(entries, r.milestone(m, milestonesAt))
	}
	for _, c := range changes {
		entries = append(entries, r.change(c))
	}
	var unreadable []entry
	for _, u := range scan.Unreadable {
		unreadable = append(unreadable, r.unreadable(u))
	}

	// What goes out, and the rows written once it went.
	var items []contracts.LocalItem
	write := map[rowKey]reportedRow{}
	current := map[rowKey]bool{}
	for _, e := range entries {
		current[e.key] = true
		old, known := last[e.key]
		if known && old.digest == e.digest && !full {
			continue
		}
		item, raw, err := r.item(e, old, known)
		if err != nil {
			return false, err
		}
		items = append(items, item)
		write[e.key] = reportedRow{digest: e.digest, item: raw}
	}
	now := time.Now().UTC()
	var gone []rowKey
	for key := range last {
		if current[key] || key.kind == rowUnreadable {
			continue
		}
		gone = append(gone, key)
	}
	slices.SortFunc(gone, func(a, b rowKey) int { return compareRows(a, b) })
	for _, key := range gone {
		n, _ := strconv.Atoi(key.id)
		switch {
		case full || key.kind == rowChange:
		case key.kind == rowTicket:
			items = append(items, contracts.LocalItem{TicketRemoved: &contracts.LocalItemTicketRemoved{Kind: contracts.LocalItemKindTicketRemoved, Number: n, ObservedAt: now}})
		case key.kind == rowMilestone:
			items = append(items, contracts.LocalItem{MilestoneRemoved: &contracts.LocalItemMilestoneRemoved{Kind: contracts.LocalItemKindMilestoneRemoved, Rank: n}})
		}
	}

	set := make([]contracts.RunnerLocalChangedUnreadableElem, 0, len(unreadable))
	unreadableRows := map[rowKey]reportedRow{}
	unreadableChanged := false
	for _, e := range unreadable {
		old, known := last[e.key]
		if !known || old.digest != e.digest {
			unreadableChanged = true
		}
		var u contracts.RunnerLocalChangedUnreadableElem
		raw, err := r.reuse(e, old, known, &u)
		if err != nil {
			return false, err
		}
		set = append(set, u)
		unreadableRows[e.key] = reportedRow{digest: e.digest, item: raw}
	}
	for key := range last {
		if key.kind == rowUnreadable && unreadableRows[key].digest == "" {
			unreadableChanged = true
		}
	}

	if len(items) == 0 && !unreadableChanged && !full {
		return false, nil
	}
	if err := send(ctx, protocol.NewLocalChanged(p.id, vault.Version, full, items, set)); err != nil {
		return false, err
	}
	return true, p.remember(ctx, write, gone, unreadableRows)
}

func compareRows(a, b rowKey) int {
	if a.kind != b.kind {
		if a.kind < b.kind {
			return -1
		}
		return 1
	}
	x, _ := strconv.Atoi(a.id)
	y, _ := strconv.Atoi(b.id)
	return x - y
}

// reported are the rows of the Projet's last reports.
func (p *Project) reported(ctx context.Context) (map[rowKey]reportedRow, error) {
	rows, err := p.db.db.QueryContext(ctx, `SELECT kind, id, digest, item FROM reported WHERE project_id = ?`, p.id)
	if err != nil {
		return nil, fmt.Errorf("local: read what was reported: %w", err)
	}
	defer rows.Close()
	last := map[rowKey]reportedRow{}
	for rows.Next() {
		var key rowKey
		var row reportedRow
		if err := rows.Scan(&key.kind, &key.id, &row.digest, &row.item); err != nil {
			return nil, fmt.Errorf("local: read what was reported: %w", err)
		}
		last[key] = row
	}
	return last, rows.Err()
}

// remember writes what a report sent, forgets what is gone, and replaces the
// unreadable set, in one transaction.
func (p *Project) remember(ctx context.Context, write map[rowKey]reportedRow, gone []rowKey, unreadable map[rowKey]reportedRow) error {
	tx, err := p.db.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("local: keep what was reported: %w", err)
	}
	defer tx.Rollback()
	upsert := func(key rowKey, row reportedRow) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO reported (project_id, kind, id, digest, item) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (project_id, kind, id) DO UPDATE SET digest = excluded.digest, item = excluded.item`, p.id, key.kind, key.id, row.digest, row.item)
		return err
	}
	for key, row := range write {
		if err := upsert(key, row); err != nil {
			return fmt.Errorf("local: keep what was reported: %w", err)
		}
	}
	for _, key := range gone {
		if _, err := tx.ExecContext(ctx, `DELETE FROM reported WHERE project_id = ? AND kind = ? AND id = ?`, p.id, key.kind, key.id); err != nil {
			return fmt.Errorf("local: keep what was reported: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM reported WHERE project_id = ? AND kind = ?`, p.id, rowUnreadable); err != nil {
		return fmt.Errorf("local: keep what was reported: %w", err)
	}
	for key, row := range unreadable {
		if err := upsert(key, row); err != nil {
			return fmt.Errorf("local: keep what was reported: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("local: keep what was reported: %w", err)
	}
	return nil
}

type reporter struct {
	p         *Project
	vault     *keys.Vault
	digestKey []byte
}

// digest is the HMAC of a plaintext item, observedAt left out.
func (r reporter) digest(plain any) string {
	data, _ := json.Marshal(plain)
	mac := hmac.New(sha256.New, r.digestKey)
	mac.Write(data)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// seal seals text under `local:<projectId>:<place>`, base64url.
func (r reporter) seal(text, place string) (key, ciphertext string, err error) {
	item, err := r.vault.SealItem([]byte(text), []byte("local:"+r.p.id+":"+place))
	if err != nil {
		return "", "", fmt.Errorf("local: seal a text: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(item.Key), base64.RawURLEncoding.EncodeToString(item.Ciphertext), nil
}

func (r reporter) mtime(path string) time.Time {
	if info, err := os.Stat(path); err == nil {
		return info.ModTime().UTC()
	}
	return time.Now().UTC()
}

// item is the entry's item: the one last sent when its digest is the same,
// else sealed anew; and its row's JSON.
func (r reporter) item(e entry, old reportedRow, known bool) (contracts.LocalItem, string, error) {
	var item contracts.LocalItem
	raw, err := r.reuse(e, old, known, &item)
	return item, raw, err
}

// reuse decodes into what the row last sent, when the entry is unchanged,
// else builds it; and gives its JSON.
func (r reporter) reuse(e entry, old reportedRow, known bool, into any) (string, error) {
	if known && old.digest == e.digest && json.Unmarshal([]byte(old.item), into) == nil {
		return old.item, nil
	}
	built, err := e.build()
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(built)
	if err != nil {
		return "", fmt.Errorf("local: encode an item: %w", err)
	}
	if err := json.Unmarshal(data, into); err != nil {
		return "", fmt.Errorf("local: encode an item: %w", err)
	}
	return string(data), nil
}

func optional[T any](v *T) any {
	if v == nil {
		return nil
	}
	return *v
}

func (r reporter) ticket(t source.Ticket) entry {
	var readable, other []string
	for _, label := range t.Labels {
		if readableLabel.MatchString(label) {
			readable = append(readable, label)
		} else {
			other = append(other, label)
		}
	}
	prefix := contracts.LocalItemTicketBranchPrefixFeat
	switch {
	case slices.Contains(t.Labels, "type:fix"):
		prefix = contracts.LocalItemTicketBranchPrefixFix
	case slices.Contains(t.Labels, "type:chore"):
		prefix = contracts.LocalItemTicketBranchPrefixChore
	}
	var milestone any
	if t.Milestone != nil && t.Milestone.Number > 0 {
		milestone = t.Milestone.Number
	}
	var reason any
	if t.StateReason != source.ReasonNone {
		reason = string(t.StateReason)
	}
	hash := source.ContentHash(r.vault, t.Title, t.Body)
	item := contracts.LocalItemTicket{
		Kind: contracts.LocalItemKindTicket, Number: t.Number, State: contracts.LocalItemTicketState(t.State), StateReason: reason,
		ReadyMark: t.Ready, Labels: nonNil(readable), BranchPrefix: prefix, VisualReview: slices.Contains(t.Labels, "revue-visuelle"),
		MilestoneRank: milestone, BlockedBy: nonNil(t.BlockedBy), Parent: optional(t.Parent), ContentHash: hash,
		CreatedAt: t.CreatedAt.UTC(), UpdatedAt: t.UpdatedAt.UTC(), ClosedAt: utc(t.ClosedAt), ObservedAt: t.UpdatedAt.UTC(),
	}
	plain := item
	plain.ObservedAt = time.Time{}
	place := "ticket:" + strconv.Itoa(t.Number)
	return entry{
		key: rowKey{rowTicket, strconv.Itoa(t.Number)},
		digest: r.digest(struct {
			Item   contracts.LocalItemTicket
			Title  string
			Labels []string
		}{plain, t.Title, other}),
		build: func() (any, error) {
			key, ciphertext, err := r.seal(t.Title, place+":title")
			if err != nil {
				return nil, err
			}
			item.TitleSealed = contracts.LocalItemTicketTitleSealed{Key: key, Ciphertext: ciphertext}
			if len(other) > 0 {
				labels, _ := json.Marshal(other)
				key, ciphertext, err := r.seal(string(labels), place+":labels")
				if err != nil {
					return nil, err
				}
				item.LabelsSealed = &contracts.LocalItemTicketLabelsSealed{Key: key, Ciphertext: ciphertext}
			}
			return item, nil
		},
	}
}

func (r reporter) milestone(m source.Milestone, at time.Time) entry {
	var due *string
	if m.DueOn != nil {
		day := m.DueOn.UTC().Format(time.DateOnly)
		due = &day
	}
	item := contracts.LocalItemMilestone{Kind: contracts.LocalItemKindMilestone, Rank: m.Number, DueOn: due}
	return entry{
		key: rowKey{rowMilestone, strconv.Itoa(m.Number)},
		digest: r.digest(struct {
			Item  contracts.LocalItemMilestone
			Title string
		}{item, m.Title}),
		build: func() (any, error) {
			key, ciphertext, err := r.seal(m.Title, "milestone:"+strconv.Itoa(m.Number)+":title")
			if err != nil {
				return nil, err
			}
			item.TitleSealed = contracts.LocalItemMilestoneTitleSealed{Key: key, Ciphertext: ciphertext}
			item.ObservedAt = at
			return item, nil
		},
	}
}

func (r reporter) change(c source.Change) entry {
	state := contracts.LocalItemChangeState(c.State)
	if c.State == source.ChangeOpen && c.IsDraft {
		state = contracts.LocalItemChangeStateDraft
	}
	var ticket, head, merge any
	if m := deliveringBranch.FindStringSubmatch(c.HeadRef); m != nil {
		ticket, _ = strconv.Atoi(m[1])
	}
	if sha.MatchString(c.HeadOid) {
		head = c.HeadOid
	}
	if sha.MatchString(c.MergeCommitOid) {
		merge = c.MergeCommitOid
	}
	item := contracts.LocalItemChange{
		Kind: contracts.LocalItemKindChange, Number: c.Number, TicketNumber: ticket, State: state, BaseRef: c.BaseRef,
		HeadSha: head, MergeSha: merge, CreatedAt: c.CreatedAt.UTC(), UpdatedAt: c.UpdatedAt.UTC(),
		MergedAt: utc(c.MergedAt), ClosedAt: utc(c.ClosedAt),
	}
	return entry{
		key: rowKey{rowChange, strconv.Itoa(c.Number)},
		digest: r.digest(struct {
			Item  contracts.LocalItemChange
			Title string
		}{item, c.Title}),
		build: func() (any, error) {
			key, ciphertext, err := r.seal(c.Title, "change:"+strconv.Itoa(c.Number)+":title")
			if err != nil {
				return nil, err
			}
			item.TitleSealed = contracts.LocalItemChangeTitleSealed{Key: key, Ciphertext: ciphertext}
			item.ObservedAt = c.UpdatedAt.UTC()
			return item, nil
		},
	}
}

// unreadable keys a file by 16 bytes of an HMAC of its path, so that the
// server tells the files apart without their names.
func (r reporter) unreadable(u Unreadable) entry {
	mac := hmac.New(sha256.New, r.vault.DeriveKey(pathKeyLabel))
	mac.Write([]byte(u.Path))
	id := base64.RawURLEncoding.EncodeToString(mac.Sum(nil)[:16])
	return entry{
		key:    rowKey{rowUnreadable, id},
		digest: r.digest(struct{ Path, Reason string }{u.Path, string(u.Reason)}),
		build: func() (any, error) {
			key, ciphertext, err := r.seal(u.Path, "unreadable:"+id+":path")
			if err != nil {
				return nil, err
			}
			return contracts.RunnerLocalChangedUnreadableElem{
				Key: id, Reason: contracts.RunnerLocalChangedUnreadableElemReason(u.Reason),
				PathSealed: contracts.RunnerLocalChangedUnreadableElemPathSealed{Key: key, Ciphertext: ciphertext},
			}, nil
		},
	}
}

func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}
