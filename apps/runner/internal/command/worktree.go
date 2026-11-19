package command

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
)

// The bounds of the Projet's worktree Commandes, `agent-loop`'s own: a stuck
// install fails the Étape instead of holding the Ticket (RUNNER-20).
var (
	prepareBound = 15 * time.Minute
	cleanBound   = 10 * time.Minute
)

// tailLines is how many of a failed preparation's last lines its message
// carries.
const tailLines = 50

// worktreeMax is the longest text of a worktree Commande (zWorktreeCommands),
// in UTF-16 code units.
const worktreeMax = 4000

// ItemKeys opens an item's own key with the vault held (keys.Vault.ItemKey).
type ItemKeys interface {
	ItemKey(item keys.SealedItem, aad []byte) ([]byte, error)
}

// WorktreeHooks are the Projet's Commandes « Préparer le worktree » and
// « Nettoyer le worktree » (RUNNER-20, ADR 0013), run around every worktree
// the Runner makes for a Session or a `where: worktree` run: opened with the
// vault under the additional data `settings:<projectId>` of the worktree's
// own Projet, run in the worktree as a Commande runs (`$SHELL -lc`, the
// CREWDECK_* variables, its own process group), 15 and 10 min at most. A
// part that does not open runs nothing: the preparation fails, the cleaning
// is skipped.
func WorktreeHooks(vault ItemKeys) session.Hooks {
	return session.Hooks{
		Keep: func(projectID string, sealed session.SealedCommands) session.SealedCommands {
			return keepWorktreeCommands(vault, projectID, sealed)
		},
		Prepare: func(ctx context.Context, w session.Worktree) error {
			if w.Commands == nil {
				return nil
			}
			commands, ok := openWorktreeCommands(vault, w.ProjectID, *w.Commands)
			if !ok {
				return &session.SetupError{Summary: "Préparer le worktree a échoué (les Commandes du worktree ne s’ouvrent pas pour ce Projet)"}
			}
			if commands.prepare == "" {
				return nil
			}
			ended, err := runWorktreeCommand(ctx, w, commands.prepare, prepareBound)
			if err != nil {
				return err
			}
			switch {
			case ended.timedOut:
				return &session.SetupError{Summary: fmt.Sprintf("Préparer le worktree a échoué (délai de %s dépassé)", minutes(prepareBound)), Tail: ended.tail}
			case ended.code == nil:
				return &session.SetupError{Summary: "Préparer le worktree a échoué (interrompu par un signal)", Tail: ended.tail}
			case *ended.code != 0:
				return &session.SetupError{Summary: fmt.Sprintf("Préparer le worktree a échoué (code %d)", *ended.code), Tail: ended.tail}
			}
			return nil
		},
		Clean: func(ctx context.Context, w session.Worktree) error {
			if w.Commands == nil {
				return nil
			}
			commands, ok := openWorktreeCommands(vault, w.ProjectID, *w.Commands)
			if !ok {
				return &session.CleanError{Reason: "sealed-invalid"}
			}
			if commands.clean == "" {
				return nil
			}
			ended, err := runWorktreeCommand(ctx, w, commands.clean, cleanBound)
			if err != nil {
				return err
			}
			switch {
			case ended.timedOut:
				return &session.CleanError{Reason: "timeout"}
			case ended.code == nil:
				return &session.CleanError{Reason: "signal"}
			case *ended.code != 0:
				return &session.CleanError{ExitCode: ended.code, Reason: "exited"}
			}
			return nil
		},
	}
}

func minutes(d time.Duration) string {
	return fmt.Sprintf("%d min", int(d.Minutes()))
}

// keepWorktreeCommands is sealed with its item key opened in place of the
// vault's wrap of it, once that key opens sealed's ciphertext; sealed as it
// is otherwise, already kept or not for this Projet's vault.
func keepWorktreeCommands(vault ItemKeys, projectID string, sealed session.SealedCommands) session.SealedCommands {
	if sealed.ItemKey != "" || vault == nil || !uuid.MatchString(projectID) {
		return sealed
	}
	wrapped, err1 := base64.RawURLEncoding.Strict().DecodeString(sealed.Key)
	ciphertext, err2 := base64.RawURLEncoding.Strict().DecodeString(sealed.Ciphertext)
	if err1 != nil || err2 != nil {
		return sealed
	}
	aad := []byte("settings:" + projectID)
	itemKey, err := vault.ItemKey(keys.SealedItem{Key: wrapped}, aad)
	if err != nil {
		return sealed
	}
	if _, err := keys.OpenItemContent(itemKey, ciphertext, aad); err != nil {
		return sealed
	}
	return session.SealedCommands{Ciphertext: sealed.Ciphertext, ItemKey: base64.RawURLEncoding.EncodeToString(itemKey)}
}

