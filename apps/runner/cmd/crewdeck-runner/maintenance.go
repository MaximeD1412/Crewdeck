package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/accounts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/service"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
	"github.com/maximed1412/crewdeck/apps/runner/internal/update"
	"github.com/spf13/cobra"
)

// notInstalled says how to run the Runner without its service.
const notInstalled = "Le Runner n’est pas installé comme service sur cette machine : lance-le au premier plan avec « crewdeck-runner run »."

var controlled = map[service.Action]struct{ short, done string }{
	service.ActionStart:   {"Start the Runner's service", "Runner démarré."},
	service.ActionStop:    {"Stop the Runner's service", "Runner arrêté."},
	service.ActionRestart: {"Restart the Runner's service", "Runner redémarré."},
}

func newControlCommand(m *machine, action service.Action) *cobra.Command {
	return &cobra.Command{
		Use:   string(action),
		Short: controlled[action].short,
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := m.service()
			if err != nil {
				return err
			}
			if err := service.Control(cmd.Context(), cfg, action); errors.Is(err, service.ErrNotInstalled) {
				return errors.New(notInstalled)
			} else if err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), controlled[action].done)
			return nil
		},
	}
}

func newLogsCommand(m *machine) *cobra.Command {
	var opts service.LogOptions
	cmd := &cobra.Command{
		Use:   "logs",
		Short: "Print the Runner's log (journalctl, or ~/.crewdeck/runner.log)",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := m.service()
			if err != nil {
				return err
			}
			source, err := service.LogsOf(cfg, opts)
			if errors.Is(err, service.ErrNotInstalled) {
				return errors.New("Pas de journal : le Runner ne tourne pas comme service sur cette machine, « crewdeck-runner run » écrit le sien dans le terminal.")
			}
			if err != nil {
				return err
			}
			ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			if source.File != "" {
				err := service.Tail(ctx, source.File, cmd.OutOrStdout(), opts)
				if errors.Is(err, os.ErrNotExist) {
					return errors.New("Pas encore de journal : le service n’a rien écrit.")
				}
				return err
			}
			journal := exec.CommandContext(ctx, source.Command[0], source.Command[1:]...)
			journal.Stdout = cmd.OutOrStdout()
			journal.Stderr = cmd.ErrOrStderr()
			if err := journal.Run(); err != nil && ctx.Err() == nil {
				return fmt.Errorf("%s : %w", strings.Join(source.Command, " "), err)
			}
			return nil
		},
	}
	cmd.Flags().BoolVarP(&opts.Follow, "follow", "f", false, "keep printing what is written")
	cmd.Flags().IntVarP(&opts.Lines, "lines", "n", 200, "how many of the last lines to print")
	return cmd
}

func newUninstallCommand(m *machine) *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "uninstall",
		Short: "Remove the Runner, its clones, ~/.crewdeck and the API keys it keeps",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			out := cmd.OutOrStdout()
			if !yes {
				fmt.Fprint(out, "Supprimer le Runner, ses clones et ~/.crewdeck ? (o/N) ")
				if !accepted(cmd.InOrStdin()) {
					fmt.Fprintln(out, "Rien n’a été supprimé.")
					return nil
				}
			}
			return m.uninstall(cmd.Context(), out)
		},
	}
	cmd.Flags().BoolVar(&yes, "yes", false, "do not ask first")
	return cmd
}

// accepted reads a yes (o, oui, y, yes); anything else is a no.
func accepted(in io.Reader) bool {
	line, _ := bufio.NewReader(in).ReadString('\n')
	switch strings.ToLower(strings.TrimSpace(line)) {
	case "o", "oui", "y", "yes":
		return true
	}
	return false
}

func (m *machine) uninstall(ctx context.Context, out io.Writer) error {
	cfg, err := m.service()
	if err != nil {
		return err
	}
	if err := service.Uninstall(ctx, cfg); err != nil {
		return err
	}
	store, err := state.Default()
	if err != nil {
		return err
	}
	keys := accounts.Store{Dir: store.Dir}
	for _, id := range accounts.Engines {
		if err := keys.Delete(id); err != nil {
			return err
		}
	}
	if err := removable(store.Dir); err != nil {
		return err
	}
	if err := os.RemoveAll(store.Dir); err != nil {
		return err
	}
	binary, err := m.executable()
	if err != nil {
		return err
	}
	if err := os.Remove(binary); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	fmt.Fprintln(out, "Runner supprimé de cette machine.")
	fmt.Fprintln(out, "Le Runner reste listé sur ton compte jusqu’à ce qu’une nouvelle liaison le remplace.")
	return nil
}

// removable refuses to delete a folder that holds more than the Runner's
// (CREWDECK_HOME set to /, to the home, or to a parent of the home).
func removable(dir string) error {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	home, _ := os.UserHomeDir()
	if abs == filepath.Dir(abs) || (home != "" && (abs == home || strings.HasPrefix(home, abs+string(filepath.Separator)))) {
		return fmt.Errorf("Le dossier du Runner %s n’est pas le sien seul : rien n’a été supprimé.", abs)
	}
	return nil
}

func newUpdateCommand(m *machine, server *string) *cobra.Command {
	return &cobra.Command{
		Use:   "update",
		Short: "Update the Runner to the version of the server it is linked to",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			out := cmd.OutOrStdout()
			store, err := state.Default()
			if err != nil {
				return err
			}
			linked, err := store.Load()
			if errors.Is(err, state.ErrNotLinked) {
				return errors.New(notLinked)
			}
			if err != nil {
				return err
			}
			if *server != "" {
				linked.Server = *server
			}
			binary, err := m.executable()
			if err != nil {
				return err
			}
			updater := &update.Updater{
				Server: linked.Server,
				Binary: binary,
				OS:     runtime.GOOS,
				Arch:   runtime.GOARCH,
				Dir:    store.Dir,
				Logger: slog.New(slog.DiscardHandler),
			}
			latest, err := updater.Latest(cmd.Context())
			if err != nil {
				return fmt.Errorf("Le serveur %s ne dit pas sa version : %w", linked.Server, err)
			}
			if latest == version {
				fmt.Fprintf(out, "Le Runner est à jour (%s).\n", version)
				return nil
			}
			if err := updater.Install(cmd.Context(), latest); errors.Is(err, update.ErrChecksumMismatch) {
				return errors.New("Le Runner téléchargé ne correspond pas à son empreinte SHA-256 : l’ancien est gardé.")
			} else if err != nil {
				return err
			}
			fmt.Fprintf(out, "Runner mis à jour : %s → %s.\n", version, latest)
			cfg, err := m.service()
			if err != nil {
				return err
			}
			ctx, cancel := context.WithTimeout(cmd.Context(), 30*time.Second)
			defer cancel()
			if state, err := service.StateOf(ctx, cfg); err == nil && state == service.StateActive {
				if err := service.Control(ctx, cfg, service.ActionRestart); err != nil {
					return err
				}
				fmt.Fprintln(out, "Runner redémarré.")
			}
			return nil
		},
	}
}
