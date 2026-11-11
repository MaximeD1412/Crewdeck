package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"

	"github.com/maximed1412/crewdeck/apps/runner/internal/accounts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

// moteurs are the Moteurs of `login` and `logout`, by the name the Pilote
// types: the binary's.
var moteurs = map[string]contracts.EngineId{"claude": contracts.EngineIdClaudeCode, "codex": contracts.EngineIdCodex}

// moteurNames are the Moteurs' names as the page says them.
var moteurNames = map[contracts.EngineId]string{contracts.EngineIdClaudeCode: "Claude Code", contracts.EngineIdCodex: "Codex"}

// reasonLabels say why a model is not usable, as the page does.
var reasonLabels = map[contracts.EngineCapabilitiesModelsElemReason]string{
	contracts.EngineCapabilitiesModelsElemReasonLoginRequired: "connexion requise",
	contracts.EngineCapabilitiesModelsElemReasonQuotaReached:  "quota atteint",
	contracts.EngineCapabilitiesModelsElemReasonNotInPlan:     "indisponible avec cet abonnement",
}

// accountsCLI connects and disconnects the Comptes IA (US-38); its fields are
// what tests replace.
type accountsCLI struct {
	in  io.Reader
	out io.Writer
	// readSecret reads the key without echoing it.
	readSecret func() (string, error)
	store      accounts.Store
	// claude is the `claude` the subscription's sign-in runs.
	claude string
	// interactive runs a program on the Pilote's terminal.
	interactive func(ctx context.Context, name string, args ...string) error
	// refresh asks the running Runner to send its capabilities, and gives them.
	refresh func(context.Context) ([]contracts.EngineCapabilities, error)
	// local computes the capabilities here, when no Runner runs.
	local func(context.Context) []contracts.EngineCapabilities

	lines *bufio.Reader
}

func newAccountsCLI(cmd *cobra.Command) (*accountsCLI, error) {
	store, err := accounts.Default()
	if err != nil {
		return nil, err
	}
	socket, err := accounts.DefaultSocket()
	if err != nil {
		return nil, err
	}
	reporter := &accounts.Reporter{Engines: runnerEngines(store), Send: func(context.Context, contracts.RunnerCapabilities) error { return nil }}
	in := cmd.InOrStdin()
	return &accountsCLI{
		in:          in,
		out:         cmd.OutOrStdout(),
		readSecret:  func() (string, error) { return readHidden(in) },
		store:       store,
		claude:      "claude",
		interactive: runInteractive,
		refresh: func(ctx context.Context) ([]contracts.EngineCapabilities, error) {
			return accounts.Refresh(ctx, socket)
		},
		local: reporter.Capabilities,
	}, nil
}

func newLoginCommand() *cobra.Command {
	return &cobra.Command{
		Use:       "login claude|codex",
		Short:     "Connect a Compte IA on this machine: a Claude subscription, or an API key kept in the keychain",
		Args:      cobra.ExactArgs(1),
		ValidArgs: []string{"claude", "codex"},
		RunE: func(cmd *cobra.Command, args []string) error {
			cli, err := newAccountsCLI(cmd)
			if err != nil {
				return err
			}
			return cli.login(cmd.Context(), args[0])
		},
	}
}

func newLogoutCommand() *cobra.Command {
	return &cobra.Command{
		Use:       "logout claude|codex",
		Short:     "Delete the API key of a Compte IA from this machine",
		Args:      cobra.ExactArgs(1),
		ValidArgs: []string{"claude", "codex"},
		RunE: func(cmd *cobra.Command, args []string) error {
			cli, err := newAccountsCLI(cmd)
			if err != nil {
				return err
			}
			return cli.logout(cmd.Context(), args[0])
		},
	}
}

func moteurOf(name string) (contracts.EngineId, error) {
	id, ok := moteurs[name]
	if !ok {
		return "", fmt.Errorf("Moteur inconnu « %s » : choisis claude ou codex.", name)
	}
	return id, nil
}

