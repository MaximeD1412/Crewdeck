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
)

// Machine is what the Runner says of itself in its hello.
type Machine struct {
	RunnerVersion string
	Machine       string
	OS            contracts.RunnerHelloOs
	Arch          contracts.RunnerHelloArch
	WSL           bool
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
