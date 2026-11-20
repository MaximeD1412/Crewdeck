package protocol

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// The types of the messages of packages/contracts/src/runner/.
const (
	TypeHello         = "hello"
	TypeHelloAccepted = "hello.accepted"
	TypeHelloRejected = "hello.rejected"
	TypeHeartbeat     = "heartbeat"
	TypeHeartbeatAck  = "heartbeat.ack"
	TypeError         = "error"
	TypeStepVerdict   = "step.verdict"
	TypeStepStarted   = "step.started"
	TypeStepReport    = "step.report"
	TypeCapabilities  = "capabilities"
	TypeMcpServers    = "mcp.servers"
	TypeUsage         = "usage"
	TypeUsageAck      = "usage.ack"
	// The Miroir's (ADR 0010): the server sends them, the Runner applies them (MIROIR-4).
	TypeGitHubChanged  = "github.changed"
	TypeMirrorResync   = "mirror.resync"
	TypeMirrorLive     = "mirror.live"
	TypeMirrorProjects = "mirror.projects"
	// The « Miroir » token (ADR 0010): the Runner asks it, the server answers (MIROIR-2, MIROIR-4).
	TypeMirrorToken       = "mirror.token"
	TypeMirrorTokenIssued = "mirror.token.issued"
	TypeMirrorTokenFailed = "mirror.token.failed"
	// The Sessions (RUNNER-9): the server starts, stops and resumes them, the Runner reports their states.
	TypeSessionStart  = "session.start"
	TypeSessionStop   = "session.stop"
	TypeSessionResume = "session.resume"
	TypeSessionState  = "session.state"
	// The requests of a Session (SESSION-3): one waits for the Pilote, then it
	// was answered.
	TypeSessionWaiting  = "session.waiting"
	TypeSessionAnswered = "session.answered"
	// The relay of a Session (SESSION-1): the server asks a replay and hands
	// the Pilote's input, the Runner sends the Session's key and its events,
	// all sealed for the Appareils.
	TypeSessionReplay = "session.replay"
	TypeSessionInput  = "session.input"
	TypeSessionKeys   = "session.keys"
	TypeRelay         = "relay"
	// A Local Projet's folder (PROJET-6, ADR 0012): the server relays a tab's
	// check and asks to attach a folder, both sealed under the vault key; the
	// Runner answers the check sealed and says which Projets' folders exist.
	TypeFolderCheck         = "folder.check"
	TypeFolderChecked       = "folder.checked"
	TypeProjectFolderAttach = "project.folder.attach"
	TypeProjectsFolders     = "projects.folders"

	// The Commandes (RUNNER-18): the server asks a run, its stop and the
	// replay of its output; the Runner says it started, its verdict, and
	// sends its key and its output sealed for the Appareils.
	TypeCommandRun     = "command.run"
	TypeCommandStop    = "command.stop"
	TypeCommandReplay  = "command.replay"
	TypeCommandStarted = "command.started"
	TypeCommandVerdict = "command.verdict"
	TypeCommandKeys    = "command.keys"
	TypeCommandOutput  = "command.output"
	// The vault key's rotation (E2E-4): the server says one waits, and hands
	// the Runner its wrap of the new version once a holder rotated.
	TypeVaultRotationPending = "vault.rotation-pending"
	TypeVaultRotated         = "vault.rotated"
	// A migration of Source (SOURCE-7, ADR 0012): the server asks the copy
	// of a group and its finish, the Runner reports its progress, the switch
	// it is ready for, and how it ended. The Runner's side is SOURCE-8.
	TypeMigrationCopy     = "migration.copy"
	TypeMigrationFinish   = "migration.finish"
	TypeMigrationProgress = "migration.progress"
	TypeMigrationSwitch   = "migration.switch"
	TypeMigrationFinished = "migration.finished"
	TypeMigrationFailed   = "migration.failed"
	// A Local Projet's folder (SOURCE-3, ADR 0012): what changed in it, its
	// texts sealed under the vault key.
	TypeLocalChanged = "local.changed"
	// A local change of code merged (SOURCE-5, ADR 0012): the server asks
	// the merge at the SHA every Verdict judged, the Runner says how each
	// attempt ended.
	TypeMergeLocal       = "merge.local"
	TypeMergeLocalResult = "merge.local.result"
	// Reading content in the page (SOURCE-4, ADR 0012): the server asks an
	// artefact for a tab, the Runner answers it sealed for the Appareil the
	// tab named, or says why not.
	TypeArtifactRead    = "artifact.read"
	TypeArtifactContent = "artifact.content"
	TypeArtifactError   = "artifact.error"
)