func (c *accountsCLI) line() (string, error) {
	if c.lines == nil {
		c.lines = bufio.NewReader(c.in)
	}
	text, err := c.lines.ReadString('\n')
	if err != nil && (text == "" || !errors.Is(err, io.EOF)) {
		return "", err
	}
	return strings.TrimSpace(text), nil
}

// login connects the Compte IA of `name`, then has the Runner send its
// capabilities and prints the models it can run.
func (c *accountsCLI) login(ctx context.Context, name string) error {
	id, err := moteurOf(name)
	if err != nil {
		return err
	}
	if id == contracts.EngineIdClaudeCode {
		subscription, err := c.askClaudeKind()
		if err != nil {
			return err
		}
		if subscription {
			return c.signInClaude(ctx)
		}
	}
	fmt.Fprintf(c.out, "Colle ta clé API %s (elle ne s’affiche pas) : ", provider(id))
	key, err := c.readSecret()
	fmt.Fprintln(c.out)
	if err != nil {
		return fmt.Errorf("La clé API n’a pas pu être lue : %w", err)
	}
	if err := c.store.Set(id, key); errors.Is(err, accounts.ErrEmptyKey) {
		return errors.New("Aucune clé API saisie : relance la commande et colle ta clé.")
	} else if err != nil {
		return fmt.Errorf("La clé API n’a pas pu être enregistrée : %w", err)
	}
	fmt.Fprintf(c.out, "Clé API de %s enregistrée sur cette machine ; elle n’est jamais envoyée à Crewdeck.\n", moteurNames[id])
	return c.report(ctx, id)
}

func provider(id contracts.EngineId) string {
	if id == contracts.EngineIdCodex {
		return "OpenAI"
	}
	return "Anthropic"
}

// askClaudeKind asks until the Pilote answers 1 (subscription) or 2 (API key).
func (c *accountsCLI) askClaudeKind() (subscription bool, err error) {
	fmt.Fprintln(c.out, "Abonnement Claude ou clé API ?")
	fmt.Fprintln(c.out, "  1. Abonnement Claude : tu te connectes dans Claude Code, dans ce terminal")
	fmt.Fprintln(c.out, "  2. Clé API Anthropic : gardée dans le trousseau de cette machine")
	for {
		fmt.Fprint(c.out, "Ton choix (1 ou 2) : ")
		answer, err := c.line()
		if err != nil {
			return false, errors.New("Aucun choix lu : relance la commande.")
		}
		switch answer {
		case "1":
			return true, nil
		case "2":
			return false, nil
		}
		fmt.Fprintln(c.out, "Réponds 1 ou 2.")
	}
}

// signInClaude runs `claude /login` on the terminal: the sign-in stays
// Claude Code's own. A stored API key would win over it, so it is deleted.
func (c *accountsCLI) signInClaude(ctx context.Context) error {
	if err := c.store.Delete(contracts.EngineIdClaudeCode); err == nil {
		fmt.Fprintln(c.out, "La clé API de Claude Code enregistrée sur cette machine est supprimée : ton abonnement prend sa place.")
	} else if !errors.Is(err, accounts.ErrNotFound) {
		return fmt.Errorf("La clé API de Claude Code n’a pas pu être supprimée : %w", err)
	}
	fmt.Fprintln(c.out, "Claude Code s’ouvre sur /login : connecte-toi, puis quitte-le avec /exit.")
	if err := c.interactive(ctx, c.claude, "/login"); err != nil {
		var missing *exec.Error
		if errors.As(err, &missing) {
			return errors.New("Claude Code (claude) n’est pas installé sur cette machine : installe-le, puis relance la commande.")
		}
		return fmt.Errorf("Claude Code s’est arrêté en erreur : %w", err)
	}
	return c.report(ctx, contracts.EngineIdClaudeCode)
}

