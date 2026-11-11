package protocol

import (
	"fmt"
	"os"
	"runtime"
	"strings"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// DescribeMachine is this machine as its hello says it: its name, its OS and
// architecture, and whether it is WSL (Windows, US-2).
func DescribeMachine(runnerVersion string) (Machine, error) {
	name, err := os.Hostname()
	if err != nil || name == "" {
		name = "machine"
	}
	machine := Machine{RunnerVersion: runnerVersion, Machine: name}
	switch runtime.GOOS {
	case "linux":
		machine.OS = contracts.RunnerHelloOsLinux
		machine.WSL = isWSL()
	case "darwin":
		machine.OS = contracts.RunnerHelloOsDarwin
	default:
		return Machine{}, fmt.Errorf("protocol: %s is not supported (linux, darwin, or Windows through WSL)", runtime.GOOS)
	}
	switch runtime.GOARCH {
	case "amd64":
		machine.Arch = contracts.RunnerHelloArchAmd64
	case "arm64":
		machine.Arch = contracts.RunnerHelloArchArm64
	default:
		return Machine{}, fmt.Errorf("protocol: %s is not supported (amd64, arm64)", runtime.GOARCH)
	}
	return machine, nil
}

func isWSL() bool {
	if os.Getenv("WSL_DISTRO_NAME") != "" {
		return true
	}
	release, err := os.ReadFile("/proc/sys/kernel/osrelease")
	return err == nil && strings.Contains(strings.ToLower(string(release)), "microsoft")
}
