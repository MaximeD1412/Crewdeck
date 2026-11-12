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

// NewHello is the hello of `machine`, at the Runner's protocol.
func NewHello(machine Machine) contracts.RunnerHello {
	at := now()
	return contracts.RunnerHello{
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
