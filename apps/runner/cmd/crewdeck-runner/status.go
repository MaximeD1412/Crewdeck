package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os/exec"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/service"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
	"github.com/maximed1412/crewdeck/apps/runner/internal/update"
	"github.com/spf13/cobra"
)

// Connection is whether the server the Runner is linked to answers.
type Connection string

const (
	ConnectionOnline      Connection = "online"
	ConnectionUnreachable Connection = "unreachable"
)

// Status is what `crewdeck-runner status` says (US-38), and prints with --json.
type Status struct {
	Linked bool `json:"linked"`
	// Server is the server it is linked to; empty when not linked.
	Server  string        `json:"server,omitempty"`
	Service service.State `json:"service"`
	// Connection is empty when not linked.
	Connection Connection `json:"connection,omitempty"`
	Version    string     `json:"version"`
	// LatestVersion is the server's (GET /runner/latest), empty when unknown.
	LatestVersion   string                         `json:"latestVersion,omitempty"`
	UpdateAvailable bool                           `json:"updateAvailable"`
	Engines         []contracts.EngineCapabilities `json:"engines"`
}

func newStatusCommand(m *machine) *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "status",
		Short: "Print the link, the service, the connection, the version and the Moteurs with their models",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			status, err := m.status(cmd.Context())
			if err != nil {
				return err
			}
			if asJSON {
				encoder := json.NewEncoder(cmd.OutOrStdout())
				encoder.SetIndent("", "  ")
				if err := encoder.Encode(status); err != nil {
					return err
				}
			} else {
				printStatus(cmd.OutOrStdout(), status)
			}
			if !status.Linked {
				return silentExit(1)
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "print the status as JSON")
	return cmd
}

func (m *machine) status(ctx context.Context) (Status, error) {
	status := Status{Version: version, Engines: m.engines(ctx)}
	if status.Engines == nil {
		status.Engines = []contracts.EngineCapabilities{}
	}
	cfg, err := m.service()
	if err != nil {
		return Status{}, err
	}
	if status.Service, err = service.StateOf(ctx, cfg); err != nil {
		return Status{}, err
	}
	store, err := state.Default()
	if err != nil {
		return Status{}, err
	}
	linked, err := store.Load()
	if errors.Is(err, state.ErrNotLinked) {
		return status, nil
	}
	if err != nil {
		return Status{}, err
	}
	status.Linked, status.Server = true, linked.Server
	updater := &update.Updater{Server: linked.Server, HTTP: &http.Client{Timeout: 5 * time.Second}}
	latest, err := updater.Latest(ctx)
	var unreachable *url.Error
	switch {
	case errors.As(err, &unreachable):
		status.Connection = ConnectionUnreachable
	case err != nil:
		// The server answers, without a version (an older one).
		status.Connection = ConnectionOnline
	default:
		status.Connection = ConnectionOnline
		status.LatestVersion = latest
		status.UpdateAvailable = latest != version
	}
	return status, nil
}

var (
	serviceStates = map[service.State]string{
		service.StateActive:       "actif",
		service.StateInactive:     "inactif (crewdeck-runner start)",
		service.StateNotInstalled: "non installé (crewdeck-runner run le fait tourner au premier plan)",
	}
	engineNames  = map[contracts.EngineId]string{contracts.EngineIdClaudeCode: "Claude Code", contracts.EngineIdCodex: "Codex"}
	accountKinds = map[contracts.EngineCapabilitiesAccountKind]string{
		contracts.EngineCapabilitiesAccountKindSubscription: "abonnement",
		contracts.EngineCapabilitiesAccountKindApiKey:       "clé API",
		contracts.EngineCapabilitiesAccountKindNone:         "aucun",
	}
	accountStates = map[contracts.EngineCapabilitiesAccountState]string{
		contracts.EngineCapabilitiesAccountStateConnected:     "connecté",
		contracts.EngineCapabilitiesAccountStateLoginRequired: "connexion requise",
	}
	modelReasons = map[contracts.EngineCapabilitiesModelsElemReason]string{
		contracts.EngineCapabilitiesModelsElemReasonLoginRequired: "connexion requise",
		contracts.EngineCapabilitiesModelsElemReasonQuotaReached:  "quota atteint",
		contracts.EngineCapabilitiesModelsElemReasonNotInPlan:     "indisponible avec cet abonnement",
	}
)

