package command

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"unicode/utf8"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
)

// opened is a Commande as the Runner opened it: the only text it runs, and
// the only place it runs it.
type opened struct {
	Run   string
	Where contracts.ProcessSealedCommandsValueWhere
}

// runMax is the longest text of a Commande (zProcessSealedPayload's `run`).
const runMax = 4000

var errSealed = errors.New("command: the sealed part does not open")

// openSealed opens the message's sealed part with the vault, under the
// additional data `process:<projectId>` of the message's own projectId (a
// version of another Projet does not open), checks it against
// zSealedCommands and gives its Commande `commandId`. Any failure is
// errSealed: nothing runs.
func openSealed(vault Vault, message contracts.RunnerCommandRun) (opened, error) {
	if vault == nil || !uuid.MatchString(message.ProjectId) {
		return opened{}, errSealed
	}
	key, err1 := base64.RawURLEncoding.Strict().DecodeString(message.Sealed.Key)
	ciphertext, err2 := base64.RawURLEncoding.Strict().DecodeString(message.Sealed.Ciphertext)
	if err1 != nil || err2 != nil {
		return opened{}, errSealed
	}
	plain, err := vault.OpenItem(keys.SealedItem{Key: key, Ciphertext: ciphertext}, []byte("process:"+message.ProjectId))
	if err != nil {
		return opened{}, errSealed
	}
	var sealed contracts.ProcessSealed
	if err := json.Unmarshal(plain, &sealed); err != nil {
		return opened{}, errSealed
	}
	command, ok := sealed.Commands[message.CommandId]
	where := command.Where
	if !ok || command.Run == "" || utf8.RuneCountInString(command.Run) > runMax || where != contracts.ProcessSealedCommandsValueWhereWorktree && where != contracts.ProcessSealedCommandsValueWhereProject {
		return opened{}, errSealed
	}
	return opened{Run: command.Run, Where: command.Where}, nil
}
