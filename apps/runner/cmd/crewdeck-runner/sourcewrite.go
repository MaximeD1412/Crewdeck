package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mirror"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
)

// sourceWrites is the running Runner's op source.write (MIROIR-7, ADR
// 0012): a Session's write to its Local Projet, which the Runner alone
// writes (the folder's Ticket files, local.db). OnChange reports it
// (SOURCE-3); the copy is refreshed before the reply, so the agent that
// wrote reads its write.
type sourceWrites struct {
	// running is the Projet and Rôle of a Session running now.
	running func(sessionID string) (projectID, role string, ok bool)
	// target is the Local Projet's writer, its clone set.
	target func(projectID string) (source.Target, bool)
	// fetch refreshes one object of the copy.
	fetch  func(ctx context.Context, key string, number int) error
	logger *slog.Logger
}

// replyReserve is the time a write keeps to answer before runner.sock's
// deadline, whatever its refresh takes.
const replyReserve = time.Second

// writeCode is a refusal of a write, its code the client says in French.
type writeCode string

func (c writeCode) Error() string { return "source.write: " + string(c) }
func (c writeCode) Code() string  { return string(c) }

func (w sourceWrites) Register(sock *localsock.Server) {
	sock.Handle(source.OpWrite, func(ctx context.Context, raw json.RawMessage) (any, error) {
		var r source.WriteRequest
		if err := json.Unmarshal(raw, &r); err != nil || r.SessionID == "" || r.Op == "" {
			return nil, writeCode("bad-request")
		}
		projectID, role, ok := w.running(r.SessionID)
		if !ok {
			return nil, writeCode("not-in-session")
		}
		if !mirror.IsLocal(r.Key) {
			return nil, writeCode("not-local")
		}
		if strings.TrimPrefix(r.Key, mirror.LocalPrefix) != projectID {
			return nil, writeCode("other-project")
		}
		target, ok := w.target(projectID)
		if !ok {
			return nil, writeCode("no-folder")
		}
		if role == "" {
			role = "agent"
		}
		written, err := source.Apply(ctx, target, r.Op, r.Number, r.Fields, role, r.SessionID)
		if code := refusalCode(err); code != "" {
			return nil, writeCode(code)
		}
		if err != nil {
			if w.logger != nil {
				w.logger.Warn("source.write", "op", string(r.Op), "error", err)
			}
			return nil, writeCode("failed")
		}
		// The write is done: a failed refresh leaves it so, silent.
		w.refresh(ctx, r.Key, written.Number)
		return written, nil
	})
}

// refresh refreshes the object written, waiting for it until replyReserve
// before runner.sock's deadline at most: a refresh that does not heed its
// context (the copy's one connection held) goes on alone, and the write
// still answers.
func (w sourceWrites) refresh(ctx context.Context, key string, number int) {
	budget := localsock.Timeout
	if deadline, ok := ctx.Deadline(); ok {
		budget = time.Until(deadline)
	}
	if budget -= replyReserve; budget <= 0 {
		return
	}
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), budget)
	done := make(chan struct{})
	go func() {
		defer cancel()
		defer close(done)
		_ = w.fetch(fetchCtx, key, number)
	}()
	select {
	case <-done:
	case <-fetchCtx.Done():
	}
}

// refusalCode is the code of what a Source refuses, "" for anything else.
func refusalCode(err error) string {
	var missing *source.BranchMissingError
	var open *source.ChangeOpenError
	switch {
	case err == nil:
		return ""
	case errors.As(err, &missing):
		return "branch-missing"
	case errors.As(err, &open):
		return "change-open:" + strconv.Itoa(open.Number) + ":" + open.Branch
	case errors.Is(err, source.ErrNotFound):
		return "not-found"
	case errors.Is(err, source.ErrUnknownMilestone):
		return "unknown-milestone"
	case errors.Is(err, source.ErrNoAssignees):
		return "no-assignees"
	case errors.Is(err, source.ErrNoChangeMilestone):
		return "no-change-milestone"
	case errors.Is(err, source.ErrMerged):
		return "merged"
	case errors.Is(err, local.ErrUnwritable):
		return "unwritable"
	case errors.Is(err, local.ErrNoTitle):
		return "no-title"
	case errors.Is(err, local.ErrInvalidState):
		return "invalid-state"
	}
	return ""
}

// writeRefusal says in French why a write was refused: code is a
// refusalCode or source.write's own; where names the Projet.
func writeRefusal(code string, number int, branch, milestone, where string, local bool) string {
	if rest, ok := strings.CutPrefix(code, "change-open:"); ok {
		// change-open:<n>:<branch>, a branch having no ":".
		n, open, found := strings.Cut(rest, ":")
		if found {
			branch = open
		}
		return fmt.Sprintf("Un changement est déjà ouvert pour %s : #%s.", branch, n)
	}
	switch code {
	case "branch-missing":
		return fmt.Sprintf("La branche %s n'est pas dans le dossier : git push d'abord.", branch)
	case "not-found":
		return fmt.Sprintf("#%d n'existe pas dans %s.", number, where)
	case "unknown-milestone":
		if local {
			return fmt.Sprintf("Le jalon %s n'existe pas dans tickets/milestones.yml.", milestone)
		}
		return fmt.Sprintf("Le jalon %s n'existe pas dans %s.", milestone, where)
	case "no-assignees":
		return "Pas d'assignation sur un Projet Local."
	case "no-change-milestone":
		return "Pas de jalon sur un changement Local."
	case "merged":
		return fmt.Sprintf("#%d est déjà mergé.", number)
	case "unwritable":
		return fmt.Sprintf("Le fichier du Ticket #%d ne se lirait plus après cette écriture : rien n'est écrit.", number)
	case "no-title":
		return "Le titre ne peut pas être vide."
	case "invalid-state":
		return "Cet état n'existe pas."
	case "not-in-session":
		return notInSession
	case "other-project":
		return "Cette Session n'écrit que dans son Projet."
	case "not-local", "no-folder":
		return fmt.Sprintf("Le dossier de %s n'est pas sur ce Runner.", where)
	case localsock.CodeTimeout:
		return "Le Runner n'a pas répondu à temps : l'écriture a pu se faire, relis avant de réessayer."
	}
	return "Le Runner n'a pas fait l'écriture."
}

// notInSession is the line of a write outside a Session.
const notInSession = "Les écritures du Miroir se font depuis une Session."