func printStatus(w io.Writer, s Status) {
	if s.Linked {
		fmt.Fprintf(w, "Relié à %s\n", s.Server)
	} else {
		fmt.Fprintln(w, "Pas relié : lance la commande de la page Premiers pas.")
	}
	fmt.Fprintf(w, "Service : %s\n", serviceStates[s.Service])
	switch s.Connection {
	case ConnectionOnline:
		fmt.Fprintln(w, "Connexion : en ligne")
	case ConnectionUnreachable:
		fmt.Fprintln(w, "Connexion : le serveur ne répond pas")
	}
	switch {
	case s.UpdateAvailable:
		fmt.Fprintf(w, "Version : %s · mise à jour disponible : %s (crewdeck-runner update)\n", s.Version, s.LatestVersion)
	case s.LatestVersion != "":
		fmt.Fprintf(w, "Version : %s · à jour\n", s.Version)
	default:
		fmt.Fprintf(w, "Version : %s\n", s.Version)
	}
	found := false
	for _, e := range s.Engines {
		if !e.Installed {
			fmt.Fprintf(w, "%s : non installé\n", engineNames[e.Engine])
			continue
		}
		found = true
		line := engineNames[e.Engine]
		if e.Version != nil {
			line += " " + *e.Version
		}
		if !e.KnownVersion {
			line += " (version non vérifiée)"
		}
		account := accountKinds[e.Account.Kind]
		if e.Account.Kind != contracts.EngineCapabilitiesAccountKindNone {
			account += ", " + accountStates[e.Account.State]
		}
		fmt.Fprintf(w, "%s · compte : %s\n", line, account)
		if len(e.Models) == 0 {
			fmt.Fprintln(w, "  aucun modèle connu")
		}
		for _, model := range e.Models {
			why := "utilisable"
			if !model.Usable {
				why = "inutilisable"
				if model.Reason != nil {
					why = modelReasons[*model.Reason]
				}
			}
			fmt.Fprintf(w, "  %s : %s\n", model.Id, why)
		}
	}
	if !found {
		fmt.Fprintln(w, "Aucun Moteur trouvé : installe Claude Code (claude) ou Codex (codex).")
	}
}

// engineBinaries are the Moteurs the Runner knows, by the binary it looks for on PATH.
var engineBinaries = []struct {
	id     contracts.EngineId
	binary string
}{{contracts.EngineIdClaudeCode, "claude"}, {contracts.EngineIdCodex, "codex"}}

// capabilities is what each Moteur can do here: its adapter's Capabilities
// when one is registered, else what PATH says of its binary (installed, its
// version), no account nor model known.
func capabilities(ctx context.Context, adapters *engine.Registry, lookPath func(string) (string, error)) []contracts.EngineCapabilities {
	all := []contracts.EngineCapabilities{}
	for _, known := range engineBinaries {
		if adapter, ok := adapters.Get(known.id); ok {
			if caps, err := adapter.Capabilities(ctx); err == nil {
				all = append(all, caps)
				continue
			}
		}
		caps := contracts.EngineCapabilities{
			Engine:  known.id,
			Account: contracts.EngineCapabilitiesAccount{Kind: contracts.EngineCapabilitiesAccountKindNone, State: contracts.EngineCapabilitiesAccountStateLoginRequired},
			Models:  []contracts.EngineCapabilitiesModelsElem{},
		}
		if path, err := lookPath(known.binary); err == nil {
			caps.Installed = true
			probe, cancel := context.WithTimeout(ctx, 5*time.Second)
			out, err := exec.CommandContext(probe, path, "--version").Output()
			cancel()
			if v, ok := engine.ParseVersion(string(out)); err == nil && ok {
				caps.Version = &v
			}
		}
		all = append(all, caps)
	}
	return all
}