// Machine is what the Runner says of itself in its hello.
type Machine struct {
	RunnerVersion string
	Machine       string
	OS            contracts.RunnerHelloOs
	Arch          contracts.RunnerHelloArch
	WSL           bool
	// Migrations are the groups of Source this Runner migrates (SOURCE-8).
	Migrations []contracts.RunnerHelloMigrationsElem
}

func now() time.Time {
	return time.Now().UTC().Truncate(time.Millisecond)
}

// NewHello is the hello of `machine`, at the Runner's protocol, with the
// Miroir's cursor mirrorAfter (null for none: the server resyncs the copy).
func NewHello(machine Machine, mirrorAfter *int64) contracts.RunnerHello {
	at := now()
	return contracts.RunnerHello{
		// A nil *int64 in the interface is written null, never left out.
		MirrorAfter:     mirrorAfter,
		Type:            TypeHello,
		Id:              newID(at),
		At:              at,
		ProtocolVersion: contracts.ProtocolVersion,
		RunnerVersion:   machine.RunnerVersion,
		Machine:         machine.Machine,
		Os:              machine.OS,
		Arch:            machine.Arch,
		Wsl:             machine.WSL,
		Migrations:      machine.Migrations,
	}
}

// NewHeartbeat is a heartbeat, sent every contracts.HeartbeatSeconds.
func NewHeartbeat() contracts.RunnerHeartbeat {
	at := now()
	return contracts.RunnerHeartbeat{Type: TypeHeartbeat, Id: newID(at), At: at}
}

// typeOf reads the type of a message, validating its envelope.
func typeOf(data []byte) (string, error) {
	var envelope contracts.RunnerEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return "", fmt.Errorf("protocol: not a message of the protocol: %w", err)
	}
	return envelope.Type, nil
}

// NewCapabilities is the capabilities message of `engines`: what each Moteur
// can run, never a credential.
func NewCapabilities(engines []contracts.EngineCapabilities) contracts.RunnerCapabilities {
	at := now()
	if engines == nil {
		engines = []contracts.EngineCapabilities{}
	}
	return contracts.RunnerCapabilities{Type: TypeCapabilities, Id: newID(at), At: at, Engines: engines}
}

// NewMcpServers is the `mcp.servers` of the Serveurs MCP declared on the Runner: their names, transports, states and tool counts only.
func NewMcpServers(servers []contracts.RunnerMcpServersServersElem) contracts.RunnerMcpServers {
	at := now()
	if servers == nil {
		servers = []contracts.RunnerMcpServersServersElem{}
	}
	return contracts.RunnerMcpServers{Type: TypeMcpServers, Id: newID(at), At: at, Servers: servers}
}

// NewUsage is the usage message of one Compte IA (US-55): the windows the
// Moteur last reported, measured at `measuredAt`, and the cost of a Session's
// result when `spend` is set. Figures only, never content.
func NewUsage(engine contracts.RunnerUsageEngine, kind contracts.RunnerUsageAccountKind, windows []contracts.RunnerUsageWindowsElem, spend *contracts.RunnerUsageSpend, measuredAt time.Time) contracts.RunnerUsage {
	at := now()
	if windows == nil {
		windows = []contracts.RunnerUsageWindowsElem{}
	}
	return contracts.RunnerUsage{
		Type:        TypeUsage,
		Id:          newID(at),
		At:          at,
		Engine:      engine,
		AccountKind: kind,
		Windows:     windows,
		Spend:       spend,
		MeasuredAt:  measuredAt.UTC().Truncate(time.Millisecond),
	}
}

