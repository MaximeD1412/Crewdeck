package session

import "context"

// Worktree is a Session's worktree: its folder, its branch, and the clone it
// belongs to.
type Worktree struct {
	SessionID string
	ProjectID string
	Dir       string
	Branch    string
	Clone     string
}

// Hooks run around each worktree (RUNNER-20 fills them with the Projet's
// Commandes « Préparer le worktree » and « Nettoyer le worktree »); a nil
// hook runs nothing. Prepare runs once the worktree is made, before the
// Moteur starts: its error ends the Session in `setup-failed`. Clean runs
// when the Session ends, before the worktree is removed: its error is
// logged, and the worktree removed anyway. Nothing of the worktree itself
// runs (no `.process.json`, ADR 0011).
type Hooks struct {
	Prepare func(ctx context.Context, w Worktree) error
	Clean   func(ctx context.Context, w Worktree) error
}

func (h Hooks) prepare(ctx context.Context, w Worktree) error {
	if h.Prepare == nil {
		return nil
	}
	return h.Prepare(ctx, w)
}

func (h Hooks) clean(ctx context.Context, w Worktree) error {
	if h.Clean == nil {
		return nil
	}
	return h.Clean(ctx, w)
}
