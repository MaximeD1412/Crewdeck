package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/service"
)

func latestServer(t *testing.T, latest string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/runner/latest" {
			http.NotFound(w, r)
			return
		}
		w.Write([]byte(`{"version":"` + latest + `"}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func ptr[T any](v T) *T { return &v }

func claudeWithModels() contracts.EngineCapabilities {
	return contracts.EngineCapabilities{
		Engine:       contracts.EngineIdClaudeCode,
		Installed:    true,
		Version:      ptr("2.1.319"),
		KnownVersion: false,
		Account:      contracts.EngineCapabilitiesAccount{Kind: contracts.EngineCapabilitiesAccountKindSubscription, State: contracts.EngineCapabilitiesAccountStateConnected},
		Models: []contracts.EngineCapabilitiesModelsElem{
			{Id: "claude-opus-5-5", Label: "Opus 5.5", Usable: true},
			{Id: "claude-sonnet-5-5", Label: "Sonnet 5.5", Usable: false, Reason: ptr(contracts.EngineCapabilitiesModelsElemReasonQuotaReached)},
			{Id: "claude-fable-5-1", Label: "Fable 5.1", Usable: false, Reason: ptr(contracts.EngineCapabilitiesModelsElemReasonNotInPlan)},
		},
	}
}

func codexMissing() contracts.EngineCapabilities {
	return contracts.EngineCapabilities{
		Engine:  contracts.EngineIdCodex,
		Account: contracts.EngineCapabilitiesAccount{Kind: contracts.EngineCapabilitiesAccountKindNone, State: contracts.EngineCapabilitiesAccountStateLoginRequired},
		Models:  []contracts.EngineCapabilitiesModelsElem{},
	}
}

func TestStatusSaysTheLinkTheServiceTheConnectionTheVersionAndEachMoteur(t *testing.T) {
	setVersion(t, "abc1234")
	tl := fakeTools(t, "systemctl")
	f := newMachineFixture(t, service.Config{OS: "linux", Systemd: true})
	f.installService(t)
	srv := latestServer(t, "def5678")
	f.link(t, srv.URL)
	f.engines = []contracts.EngineCapabilities{claudeWithModels(), codexMissing()}

	out, err := f.execute(t, "", "status")
	if err != nil {
		t.Fatalf("status: %v\n%s", err, out)
	}
	for _, line := range []string{
		"Relié à " + srv.URL,
		"Service : actif",
		"Connexion : en ligne",
		"Version : abc1234 · mise à jour disponible : def5678 (crewdeck-runner update)",
		"Claude Code 2.1.319 (version non vérifiée) · compte : abonnement, connecté",
		"  claude-opus-5-5 : utilisable",
		"  claude-sonnet-5-5 : quota atteint",
		"  claude-fable-5-1 : indisponible avec cet abonnement",
		"Codex : non installé",
	} {
		if !strings.Contains(out, line+"\n") {
			t.Errorf("status lacks %q:\n%s", line, out)
		}
	}
	if calls := tl.calls(t); len(calls) != 1 || calls[0] != "systemctl --user is-active --quiet crewdeck-runner.service" {
		t.Fatalf("calls %v", calls)
	}
}

func TestStatusSaysAServiceStoppedOrMissingAndAServerThatDoesNotAnswer(t *testing.T) {
	setVersion(t, "abc1234")
	tl := fakeTools(t, "systemctl")
	tl.answer(t, "systemctl", "", 3)
	f := newMachineFixture(t, service.Config{OS: "linux", Systemd: true})
	f.installService(t)
	f.link(t, "http://127.0.0.1:1")

	out, err := f.execute(t, "", "status")
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range []string{"Service : inactif (crewdeck-runner start)", "Connexion : le serveur ne répond pas", "Version : abc1234", "Aucun Moteur trouvé : installe Claude Code (claude) ou Codex (codex)."} {
		if !strings.Contains(out, line+"\n") {
			t.Errorf("status lacks %q:\n%s", line, out)
		}
	}

	wsl := newMachineFixture(t, service.Config{OS: "linux", WSL: true})
	wsl.link(t, "http://127.0.0.1:1")
	out, _ = wsl.execute(t, "", "status")
	if !strings.Contains(out, "Service : non installé (crewdeck-runner run le fait tourner au premier plan)\n") {
		t.Errorf("status:\n%s", out)
	}
}

func TestStatusOfAnUpToDateRunner(t *testing.T) {
	setVersion(t, "abc1234")
	fakeTools(t, "systemctl")
	f := newMachineFixture(t, service.Config{OS: "linux", Systemd: true})
	f.link(t, latestServer(t, "abc1234").URL)

	out, _ := f.execute(t, "", "status")
	if !strings.Contains(out, "Version : abc1234 · à jour\n") {
		t.Fatalf("status:\n%s", out)
	}
}

func TestStatusOfAnUnlinkedRunnerSaysSoAndExitsOne(t *testing.T) {
	fakeTools(t, "systemctl")
	f := newMachineFixture(t, service.Config{OS: "linux", Systemd: true})

	out, err := f.execute(t, "", "status")
	var exit silentExit
	if !errors.As(err, &exit) || exit != 1 {
		t.Fatalf("err = %v", err)
	}
	if !strings.Contains(out, "Pas relié : lance la commande de la page Premiers pas.\n") || strings.Contains(out, "Connexion") {
		t.Fatalf("status:\n%s", out)
	}
}

func TestStatusJSONIsTheStatusStruct(t *testing.T) {
	setVersion(t, "abc1234")
	fakeTools(t, "systemctl")
	f := newMachineFixture(t, service.Config{OS: "linux", Systemd: true})
	f.installService(t)
	srv := latestServer(t, "def5678")
	f.link(t, srv.URL)
	f.engines = []contracts.EngineCapabilities{claudeWithModels(), codexMissing()}

	out, err := f.execute(t, "", "status", "--json")
	if err != nil {
		t.Fatal(err)
	}
	decoder := json.NewDecoder(bytes.NewReader([]byte(out)))
	decoder.DisallowUnknownFields()
	var got Status
	if err := decoder.Decode(&got); err != nil {
		t.Fatalf("decode: %v\n%s", err, out)
	}
	want := Status{
		Linked:          true,
		Server:          srv.URL,
		Service:         service.StateActive,
		Connection:      ConnectionOnline,
		Version:         "abc1234",
		LatestVersion:   "def5678",
		UpdateAvailable: true,
		Engines:         []contracts.EngineCapabilities{claudeWithModels(), codexMissing()},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("status\n%+v\nwant\n%+v", got, want)
	}

	unlinked := newMachineFixture(t, service.Config{OS: "linux", WSL: true})
	out, err = unlinked.execute(t, "", "status", "--json")
	var exit silentExit
	if !errors.As(err, &exit) || exit != 1 {
		t.Fatalf("err = %v", err)
	}
	var bare map[string]any
	if err := json.Unmarshal([]byte(out), &bare); err != nil || bare["linked"] != false || bare["service"] != "not-installed" || bare["engines"] == nil {
		t.Fatalf("status --json of an unlinked Runner: %v\n%s", err, out)
	}
}

func setVersion(t *testing.T, v string) {
	t.Helper()
	previous := version
	version = v
	t.Cleanup(func() { version = previous })
}