// NewMirrorToken asks the server for the « Miroir » tokens (MIROIR-2).
func NewMirrorToken() contracts.RunnerMirrorToken {
	at := now()
	return contracts.RunnerMirrorToken{Type: TypeMirrorToken, Id: newID(at), At: at}
}

// NewSessionState reports the Session's state; outcome, failure and
// engineSessionID are left out when empty.
func NewSessionState(sessionID string, state contracts.RunnerSessionStateState, outcome contracts.RunnerSessionStateOutcome, failure contracts.RunnerSessionStateError, engineSessionID string) contracts.RunnerSessionState {
	at := now()
	message := contracts.RunnerSessionState{Type: TypeSessionState, Id: newID(at), At: at, SessionId: sessionID, State: state}
	if outcome != "" {
		message.Outcome = &outcome
	}
	if failure != "" {
		message.Error = &failure
	}
	if engineSessionID != "" {
		message.EngineSessionId = &engineSessionID
	}
	return message
}

// NewSessionWaiting says a request of the Session waits for the Pilote: its
// id, its kind and the seq of its event in the Session's log, never its text.
func NewSessionWaiting(sessionID, requestID string, kind contracts.RunnerSessionWaitingKind, seq int) contracts.RunnerSessionWaiting {
	at := now()
	return contracts.RunnerSessionWaiting{Type: TypeSessionWaiting, Id: newID(at), At: at, SessionId: sessionID, RequestId: requestID, Kind: kind, Seq: seq}
}

// NewSessionAnswered says the request was answered, from whatever tab.
func NewSessionAnswered(sessionID, requestID string) contracts.RunnerSessionAnswered {
	at := now()
	return contracts.RunnerSessionAnswered{Type: TypeSessionAnswered, Id: newID(at), At: at, SessionId: sessionID, RequestId: requestID}
}

// NewSessionKeys sends the Session's key wrapped for each holder, to the tab
// tabID of a replay, or to every tab of the Session when tabID is empty.
func NewSessionKeys(sessionID, tabID string, wraps []contracts.RunnerSessionKeysWrapsElem) contracts.RunnerSessionKeys {
	at := now()
	message := contracts.RunnerSessionKeys{Type: TypeSessionKeys, Id: newID(at), At: at, SessionId: sessionID, Wraps: wraps}
	if tabID != "" {
		message.TabId = &tabID
	}
	return message
}

// NewRelay sends one sealed event of the Session, to the tab tabID of a
// replay, or live to every tab of the Session when tabID is empty.
func NewRelay(sessionID, tabID string, seq int, nonce, ciphertext string) contracts.RunnerRelay {
	at := now()
	message := contracts.RunnerRelay{Type: TypeRelay, Id: newID(at), At: at, SessionId: sessionID, Seq: seq, Nonce: nonce, Ciphertext: ciphertext}
	if tabID != "" {
		message.TabId = &tabID
	}
	return message
}

// NewFolderChecked answers the tab tabID's folder.check requestID with its
// result sealed under the vault key (key and ciphertext base64url).
func NewFolderChecked(requestID, tabID, key, ciphertext string) contracts.RunnerFolderChecked {
	at := now()
	return contracts.RunnerFolderChecked{
		Type: TypeFolderChecked, Id: newID(at), At: at, RequestId: requestID, TabId: tabID,
		Sealed: contracts.RunnerFolderCheckedSealed{Key: key, Ciphertext: ciphertext},
	}
}

