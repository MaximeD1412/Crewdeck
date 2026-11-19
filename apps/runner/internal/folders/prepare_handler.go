package folders

import (
	"context"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
)

// HandleStatus says where the Projet's folder stands (project.folder.state):
// all false when runner.json has no folder for it or it is not a folder anymore.
func (h *Handler) HandleStatus(ctx context.Context, message contracts.RunnerProjectFolderStatus) error {
	path, err := h.folderOf(message.ProjectId)
	if err != nil {
		return err
	}
	return h.sendState(ctx, message.ProjectId, path, message.ReleaseBranch, message.IntegrationBranch)
}

// HandlePrepare prepares the Projet's folder, answers the request
// (project.folder.prepared), then says where the folder stands. One
// preparation runs at a time.
func (h *Handler) HandlePrepare(ctx context.Context, message contracts.RunnerProjectFolderPrepare) error {
	h.preparing.Lock()
	defer h.preparing.Unlock()
	path, err := h.folderOf(message.ProjectId)
	if err != nil {
		return err
	}
	failure := contracts.RunnerProjectFolderPreparedErrorFolderMissing
	if path != "" {
		failure = Prepare(path, message.ReleaseBranch, message.IntegrationBranch)
	}
	h.cfg.Logger.Info("project.folder.prepare", "projectId", message.ProjectId, "requestId", message.RequestId, "error", string(failure))
	if err := h.cfg.Send(ctx, protocol.NewProjectFolderPrepared(message.RequestId, message.ProjectId, failure)); err != nil {
		return err
	}
	return h.sendState(ctx, message.ProjectId, path, message.ReleaseBranch, message.IntegrationBranch)
}

// handlePrepareAside prepares off the connection's reading: a preparation's
// git may outlast the server's silence.
func (h *Handler) handlePrepareAside(ctx context.Context, message contracts.RunnerProjectFolderPrepare) error {
	go func() {
		if err := h.HandlePrepare(ctx, message); err != nil && ctx.Err() == nil {
			h.cfg.Logger.Warn("project.folder.prepare", "projectId", message.ProjectId, "error", err)
		}
	}()
	return nil
}

// folderOf is the Projet's folder in runner.json, "" for none.
func (h *Handler) folderOf(projectID string) (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	projects, err := h.projects()
	if err != nil {
		return "", err
	}
	return projects[projectID], nil
}

// sendState sends the figures of the folder at path ("" for none).
func (h *Handler) sendState(ctx context.Context, projectID, path, release, integration string) error {
	ready := Readiness{}
	if path != "" {
		ready = Status(path, release, integration)
	}
	return h.cfg.Send(ctx, protocol.NewProjectFolderState(projectID, ready.Present, ready.IsGit, ready.HasCommits, ready.ReleaseBranch, ready.IntegrationBranch))
}
