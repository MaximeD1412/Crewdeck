package main

import (
	"context"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mirror"
)

// refresher is what of the Miroir's follower brings a change up to date.
type refresher interface {
	Fetch(ctx context.Context, repository string, number int) error
	Sync(ctx context.Context, repository string, openOnly bool) ([]string, error)
}

// mirrorChanges reads, for an Étape's Contrat (RUNNER-12), the change of
// code of a Session's branch from the Miroir: fetched first, then its row.
type mirrorChanges struct {
	store  *mirror.Store
	follow refresher
}

// of is the change of code whose head is branch, in the code Source of the
// Projet; nil when there is none (the Contrat's `pr` rules fail).
func (c mirrorChanges) of(ctx context.Context, projectID, branch string) (*contrat.PullRequest, error) {
	projects, err := c.store.Projects()
	if err != nil {
		return nil, err
	}
	key := ""
	for _, p := range projects {
		if p.ProjectID == projectID && p.Has(mirror.GroupCode) {
			key = p.Repository
			break
		}
	}
	if key == "" {
		return nil, nil
	}
	number, err := c.find(key, branch)
	if err != nil {
		return nil, err
	}
	if number > 0 {
		err = c.follow.Fetch(ctx, key, number)
	} else if _, err = c.follow.Sync(ctx, key, true); err == nil {
		// One opened since the copy's last sync.
		number, err = c.find(key, branch)
	}
	if err != nil || number == 0 {
		return nil, err
	}
	o, err := c.store.Object(key, number)
	if err != nil || o.Pull == nil {
		return nil, err
	}
	return &contrat.PullRequest{Base: o.Pull.BaseRef, Head: o.Pull.HeadRef, Body: o.Body, Labels: o.Labels, HeadSHA: o.Pull.HeadOid}, nil
}

// find is the number of the newest change whose head is branch, 0 for none.
func (c mirrorChanges) find(key, branch string) (int, error) {
	found, err := c.store.List(key, mirror.Filter{Pulls: true, State: "all", Head: branch, Limit: 1})
	if err != nil || len(found) == 0 {
		return 0, err
	}
	number, _ := found[0]["number"].(int)
	return number, nil
}
