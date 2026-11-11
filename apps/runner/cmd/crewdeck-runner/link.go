package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/service"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
	"github.com/spf13/cobra"
)

// linkCode is `<shortId>-<secret>` in Crockford's base32 (ADR 0003).
var linkCode = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{26}$`)

// engines are the Moteurs the Runner looks for on PATH.
var engines = []string{"claude", "codex"}

// Why a link fails, as the binary says it (US-2).
const (
	reasonUnknown     = "unknown"
	reasonExpired     = "expired"
	reasonAlreadyUsed = "already-used"
	reasonNoEngine    = "no-engine"
	reasonUnsupported = "unsupported-system"
	reasonUnreachable = "server-unreachable"
	reasonRateLimited = "rate-limited"
	reasonTokenGone   = "token-gone"
)

var reasons = map[string]string{
	reasonUnknown:     "Ce code de liaison n’existe pas.",
	reasonExpired:     "Ce code de liaison a expiré avant que le Runner se relie.",
	reasonAlreadyUsed: "Ce code de liaison a déjà servi.",
	reasonNoEngine:    "Aucun Moteur trouvé sur cette machine : installe Claude Code (claude) ou Codex (codex), puis relance la commande.",
	reasonUnsupported: "Ce système n’est pas pris en charge : le Runner tourne sur Linux, macOS ou Windows (WSL), en amd64 ou arm64.",
	reasonRateLimited: "Trop de tentatives de liaison depuis cette adresse : attends une minute.",
	reasonTokenGone:   "Le jeton de ce Runner a déjà été remis une fois.",
}

// linkFailure is a failed link: its reason, then the install command again.
type linkFailure struct {
	reason  string
	server  string
	code    string
	message string
}

func (f *linkFailure) Error() string {
	why := f.message
	if why == "" {
		why = reasons[f.reason]
	}
	if f.reason == reasonUnreachable {
		why = fmt.Sprintf("Le serveur %s ne répond pas (3 essais de 10 s) : vérifie ta connexion.", f.server)
	}
	code := "<nouveau code>"
	hint := "Relance la commande avec un nouveau code, depuis la page Premiers pas de Crewdeck :"
	// The code may still be good when the server did not answer, or the
	// Pilote only waited a minute.
	if f.reason == reasonUnreachable || f.reason == reasonRateLimited {
		code = f.code
		hint = "Relance la commande :"
	}
	return fmt.Sprintf("La liaison a échoué. %s\n%s\n  %s", why, hint, installCommand(f.server, code))
}

// installCommand is the command of the page (ADR 0004).
func installCommand(server, code string) string {
	return fmt.Sprintf("curl -fsSL %s/runner/install.sh | sh -s -- --link %s", server, code)
}

// linker links this machine with a code; its fields are what tests replace.
type linker struct {
	server   string
	http     *http.Client
	tries    int
	retry    time.Duration
	poll     time.Duration
	window   time.Duration
	lookPath func(string) (string, error)
	describe func() (protocol.Machine, error)
	store    state.Store
	install  func(context.Context) (service.Outcome, error)
	out      io.Writer
}

func newLinkCommand(server *string) *cobra.Command {
	var noService bool
	cmd := &cobra.Command{
		Use:   "link <code>",
		Short: "Link this machine to the Pilote's account with the code of the page",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			store, err := state.Default()
			if err != nil {
				return err
			}
			target := *server
			if target == "" {
				if linked, err := store.Load(); err == nil {
					target = linked.Server
				}
			}
			if target == "" {
				return errors.New("Précise le serveur avec --server <url> : la commande de la page le donne.")
			}
			l := &linker{
				server:   strings.TrimRight(target, "/"),
				http:     &http.Client{Timeout: 10 * time.Second},
				tries:    3,
				retry:    contracts.LinkPollSeconds * time.Second,
				poll:     contracts.LinkPollSeconds * time.Second,
				window:   contracts.LinkCodeTtlSeconds * time.Second,
				lookPath: exec.LookPath,
				describe: func() (protocol.Machine, error) { return protocol.DescribeMachine(version) },
				store:    store,
				install:  installService(noService),
				out:      cmd.OutOrStdout(),
			}
			return l.link(cmd.Context(), args[0])
		},
	}
	cmd.Flags().BoolVar(&noService, "no-service", false, "link without installing the user service (development)")
	return cmd
}

// installService installs the user service of this machine, or nothing with --no-service.
func installService(skip bool) func(context.Context) (service.Outcome, error) {
	return func(ctx context.Context) (service.Outcome, error) {
		if skip {
			return service.Outcome{Help: "Service non installé (--no-service) : lance le Runner avec « crewdeck-runner run »."}, nil
		}
		machine, err := protocol.DescribeMachine(version)
		if err != nil {
			return service.Outcome{}, err
		}
		cfg, err := service.Detect(runtime.GOOS, machine.WSL)
		if err != nil {
			return service.Outcome{}, err
		}
		return service.Install(ctx, cfg)
	}
}

func (l *linker) fail(reason, code string) error {
	return &linkFailure{reason: reason, server: l.server, code: code}
}

// link runs the link of ADR 0004: the request, the Runner's pairing, then
// the poll until the page confirmed it; runner.json and the service last.
func (l *linker) link(ctx context.Context, raw string) error {
	if u, err := url.Parse(l.server); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("Le serveur %q n’est pas une adresse http(s).", l.server)
	}
	code := strings.ToUpper(strings.TrimSpace(raw))
	if !linkCode.MatchString(code) {
		return l.fail(reasonUnknown, code)
	}
	// The secret stays on this machine: E2E-2 derives the pairing from it.
	shortID, _, _ := strings.Cut(code, "-")

	machine, err := l.describe()
	if err != nil {
		return l.fail(reasonUnsupported, code)
	}
	found := []string{}
	for _, engine := range engines {
		if _, err := l.lookPath(engine); err == nil {
			found = append(found, engine)
		}
	}
	request := contracts.RunnerLinkRequest{
		ShortId:       shortID,
		Machine:       machine.Machine,
		Os:            contracts.RunnerLinkRequestOs(machine.OS),
		Arch:          contracts.RunnerLinkRequestArch(machine.Arch),
		Wsl:           machine.WSL,
		RunnerVersion: machine.RunnerVersion,
		Engines:       found,
	}
	var accepted contracts.RunnerLinkAccepted
	if err := l.call(ctx, code, http.MethodPost, "/api/runner/link", request, http.StatusAccepted, &accepted); err != nil {
		return err
	}
	pairing := contracts.RunnerLinkPairing{Pairing: contracts.RunnerLinkPairingPairing{}}
	if err := l.call(ctx, code, http.MethodPost, "/api/runner/link/"+url.PathEscape(accepted.LinkId)+"/pairing", pairing, http.StatusNoContent, nil); err != nil {
		return err
	}
	fmt.Fprintln(l.out, "En attente de la confirmation de la page Premiers pas…")

	deadline := time.Now().Add(l.window)
	for {
		var status contracts.RunnerLinkStatus
		if err := l.call(ctx, code, http.MethodGet, "/api/runner/link/"+url.PathEscape(accepted.LinkId), nil, http.StatusOK, &status); err != nil {
			return err
		}
		switch status.State {
		case contracts.RunnerLinkStatusStateLinked:
			return l.linked(ctx, code, status)
		case contracts.RunnerLinkStatusStateFailed:
			reason := reasonExpired
			if status.Reason != nil {
				reason = string(*status.Reason)
			}
			return l.fail(reason, code)
		}
		if time.Now().After(deadline) {
			return l.fail(reasonExpired, code)
		}
		if err := wait(ctx, l.poll); err != nil {
			return err
		}
	}
}

func (l *linker) linked(ctx context.Context, code string, status contracts.RunnerLinkStatus) error {
	if status.Token == nil || status.RunnerId == nil {
		return l.fail(reasonTokenGone, code)
	}
	if err := l.store.Save(state.State{Server: l.server, RunnerID: *status.RunnerId, Token: *status.Token}); err != nil {
		return err
	}
	outcome, err := l.install(ctx)
	fmt.Fprintln(l.out, "Runner relié à ton compte.")
	if err != nil {
		return fmt.Errorf("Le service du Runner n’a pas pu démarrer (%v) : « crewdeck-runner run » le fait tourner au premier plan.", err)
	}
	if outcome.Help != "" {
		fmt.Fprintln(l.out, outcome.Help)
	}
	return nil
}

// call sends one request of the link, tried l.tries times while the server
// does not answer, and decodes its answer or its error envelope.
func (l *linker) call(ctx context.Context, code, method, path string, body any, want int, into any) error {
	var payload []byte
	if body != nil {
		var err error
		if payload, err = json.Marshal(body); err != nil {
			return err
		}
	}
	for try := 1; ; try++ {
		status, data, err := l.send(ctx, method, path, payload)
		if err == nil && status < 500 {
			return l.answer(code, status, data, want, into)
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if try >= l.tries {
			return l.fail(reasonUnreachable, code)
		}
		if err := wait(ctx, l.retry); err != nil {
			return err
		}
	}
}

func (l *linker) send(ctx context.Context, method, path string, payload []byte) (int, []byte, error) {
	var body io.Reader
	if payload != nil {
		body = bytes.NewReader(payload)
	}
	request, err := http.NewRequestWithContext(ctx, method, l.server+path, body)
	if err != nil {
		return 0, nil, err
	}
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set("User-Agent", "crewdeck-runner/"+version)
	response, err := l.http.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	return response.StatusCode, data, err
}

// errorReasons are the server's error codes the binary says in its own words.
var errorReasons = map[string]string{
	"runner.link-code-unknown": reasonUnknown,
	"runner.link-code-expired": reasonExpired,
	"runner.link-code-used":    reasonAlreadyUsed,
	"runner.no-engine":         reasonNoEngine,
	"runner.link-rate-limited": reasonRateLimited,
}

func (l *linker) answer(code string, status int, data []byte, want int, into any) error {
	if status == want {
		if into == nil {
			return nil
		}
		if err := json.Unmarshal(data, into); err != nil {
			return fmt.Errorf("Réponse inattendue du serveur %s : %v", l.server, err)
		}
		return nil
	}
	var envelope contracts.ErrorEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return &linkFailure{server: l.server, code: code, message: fmt.Sprintf("Le serveur a répondu %d.", status)}
	}
	if reason, ok := errorReasons[envelope.Code]; ok {
		return l.fail(reason, code)
	}
	return &linkFailure{server: l.server, code: code, message: envelope.Message}
}

func wait(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