// NewProjectsFolders says the Projets whose folder exists on this machine.
func NewProjectsFolders(present []string) contracts.RunnerProjectsFolders {
	at := now()
	if present == nil {
		present = []string{}
	}
	return contracts.RunnerProjectsFolders{Type: TypeProjectsFolders, Id: newID(at), At: at, Present: present}
}

// NewLocalChanged reports what changed in a Local Projet's folder, every
// item when full (once per connection), its texts sealed under the vault
// key's vaultKeyVersion.
func NewLocalChanged(projectID string, vaultKeyVersion int, full bool, items []contracts.LocalItem, unreadable []contracts.RunnerLocalChangedUnreadableElem) contracts.RunnerLocalChanged {
	at := now()
	if items == nil {
		items = []contracts.LocalItem{}
	}
	if unreadable == nil {
		unreadable = []contracts.RunnerLocalChangedUnreadableElem{}
	}
	return contracts.RunnerLocalChanged{Type: TypeLocalChanged, Id: newID(at), At: at, ProjectId: projectID, VaultKeyVersion: vaultKeyVersion, Full: full, Items: items, Unreadable: unreadable}
}

// NewMergeLocalResult says how an attempt at the merge of a local change
// ended, mergeSha the squash commit when merged ("" otherwise).
func NewMergeLocalResult(projectID string, number int, sha string, outcome contracts.RunnerMergeLocalResultOutcome, mergeSha string) contracts.RunnerMergeLocalResult {
	at := now()
	m := contracts.RunnerMergeLocalResult{Type: TypeMergeLocalResult, Id: newID(at), At: at, ProjectId: projectID, ChangeNumber: number, Sha: sha, Outcome: outcome}
	if mergeSha != "" {
		m.MergeSha = &mergeSha
	}
	return m
}

// NewCommandStarted says the run's process started.
func NewCommandStarted(runID string) contracts.RunnerCommandStarted {
	at := now()
	return contracts.RunnerCommandStarted{Type: TypeCommandStarted, Id: newID(at), At: at, RunId: runID}
}

// NewCommandVerdict is the run's verdict, figures only: exitCode nil unless
// its process exited.
func NewCommandVerdict(runID string, reason contracts.RunnerCommandVerdictReason, exitCode *int, duration time.Duration) contracts.RunnerCommandVerdict {
	at := now()
	message := contracts.RunnerCommandVerdict{Type: TypeCommandVerdict, Id: newID(at), At: at, RunId: runID, Reason: reason, DurationMs: int(max(duration, 0).Milliseconds())}
	if exitCode != nil {
		message.ExitCode = *exitCode
		message.Passed = reason == contracts.RunnerCommandVerdictReasonExited && *exitCode == 0
	}
	// Healthy: its address answered 2xx, its process running on or exited 0.
	if reason == contracts.RunnerCommandVerdictReasonHealthy {
		message.Passed = true
	}
	return message
}

// NewCommandKeys sends the run's key wrapped for each holder, to the tab
// tabID of a replay, or to every tab of the run when tabID is empty.
func NewCommandKeys(runID, tabID string, wraps []contracts.RunnerCommandKeysWrapsElem) contracts.RunnerCommandKeys {
	at := now()
	message := contracts.RunnerCommandKeys{Type: TypeCommandKeys, Id: newID(at), At: at, RunId: runID, Wraps: wraps}
	if tabID != "" {
		message.TabId = &tabID
	}
	return message
}

// NewCommandOutput sends one sealed chunk of the run's output, to the tab
// tabID of a replay, or live to every tab of the run when tabID is empty.
func NewCommandOutput(runID, tabID string, seq int, nonce, ciphertext string) contracts.RunnerCommandOutput {
	at := now()
	message := contracts.RunnerCommandOutput{Type: TypeCommandOutput, Id: newID(at), At: at, RunId: runID, Seq: seq, Nonce: nonce, Ciphertext: ciphertext}
	if tabID != "" {
		message.TabId = &tabID
	}
	return message
}

