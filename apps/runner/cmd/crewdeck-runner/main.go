// Command crewdeck-runner is the Runner: it runs the agents' Sessions on the
// Pilote's machine for the Crewdeck server (ADR 0004).
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
	"github.com/spf13/cobra"
)

// version is set at build time with -ldflags "-X main.version=<v>".
var version = "dev"

func newRootCommand() *cobra.Command {
	var server string
	root := &cobra.Command{
		Use:           "crewdeck-runner",
		Short:         "Runs the agents' Sessions for the Crewdeck server",
		Version:       version,
		Args:          cobra.NoArgs,
		SilenceUsage:  true,
		SilenceErrors: true,
		// Without a command, the Runner runs (as `nx run runner:run`).
		RunE: func(cmd *cobra.Command, _ []string) error { return runRunner(cmd, server) },
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
	root.AddCommand(&cobra.Command{
		Use:   "run",
		Short: "Connect to the server and stay connected, in the foreground",
		Args:  cobra.NoArgs,
		RunE:  func(cmd *cobra.Command, _ []string) error { return runRunner(cmd, server) },
	})
	root.AddCommand(newContratCommand())
	return root
}

// runRunner stays connected to the server until SIGINT, SIGTERM, or a refusal of the server for good.
func runRunner(cmd *cobra.Command, server string) error {
	store, err := state.Default()
	if err != nil {
		return err
	}
	linked, err := store.Load()
	if errors.Is(err, state.ErrNotLinked) {
		return errors.New("Ce Runner n’est relié à aucun compte : relie-le avec la commande que donne Crewdeck, crewdeck-runner link <code>.")
	}
	if err != nil {
		return err
	}
	if server != "" {
		linked.Server = server
	}
	machine, err := protocol.DescribeMachine(version)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	client := protocol.New(protocol.Config{
		Server:  linked.Server,
		Token:   linked.Token,
		Machine: machine,
		Logger:  slog.New(slog.NewTextHandler(cmd.ErrOrStderr(), nil)),
	})
	return refusal(client.Run(ctx))
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
	if err := newRootCommand().ExecuteContext(context.Background()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