// worktreeCommands are the opened zWorktreeCommands; "" is a Commande the
// Pilote did not set.
type worktreeCommands struct{ prepare, clean string }

// openWorktreeCommands opens sealed under `settings:<projectID>`, with its
// item key kept or the vault's wrap of it, and checks
// the whole of it against zWorktreeCommands: an object of `prepare` and
// `clean`, both given, each null or a text of 1 to 4000, nothing else.
func openWorktreeCommands(vault ItemKeys, projectID string, sealed session.SealedCommands) (worktreeCommands, bool) {
	if vault == nil || !uuid.MatchString(projectID) {
		return worktreeCommands{}, false
	}
	ciphertext, err := base64.RawURLEncoding.Strict().DecodeString(sealed.Ciphertext)
	if err != nil {
		return worktreeCommands{}, false
	}
	aad := []byte("settings:" + projectID)
	var itemKey []byte
	if sealed.ItemKey != "" {
		itemKey, err = base64.RawURLEncoding.Strict().DecodeString(sealed.ItemKey)
	} else {
		var wrapped []byte
		if wrapped, err = base64.RawURLEncoding.Strict().DecodeString(sealed.Key); err == nil {
			itemKey, err = vault.ItemKey(keys.SealedItem{Key: wrapped}, aad)
		}
	}
	if err != nil {
		return worktreeCommands{}, false
	}
	plain, err := keys.OpenItemContent(itemKey, ciphertext, aad)
	if err != nil {
		return worktreeCommands{}, false
	}
	fields, ok := object(plain, "prepare", "clean")
	if !ok {
		return worktreeCommands{}, false
	}
	texts := [2]string{}
	for i, name := range []string{"prepare", "clean"} {
		raw, given := fields[name]
		if !given {
			return worktreeCommands{}, false
		}
		if strings.TrimSpace(string(raw)) == "null" {
			continue
		}
		text, ok := jsonString(raw)
		if !ok || text == "" || utf16Len(text) > worktreeMax {
			return worktreeCommands{}, false
		}
		texts[i] = text
	}
	return worktreeCommands{prepare: texts[0], clean: texts[1]}, true
}

// ended is how a worktree Commande ended: its exit code (nil when a signal
// ended it), whether its bound did, the last tailLines of its output.
type ended struct {
	code     *int
	timedOut bool
	tail     string
}

// runWorktreeCommand runs text in the worktree, its output to the
// worktree's writers, until it exits, bound passes or ctx ends; its group
// is then killed. ctx ending is ctx's error.
func runWorktreeCommand(ctx context.Context, w session.Worktree, text string, bound time.Duration) (ended, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	tail := &tailBuffer{}
	cmd := exec.Command(shell, "-lc", text)
	cmd.Dir = w.Dir
	cmd.Env = append(os.Environ(), w.Env...)
	cmd.Stdout = io.MultiWriter(orDiscard(w.Stdout), tail)
	cmd.Stderr = io.MultiWriter(orDiscard(w.Stderr), tail)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.WaitDelay = waitDelay
	if err := cmd.Start(); err != nil {
		return ended{}, err
	}
	proc := lead(cmd)
	timer := time.NewTimer(bound)
	defer timer.Stop()
	select {
	case <-proc.left:
		proc.reap()
		return ended{code: proc.code, tail: tail.lines(tailLines)}, nil
	case <-timer.C:
		killGroup(proc, time.After)
		return ended{timedOut: true, tail: tail.lines(tailLines)}, nil
	case <-ctx.Done():
		killGroup(proc, time.After)
		return ended{}, ctx.Err()
	}
}

func orDiscard(w io.Writer) io.Writer {
	if w == nil {
		return io.Discard
	}
	return w
}

// tailBuffer keeps the end of an output, both streams, enough of it for
// its last lines.
type tailBuffer struct {
	mu  sync.Mutex
	buf []byte
}

const tailKeep = 64 << 10

func (t *tailBuffer) Write(b []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, b...)
	if len(t.buf) > 2*tailKeep {
		t.buf = append([]byte(nil), t.buf[len(t.buf)-tailKeep:]...)
	}
	return len(b), nil
}

// lines is its last n lines, valid UTF-8.
func (t *tailBuffer) lines(n int) string {
	t.mu.Lock()
	text := strings.ToValidUTF8(string(t.buf), "�")
	t.mu.Unlock()
	all := strings.Split(strings.TrimRight(text, "\r\n"), "\n")
	if len(all) > n {
		all = all[len(all)-n:]
	}
	return strings.Join(all, "\n")
}
