package local

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// A change follows its branch in the folder (SOURCE-5, ADR 0012): a
// Session's push moves `refs/heads/<head_ref>` there, the change's head_oid
// follows it (SOURCE-3 reports the new headSha), and its mergeability with
// its base, as the Runner's clone just fetched them, is written (`git
// merge-tree`, the folder never touched). The branch deleted from the folder
// closes the change.

// Mergeability of a change (changes.mergeable, the Miroir's `mergeable`).
const (
	mergeableYes      = "MERGEABLE"
	mergeableConflict = "CONFLICTING"
)

// FollowChanges makes every open change follow its branch in the folder, on
// each scan of the Watcher. A folder git cannot read changes nothing.
func (p *Project) FollowChanges(ctx context.Context) error {
	branches, err := folderBranches(ctx, p.folder)
	if err != nil {
		return err
	}
	rows, err := p.db.db.QueryContext(ctx, `SELECT number, head_ref, head_oid, base_ref, COALESCE(mergeable, '') FROM changes
		WHERE project_id = ? AND state = 'open' ORDER BY number`, p.id)
	if err != nil {
		return fmt.Errorf("local: read the open changes: %w", err)
	}
	type open struct {
		number                         int
		headRef, head, base, mergeable string
	}
	var changes []open
	for rows.Next() {
		var c open
		if err := rows.Scan(&c.number, &c.headRef, &c.head, &c.base, &c.mergeable); err != nil {
			rows.Close()
			return fmt.Errorf("local: read the open changes: %w", err)
		}
		changes = append(changes, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("local: read the open changes: %w", err)
	}

	var changed []int
	for _, c := range changes {
		now := formatTime(time.Now())
		head, ok := branches[c.headRef]
		if !ok {
			if _, err := p.db.db.ExecContext(ctx, `UPDATE changes SET state = 'closed', closed_at = ?, updated_at = ? WHERE project_id = ? AND number = ? AND state = 'open'`,
				now, now, p.id, c.number); err != nil {
				return fmt.Errorf("local: close a change: %w", err)
			}
			changed = append(changed, c.number)
			continue
		}
		seen := head + " " + branches[c.base]
		p.mu.Lock()
		same := p.followed[c.number] == seen
		p.mu.Unlock()
		if head == c.head && c.mergeable != "" && same {
			continue
		}
		mergeable, err := p.mergeability(ctx, c.base, head)
		if err != nil {
			return err
		}
		if head == c.head && mergeable == c.mergeable {
			p.followedAt(c.number, seen)
			continue
		}
		if _, err := p.db.db.ExecContext(ctx, `UPDATE changes SET head_oid = ?, mergeable = ?, updated_at = ? WHERE project_id = ? AND number = ? AND state = 'open'`,
			head, nullable(mergeable), now, p.id, c.number); err != nil {
			return fmt.Errorf("local: write a change's head: %w", err)
		}
		p.followedAt(c.number, seen)
		changed = append(changed, c.number)
	}
	if len(changed) > 0 {
		p.notifyChanges(changed...)
	}
	return nil
}

// followedAt keeps the heads a change's mergeability was computed at.
func (p *Project) followedAt(number int, seen string) {
	p.mu.Lock()
	if p.followed == nil {
		p.followed = map[int]string{}
	}
	p.followed[number] = seen
	p.mu.Unlock()
}

// mergeability says whether head merges on base, both as the clone just
// fetched them from the folder: "" when the Projet has no clone yet or git
// cannot say.
func (p *Project) mergeability(ctx context.Context, base, head string) (string, error) {
	p.mu.Lock()
	clone := p.clone
	p.mu.Unlock()
	if clone == "" {
		return "", nil
	}
	p.gitMu.Lock()
	defer p.gitMu.Unlock()
	if err := cloneOrFetch(ctx, p.folder, clone); err != nil {
		return "", err
	}
	onto, ok := originBranch(ctx, clone, base)
	if !ok {
		return "", nil
	}
	err := gitCommand(ctx, clone, "merge-tree", "--write-tree", "--quiet", onto, head).Run()
	var exit *exec.ExitError
	switch {
	case err == nil:
		return mergeableYes, nil
	case errors.As(err, &exit) && exit.ExitCode() == 1:
		return mergeableConflict, nil
	default:
		return "", nil
	}
}

// folderBranches are the folder's own branches and their commits.
func folderBranches(ctx context.Context, folder string) (map[string]string, error) {
	out, err := gitOutput(ctx, folder, "for-each-ref", "--format=%(objectname) %(refname:lstrip=2)", "refs/heads/")
	if err != nil {
		return nil, err
	}
	branches := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		if oid, name, ok := strings.Cut(line, " "); ok {
			branches[name] = oid
		}
	}
	return branches, nil
}