// NewStepStarted says the Skill of an Étape's Session began its StepRun
// (`crewdeck-runner etape start`, RUNNER-12).
func NewStepStarted(stepRunID string) contracts.RunnerStepStarted {
	at := now()
	return contracts.RunnerStepStarted{Type: TypeStepStarted, Id: newID(at), At: at, StepRunId: stepRunID}
}

// NewStepReport is what the Skill reported (`etape report`): its readable
// figures, and its free text sealed under the vault key, nil for none.
func NewStepReport(stepRunID string, figures map[string]any, sealed *contracts.RunnerStepReportSealed) contracts.RunnerStepReport {
	at := now()
	return contracts.RunnerStepReport{Type: TypeStepReport, Id: newID(at), At: at, StepRunId: stepRunID, Figures: figures, Sealed: sealed}
}

// NewStepVerdict is the verdict of the Contrat of an Étape's Session, checked
// at its end.
func NewStepVerdict(stepRunID string, verdict contracts.ContratVerdict) contracts.RunnerStepVerdict {
	at := now()
	return contracts.RunnerStepVerdict{Type: TypeStepVerdict, Id: newID(at), At: at, StepRunId: stepRunID, Verdict: verdict}
}

// NewArtifactContent answers the read requestID of the tab tabID: the key
// wrapped for its Appareil, the content sealed under it.
func NewArtifactContent(requestID, tabID string, wrap contracts.RunnerArtifactContentWrap, nonce, ciphertext string) contracts.RunnerArtifactContent {
	at := now()
	return contracts.RunnerArtifactContent{
		Type: TypeArtifactContent, Id: newID(at), At: at, RequestId: requestID, TabId: tabID,
		Wrap: wrap, Nonce: nonce, Ciphertext: ciphertext,
	}
}

// NewArtifactError says why the read requestID of the tab tabID was not answered.
func NewArtifactError(requestID, tabID string, code contracts.RunnerArtifactErrorCode) contracts.RunnerArtifactError {
	at := now()
	return contracts.RunnerArtifactError{Type: TypeArtifactError, Id: newID(at), At: at, RequestId: requestID, TabId: tabID, Code: code}
}

// NewMigrationProgress is how far a migration's copy is (SOURCE-7).
func NewMigrationProgress(migrationID string, state contracts.RunnerMigrationProgressState, copied, total int) contracts.RunnerMigrationProgress {
	at := now()
	return contracts.RunnerMigrationProgress{Type: TypeMigrationProgress, Id: newID(at), At: at, MigrationId: migrationID, State: state, Copied: copied, Total: total}
}

// NewMigrationSwitch asks the server to switch the group's Source, once a
// pass found nothing to copy: the fingerprints of what moved, the numbers
// renumbered.
func NewMigrationSwitch(migrationID string, fingerprints []contracts.RunnerMigrationSwitchFingerprintsElem, renumbering []contracts.RunnerMigrationSwitchRenumberingElem, milestones []contracts.RunnerMigrationSwitchMilestonesElem) contracts.RunnerMigrationSwitch {
	at := now()
	return contracts.RunnerMigrationSwitch{Type: TypeMigrationSwitch, Id: newID(at), At: at, MigrationId: migrationID, Fingerprints: fingerprints, Renumbering: renumbering, Milestones: milestones}
}

// NewMigrationFinished says the old place is frozen, its late changes carried.
func NewMigrationFinished(migrationID string) contracts.RunnerMigrationFinished {
	at := now()
	return contracts.RunnerMigrationFinished{Type: TypeMigrationFinished, Id: newID(at), At: at, MigrationId: migrationID}
}

// NewMigrationFailed says the copy or the finish failed, with its code.
func NewMigrationFailed(migrationID string, stage contracts.RunnerMigrationFailedStage, code string) contracts.RunnerMigrationFailed {
	at := now()
	return contracts.RunnerMigrationFailed{Type: TypeMigrationFailed, Id: newID(at), At: at, MigrationId: migrationID, Stage: stage, Code: code}
}
