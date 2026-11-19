package contracts

import (
	"encoding/json"
	"testing"
)

// The fixture of a Local Projet's report (SOURCE-3) decodes into its Go
// types, each item into its option of LocalItem, as the server reads it.
func TestLocalChangedDecodesTheSharedFixture(t *testing.T) {
	var message RunnerLocalChanged
	if err := json.Unmarshal(readRunnerFixture(t, "local.changed.json"), &message); err != nil {
		t.Fatalf("decode local.changed: %v", err)
	}
	if message.Type != "local.changed" || message.Full || len(message.Items) != 5 || len(message.Unreadable) != 1 {
		t.Fatalf("local.changed %+v", message)
	}
	kinds := map[string]bool{}
	for _, item := range message.Items {
		kinds[item.Kind()] = true
	}
	for _, kind := range []string{LocalItemKindTicket, LocalItemKindTicketRemoved, LocalItemKindMilestone, LocalItemKindMilestoneRemoved, LocalItemKindChange} {
		if !kinds[kind] {
			t.Errorf("no %s item decoded: %v", kind, kinds)
		}
	}
	ticket := message.Items[0].Ticket
	if ticket == nil || ticket.Number != 12 || ticket.BranchPrefix != "fix" || !ticket.VisualReview || ticket.LabelsSealed == nil || ticket.TitleSealed.Key == "" {
		t.Fatalf("ticket %+v", ticket)
	}
	if message.Unreadable[0].Reason != "front-matter" || message.Unreadable[0].PathSealed.Ciphertext == "" {
		t.Fatalf("unreadable %+v", message.Unreadable[0])
	}
	again, err := json.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	var back RunnerLocalChanged
	if err := json.Unmarshal(again, &back); err != nil || len(back.Items) != 5 {
		t.Fatalf("encode then decode: %v", err)
	}
}

// A ticket item without its sealed title is not one.
func TestLocalTicketItemRequiresItsSealedTitle(t *testing.T) {
	var item LocalItem
	data := []byte(`{"kind":"ticket","number":12,"state":"open","stateReason":null,"readyMark":false,"labels":[],"labelsSealed":null,"branchPrefix":"feat","visualReview":false,"milestoneRank":null,"blockedBy":[],"parent":null,"contentHash":"v1.Z0kq3eL1yP9cX2mVb7nQ4rT8sW5uA6dF0hJ3kL9pO1M","createdAt":"2026-11-18T14:02:00.000Z","updatedAt":"2026-11-19T09:00:00.000Z","closedAt":null,"observedAt":"2026-11-19T09:00:00.000Z"}`)
	if err := json.Unmarshal(data, &item); err == nil {
		t.Fatal("decoded a ticket without titleSealed")
	}
}
