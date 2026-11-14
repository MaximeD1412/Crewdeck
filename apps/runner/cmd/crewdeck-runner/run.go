package main

import (
	"context"
	"errors"
	"os"
	"os/signal"
	"runtime"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/accounts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/logging"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/service"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
	"github.com/maximed1412/crewdeck/apps/runner/internal/update"
	"github.com/spf13/cobra"
)

const notLinked = "Ce Runner n’est relié à aucun compte : relie-le avec la commande que donne Crewdeck, crewdeck-runner link <code>."

// run stays connected to the server until SIGINT, SIGTERM, or a refusal of
// the server for good. Rejected with update-required, it updates itself from
// the server it is linked to and restarts on the new build; an update that
// fails waits for the next attempt, then connects again.
func (m *machine) run(cmd *cobra.Command, server string) error {
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
	// The vault opens at start: a Runner that cannot open it does not run.
	vault, err := openVault(store)
	if err != nil {
		return err
	}
	if server != "" {
		linked.Server = server
	}
	// The path is read before any update renames another build over it.
	binary, err := m.executable()
	if err != nil {
		return err
	}
	described, err := protocol.DescribeMachine(version)
	if err != nil {
		return err
	}
	logger := logging.New(cmd.ErrOrStderr())
	logger.Info("vault.opened", "vaultKeyVersion", vault.Version)
	keys, err := accounts.Default()
	if err != nil {
		return err
	}
	socket, err := accounts.DefaultSocket()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// The client of the current connection: a new one after each update attempt.
	var current atomic.Pointer[protocol.Client]
	send := func(ctx context.Context, m any) error {
		client := current.Load()
		if client == nil {
			return protocol.ErrNotConnected
		}
		return client.Send(ctx, m)
	}
	reporter := &accounts.Reporter{
		Send:      func(ctx context.Context, m contracts.RunnerCapabilities) error { return send(ctx, m) },
		SendUsage: func(ctx context.Context, m contracts.RunnerUsage) error { return send(ctx, m) },
		Logger:    logger,
	}
	// The adapters, their Sessions watched: a limit or a sign-in they meet
	// reaches the capabilities, the usage they report reaches the server. The Sessions (RUNNER-9) start from this registry.
	reporter.Engines = reporter.Watch(runnerEngines(keys))
	report := func(ctx context.Context) {
		if _, err := reporter.Report(ctx); err != nil && !errors.Is(err, protocol.ErrNotConnected) && ctx.Err() == nil {
			logger.Warn("capabilities", "error", err)
		}
	}
	// `login` and `logout` ask for them again through the socket.
	go func() {
		if err := accounts.Serve(ctx, socket, reporter.Report); err != nil {
			logger.Warn("accounts socket", "error", err)
		}
	}()
	go reporter.Every(ctx, contracts.CapabilitiesEverySeconds*time.Second)
	go reporter.UsageEvery(ctx, contracts.UsageEverySeconds*time.Second)
	updater := &update.Updater{
		Server: linked.Server,
		Binary: binary,
		OS:     runtime.GOOS,
		Arch:   runtime.GOARCH,
		Dir:    store.Dir,
		Logger: logger,
	}
	for {
		client := protocol.New(protocol.Config{
			Server:  linked.Server,
			Token:   linked.Token,
			Machine: described,
			Logger:  logger,
			// What each Moteur can run, on each accepted connection (US-38).
			OnConnected: report,
		})
		current.Store(client)
		err := client.Run(ctx)
		var required *protocol.UpdateRequiredError
		if !errors.As(err, &required) {
			return refusal(err)
		}
		logger.Info("update.required", "version", version, "latestVersion", required.LatestVersion)
		if err := updater.Apply(ctx, required.LatestVersion); err != nil {
			logger.Warn("update.failed", "error", err.Error(), "nextAttempt", updater.NextAttempt())
			if !sleepUntil(ctx, updater.NextAttempt()) {
				return nil
			}
			continue
		}
		logger.Info("update.restart", "binary", binary)
		return m.restart(ctx, binary)
	}
}

// sleepUntil waits for at, false when ctx ends first.
func sleepUntil(ctx context.Context, at time.Time) bool {
	timer := time.NewTimer(time.Until(at))
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

// underService: the process is the one the service manager runs.
func underService() bool {
	return os.Getenv("INVOCATION_ID") != "" || os.Getenv("XPC_SERVICE_NAME") == service.Label
}

// restartOn starts the Runner again on the build at binary: through its
// service when the service runs it, else in place of this process.
func (m *machine) restartOn(ctx context.Context, binary string) error {
	if underService() {
		cfg, err := m.service()
		if err == nil {
			err = service.Control(context.WithoutCancel(ctx), cfg, service.ActionRestart)
		}
		if err == nil {
			return nil
		}
		// The service manager starts again a Runner that ends in failure.
		return silentExit(1)
	}
	return syscall.Exec(binary, os.Args, os.Environ())
}
