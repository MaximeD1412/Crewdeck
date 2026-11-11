// Command crewdeck-runner is the Runner: it runs the agents' Sessions on the
// Pilote's machine for the Crewdeck server (ADR 0004).
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/service"
	"github.com/spf13/cobra"
)

// version is set at build time with -ldflags "-X main.version=<v>".
var version = "dev"

// silentExit ends the command with this code, its message already printed.
type silentExit int

func (e silentExit) Error() string { return fmt.Sprintf("exit status %d", int(e)) }

// machine is what the commands reach of this machine; tests replace it.
type machine struct {
	// service describes the user service of this machine.
	service func() (service.Config, error)
	// executable is the running binary's path, the one an update replaces.
	executable func() (string, error)
	// engines says what each Moteur can do here.
	engines func(context.Context) []contracts.EngineCapabilities
	// restart starts the Runner again on the build at binary, once updated.
	restart func(ctx context.Context, binary string) error
}

// adapters are the Moteurs' adapters the Runner registers.
var adapters = &engine.Registry{}

func thisMachine() *machine {
	m := &machine{
		service: func() (service.Config, error) {
			described, err := protocol.DescribeMachine(version)
			if err != nil {
				return service.Config{}, err
			}
			return service.Detect(runtime.GOOS, described.WSL)
		},
		executable: func() (string, error) {
			path, err := os.Executable()
			if err != nil {
				return "", err
			}
			return filepath.EvalSymlinks(path)
		},
		engines: func(ctx context.Context) []contracts.EngineCapabilities {
			return capabilities(ctx, adapters, exec.LookPath)
		},
	}
	m.restart = m.restartOn
	return m
}

func newRootCommand() *cobra.Command { return newRoot(thisMachine()) }

func newRoot(m *machine) *cobra.Command {
	var server string
	root := &cobra.Command{
		Use:           "crewdeck-runner",
		Short:         "Runs the agents' Sessions for the Crewdeck server",
		Version:       version,
		Args:          cobra.NoArgs,
		SilenceUsage:  true,
		SilenceErrors: true,
		// Without a command, the Runner runs (as `nx run runner:run`).
		RunE: func(cmd *cobra.Command, _ []string) error { return m.run(cmd, server) },
	}
	root.SetVersionTemplate("{{.Version}}\n")
	root.PersistentFlags().StringVar(&server, "server", "", "the server's address, instead of the one of runner.json")
	root.AddCommand(&cobra.Command{
		Use:   "version",
		Short: "Print the Runner's version",
		Args:  cobra.NoArgs,
		Run: func(cmd *cobra.Command, _ []string) {
			fmt.Fprintln(cmd.OutOrStdout(), version)
		},
	})
	root.AddCommand(newLinkCommand(&server))
	root.AddCommand(newDevicesCommand(&server))
	root.AddCommand(&cobra.Command{
		Use:   "run",
		Short: "Connect to the server and stay connected, in the foreground",
		Args:  cobra.NoArgs,
		RunE:  func(cmd *cobra.Command, _ []string) error { return m.run(cmd, server) },
	})
	root.AddCommand(newStatusCommand(m))
	for _, action := range []service.Action{service.ActionStart, service.ActionStop, service.ActionRestart} {
		root.AddCommand(newControlCommand(m, action))
	}
	root.AddCommand(newLogsCommand(m))
	root.AddCommand(newUninstallCommand(m))
	root.AddCommand(newUpdateCommand(m, &server))
	root.AddCommand(newContratCommand())
	root.AddCommand(newMCPCommand())
	root.AddCommand(newHookCommand())
	return root
}

// refusal says in French why the server refused the Runner for good.
func refusal(err error) error {
	var update *protocol.UpdateRequiredError
	switch {
	case err == nil:
		return nil
	case errors.Is(err, protocol.ErrUnauthorized):
		return errors.New("Le serveur ne reconnaît plus ce Runner : relie-le à nouveau avec crewdeck-runner link <code>.")
	case errors.Is(err, protocol.ErrReplaced):
		return errors.New("Une autre connexion de ce Runner a pris sa place : celle-ci s’arrête.")
	case errors.As(err, &update):
		if update.LatestVersion == "" {
			return errors.New("Ce Runner est trop ancien pour le serveur : mets-le à jour.")
		}
		return fmt.Errorf("Ce Runner est trop ancien pour le serveur : mets-le à jour (version %s).", update.LatestVersion)
	}
	return err
}

func main() {
	err := newRootCommand().ExecuteContext(context.Background())
	var exit silentExit
	if errors.As(err, &exit) {
		os.Exit(int(exit))
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(exitCode(err))
	}
}
