package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/accounts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/artifact"
	"github.com/maximed1412/crewdeck/apps/runner/internal/command"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/folders"
	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/logging"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mcp"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mirror"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/service"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
	"github.com/maximed1412/crewdeck/apps/runner/internal/steps/ideaanalysis"
	"github.com/maximed1412/crewdeck/apps/runner/internal/update"
	officialskills "github.com/maximed1412/crewdeck/apps/runner/skills"
	"github.com/spf13/cobra"
)

// sessionsGitHubURL is where the Sessions clone the GitHub repositories
// from; empty, GitHub. Only the smoke build changes it (smoke.go).
var sessionsGitHubURL = ""

// sessionsTokens says whether each Session of a GitHub Projet asks the server
// for its token; only the smoke build, its repositories local, turns it off.
var sessionsTokens = true

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
	opened, err := openVault(store)
	if err != nil {
		return err
	}
	// The vault held, swapped by a rotation (E2E-4).
	vault := newHeldVault(opened)
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
	logger.Info("vault.opened", "vaultKeyVersion", opened.Version)
	// The holders of the Sessions' keys, read again from the server at each wrap.
	relay, err := relayKeys(store, serverHolders(&http.Client{Timeout: holdersTimeout}, linked.Server, linked.Token), func(err error) {
		logger.Warn("session.holders", "error", err)
	})
	if err != nil {
		return err
	}
	keys, err := accounts.Default()
	if err != nil {
		return err
	}
	servers, err := mcp.Default()
	if err != nil {
		return err
	}
	socket, err := accounts.DefaultSocket()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// The vault key's rotation (E2E-4): the Runner rotates when it is the
	// first holder online, and takes the new version a holder rotated to.
	rotations := &rotator{store: store, held: vault, api: vaultAPI{http: &http.Client{Timeout: vaultTimeout}, server: linked.Server, token: linked.Token}, logger: logger}
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
		// The cost of each Session so far and the spends not acked, beside
		// runner.json: a Session resumed after a restart sends only what it
		// adds, and no spend is lost.
		SpentPath: filepath.Join(store.Dir, "spent.json"),
	}
	// The adapters, their Sessions watched: a limit or a sign-in they meet
	// reaches the capabilities, the usage they report reaches the server. The Sessions (RUNNER-9) start from this registry.
	reporter.Engines = reporter.Watch(runnerEngines(keys))
	// The Local Projets (SOURCE-2): local.db, written by this Runner only, and
	// their folders, which their Sessions clone.
	locals, err := openLocal(store, vault.Load)
	if err != nil {
		return err
	}
	defer locals.Close()
	// A new vault version: each Local Projet's texts go again, sealed under it.
	rotations.moved = locals.full
	// The Miroir (ADR 0010, ADR 0012): the copy of every Projet's Sources,
	// its follower its only writer, fed by the server's envelopes on each
	// connection and by the Local Projets' folders.
	follower, copied, closeMirror, err := followMirror(ctx, logger, locals, vault)
	if err != nil {
		return err
	}
	defer closeMirror()
	// The Sessions the server asks for, those kept under ~/.crewdeck/sessions
	// said in each hello: none alive after a restart.
	// Each Session of a GitHub Projet has its own token (RUNNER-10), asked
	// of the server with the Runner's, given to git and gh over runner.sock.
	var sessionTokens func(context.Context, string) (github.Issued, error)
	if sessionsTokens {
		sessionTokens = github.ServerTokens{Server: linked.Server, RunnerToken: linked.Token}.Fetch
	}
	sessions, err := session.New(session.Config{
		Home:         store.Dir,
		Engines:      reporter.Engines,
		GitHubURL:    sessionsGitHubURL,
		LocalOrigin:  locals.Origin,
		GitHubTokens: sessionTokens,
		Logger:       logger,
		Keys:         relay,
		Send:         send,
		// The Projet's « Préparer le worktree » and « Nettoyer le
		// worktree » (RUNNER-20), around every worktree it makes.
		Hooks: command.WorktreeHooks(vault),
		// An Étape's Session (RUNNER-12): its official Skill mounted, its
		// report's content sealed under the vault key, its Contrat checked
		// on the change of code the Miroir has of its branch.
		Skills:        officialskills.FS,
		RunnerVersion: version,
		Seal:          vault.SealItem,
		ChangeOf:      mirrorChanges{store: copied, follow: follower}.of,
		// The analysis of an Idée (IDEE-2): its scratch folder given the
		// context read from the Miroir, its texts opened with the vault, and
		// its report sealed under the Idée's analysis.
		Steps: map[contracts.RunnerSessionStartStepStepKind]session.StepKind{
			contracts.RunnerSessionStartStepStepKindIdeaAnalysis: ideaanalysis.New(copied, vault, follower),
		},
	})
	if err != nil {
		return err
	}
	defer sessions.Close()
	// The Commandes the server asks for (RUNNER-18): opened with the vault,
	// run in the places the Sessions' manager gives, ended before it closes.
	commands, err := command.New(command.Config{
		Home:   store.Dir,
		Vault:  vault,
		Places: sessions,
		Keys:   relay,
		Send:   send,
		Logger: logger,
	})
	if err != nil {
		return err
	}
	defer commands.Close()
	// What the page reads of a Local Projet and of the Commandes' output
	// (SOURCE-4), sealed for the Appareil that asked.
	artifacts := &artifact.Reader{
		Home:     store.Dir,
		Keys:     relay,
		Projects: locals.Artifact,
		Send:     send,
		Warn: func(kind string, err error) {
			logger.Warn("artifact.read", "kind", kind, "error", err)
		},
	}
	// The Serveurs MCP declared here, as their last `add` or `test` left
	// them: the Runner starts none of them to report them (US-73).
	reportMCP := func(ctx context.Context) {
		err := protocol.ErrNotConnected
		declared, loadErr := servers.Load()
		if client := current.Load(); loadErr != nil {
			err = loadErr
		} else if client != nil {
			err = client.Send(ctx, protocol.NewMcpServers(mcp.Report(declared)))
		}
		if err != nil && !errors.Is(err, protocol.ErrNotConnected) && ctx.Err() == nil {
			logger.Warn("mcp.servers", "error", err)
		}
	}
	// The Local Projets' folders (PROJET-6, ADR 0012): checked and attached
	// sealed under the vault key, kept in runner.json, said on each
	// connection, after each attach, and every minute when they changed.
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	projectFolders := folders.New(folders.Config{
		Checker: folders.Checker{Home: home, StateDir: store.Dir, WSL: described.WSL},
		Store:   store,
		Vault:   vault,
		Logger:  logger,
		Send: func(ctx context.Context, m any) error {
			client := current.Load()
			if client == nil {
				return protocol.ErrNotConnected
			}
			return client.Send(ctx, m)
		},
	})
	go projectFolders.Every(ctx, folders.ReportEvery)
	report := func(ctx context.Context) {
		if _, err := reporter.Report(ctx); err != nil && !errors.Is(err, protocol.ErrNotConnected) && ctx.Err() == nil {
			logger.Warn("capabilities", "error", err)
		}
		reportMCP(ctx)
		projectFolders.Report(ctx)
	}
	// `login`, `logout` and `mcp add|remove|test` ask for them again through the socket.
	refresh := func(ctx context.Context) ([]contracts.EngineCapabilities, error) {
		caps, err := reporter.Report(ctx)
		reportMCP(ctx)
		return caps, err
	}
	// runner.sock: the refreshes, and the Miroir's ops of `crewdeck-runner miroir`,
	// its writes to a Local Projet among them.
	sock := &localsock.Server{}
	accounts.Register(sock, refresh)
	follower.Register(sock)
	sessions.ServeGitHubTokens(sock)
	sessions.ServeSteps(sock)
	sourceWrites{running: sessions.Running, target: locals.Target, fetch: follower.Fetch, logger: logger}.Register(sock)
	go func() {
		if err := sock.Serve(ctx, socket); err != nil {
			logger.Warn("runner socket", "error", err)
		}
	}()
	// The Local Projets' folders followed (SOURCE-3, ADR 0012): what changed
	// in them reaches the server as local.changed, every item again on each
	// accepted connection.
	// The merges of the local changes (SOURCE-5), the blocked ones retried.
	merges := local.NewMerges(local.MergesConfig{
		DB:      locals.db,
		Project: locals.Project,
		Send:    func(ctx context.Context, m contracts.RunnerMergeLocalResult) error { return send(ctx, m) },
		Logger:  logger,
	})
	go merges.Run(ctx)
	go locals.watch(ctx, local.WatchConfig{
		Send:   func(ctx context.Context, m contracts.RunnerLocalChanged) error { return send(ctx, m) },
		Logger: logger,
		// A ref moved: the Miroir reindexes the Projet's documents (MIROIR-5),
		// the blocked merges are retried at once.
		OnRefsMoved: func(projectID string) {
			follower.RefsMoved(projectID)
			merges.RefsMoved(projectID)
		},
	})
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
		client := follower.NewClient(protocol.Config{
			Server:  linked.Server,
			Token:   linked.Token,
			Machine: described,
			Logger:  logger,
			// What each Moteur can run (US-38), the Serveurs MCP (US-73) and
			// the Projets' folders (PROJET-6), on each accepted connection, and
			// the usage that waits: a spend not acked is sent again.
			OnConnected: func(ctx context.Context) {
				report(ctx)
				reporter.FlushUsage(ctx)
				locals.full()
			},
			Sessions:   sessions.Hello,
			OnAccepted: rotations.accepted(ctx),
		})
		// A spend is forgotten once stored (usage.ack), not once written.
		protocol.On(client, protocol.TypeUsageAck, func(_ context.Context, ack contracts.RunnerUsageAck) error {
			reporter.UsageAcked(ack.UsageId)
			return nil
		})
		sessions.Register(client)
		merges.Register(client)
		projectFolders.Register(client)
		commands.Register(client)
		artifacts.Register(ctx, client)
		rotations.register(ctx, client)
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
		commands.Close() // a run ends with this build: its verdict says stopped
		sessions.Close() // their Moteurs end with this build; the next one reports them
		return m.restart(ctx, binary)
	}
}

