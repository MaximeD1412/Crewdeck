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