// logout deletes the stored key of `name`, then has the Runner send its
// capabilities.
func (c *accountsCLI) logout(ctx context.Context, name string) error {
	id, err := moteurOf(name)
	if err != nil {
		return err
	}
	switch err := c.store.Delete(id); {
	case errors.Is(err, accounts.ErrNotFound):
		fmt.Fprintf(c.out, "Aucune clé API de %s n’est enregistrée sur cette machine.\n", moteurNames[id])
	case err != nil:
		return fmt.Errorf("La clé API de %s n’a pas pu être supprimée : %w", moteurNames[id], err)
	default:
		fmt.Fprintf(c.out, "Clé API de %s supprimée de cette machine.\n", moteurNames[id])
	}
	if id == contracts.EngineIdClaudeCode {
		fmt.Fprintln(c.out, "Ton abonnement Claude reste celui de Claude Code : pour t’en déconnecter, lance claude puis /logout.")
	}
	return c.report(ctx, id)
}

// report has the running Runner send its capabilities, or computes them
// here, then prints the models of `id` it can run.
func (c *accountsCLI) report(ctx context.Context, id contracts.EngineId) error {
	caps, err := c.refresh(ctx)
	switch {
	case errors.Is(err, accounts.ErrNoRunner):
		fmt.Fprintln(c.out, "Le Runner ne tourne pas : il enverra ses Moteurs à Crewdeck dès sa prochaine connexion.")
		caps = c.local(ctx)
	case err != nil:
		fmt.Fprintf(c.out, "Le Runner n’a pas pu envoyer ses Moteurs à Crewdeck (%v) : il les renverra dans 10 minutes au plus.\n", err)
		if caps == nil {
			caps = c.local(ctx)
		}
	default:
		fmt.Fprintln(c.out, "Le Runner a envoyé ses Moteurs à Crewdeck.")
	}
	for _, engine := range caps {
		if engine.Engine == id {
			printModels(c.out, engine)
			return nil
		}
	}
	fmt.Fprintf(c.out, "Le Runner ne pilote pas encore %s sur cette machine.\n", moteurNames[id])
	return nil
}

func printModels(out io.Writer, engine contracts.EngineCapabilities) {
	name := moteurNames[engine.Engine]
	if !engine.Installed {
		fmt.Fprintf(out, "%s n’est pas installé sur cette machine.\n", name)
		return
	}
	var usable, unusable []string
	for _, m := range engine.Models {
		label := fmt.Sprintf("%s (%s)", m.Label, m.Id)
		if m.Usable {
			usable = append(usable, label)
		} else if m.Reason != nil {
			unusable = append(unusable, fmt.Sprintf("%s : %s", label, reasonLabels[*m.Reason]))
		}
	}
	if len(usable) == 0 {
		fmt.Fprintf(out, "Aucun modèle utilisable de %s pour l’instant.\n", name)
	} else {
		fmt.Fprintf(out, "Modèles utilisables de %s : %s\n", name, strings.Join(usable, ", "))
	}
	if len(unusable) > 0 {
		fmt.Fprintf(out, "Indisponibles : %s\n", strings.Join(unusable, ", "))
	}
	if !engine.KnownVersion && engine.Version != nil {
		fmt.Fprintf(out, "Version %s non vérifiée par ce Runner : elle peut se comporter autrement.\n", *engine.Version)
	}
}

// readHidden reads a line without echo from a terminal, else (a pipe) as is.
func readHidden(in io.Reader) (string, error) {
	if file, ok := in.(*os.File); ok && term.IsTerminal(int(file.Fd())) {
		data, err := term.ReadPassword(int(file.Fd()))
		return string(data), err
	}
	line, err := bufio.NewReader(in).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	return line, nil
}

// runInteractive runs a program on the Pilote's terminal, unmodified.
func runInteractive(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	return cmd.Run()
}