// followMirror opens the Miroir and follows GitHub until ctx ends; closeMirror
// waits for the follower, then closes the copy.
func followMirror(ctx context.Context, logger *slog.Logger, locals *localSources, vault *heldVault) (*mirror.Follower, *mirror.Store, func(), error) {
	path, err := mirror.DefaultPath()
	if err != nil {
		return nil, nil, nil, err
	}
	store, err := mirror.Open(path)
	if err != nil {
		return nil, nil, nil, err
	}
	follower, err := mirror.NewFollower(mirror.FollowerConfig{
		Store: store, GitHub: &mirror.Client{Logger: logger}, Logger: logger,
		Locals: locals, Folders: locals.folders,
		Vault:  func() mirror.NameOpener { return vault },
		Clones: mirrorClones(locals.store.Dir, sessionsGitHubURL, locals),
	})
	if err != nil {
		store.Close()
		return nil, nil, nil, err
	}
	ctx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = follower.Run(ctx)
	}()
	return follower, store, func() {
		cancel()
		<-done
		store.Close()
	}, nil
}

// mirrorClones are the clones the Miroir's documentation index reads
// (MIROIR-5): the Sessions' own, under ~/.crewdeck/repos, behind the same
// lock; a GitHub one fetched with the repository's « Miroir » token, a Local
// one from its folder.
func mirrorClones(home, githubURL string, locals *localSources) mirror.Clones {
	return mirror.Clones{
		Origin: func(p mirror.Project, tokens github.TokenSource) mirror.Origin {
			if p.Source == mirror.SourceLocal {
				return session.LockedOrigin(locals.Origin(p.ProjectID))
			}
			owner, name, ok := strings.Cut(p.Repository, "/")
			if !ok {
				return nil
			}
			return &session.GitHubOrigin{Home: home, URL: githubURL, Owner: owner, Name: name, Tokens: tokens}
		},
		Lock: session.LockClone,
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
