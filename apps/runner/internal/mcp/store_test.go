package mcp

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/accounts"
)

// memoryKeyring is a keychain that answers, held in memory.
type memoryKeyring map[string]string

func (k memoryKeyring) Get(service, user string) (string, error) {
	if v, ok := k[service+"/"+user]; ok {
		return v, nil
	}
	return "", accounts.ErrKeyringNotFound
}

func (k memoryKeyring) Set(service, user, secret string) error {
	k[service+"/"+user] = secret
	return nil
}

func (k memoryKeyring) Delete(service, user string) error {
	if _, ok := k[service+"/"+user]; !ok {
		return accounts.ErrKeyringNotFound
	}
	delete(k, service+"/"+user)
	return nil
}

// absentKeyring is a machine without a keychain (WSL without Secret Service).
type absentKeyring struct{}

var errNoKeychain = errors.New("org.freedesktop.secrets was not provided by any .service files")

func (absentKeyring) Get(string, string) (string, error) { return "", errNoKeychain }
func (absentKeyring) Set(string, string, string) error   { return errNoKeychain }
func (absentKeyring) Delete(string, string) error        { return errNoKeychain }

func stitch() Server {
	return Server{Name: "stitch", Transport: TransportStdio, Command: "npx", Args: []string{"stitch-mcp"}, Env: map[string]string{"API_KEY": "s3cr3t"}}
}

func readFile(t *testing.T, dir string) (string, os.FileMode) {
	t.Helper()
	path := filepath.Join(dir, FileName)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data), info.Mode().Perm()
}

func TestAddKeepsTheEnvInTheKeychainAndOnlyItsReferenceInTheFile(t *testing.T) {
	keychain := memoryKeyring{}
	store := Store{Keyring: keychain, Dir: t.TempDir()}
	if err := store.Add(stitch()); err != nil {
		t.Fatal(err)
	}
	data, mode := readFile(t, store.Dir)
	if mode != 0o600 {
		t.Fatalf("mcp.json mode %o, want 600", mode)
	}
	if strings.Contains(data, "s3cr3t") {
		t.Fatalf("mcp.json holds the secret: %s", data)
	}
	var file struct {
		Version int `json:"version"`
		Servers map[string]struct {
			Transport string                     `json:"transport"`
			Command   string                     `json:"command"`
			Args      []string                   `json:"args"`
			Env       map[string]json.RawMessage `json:"env"`
			State     string                     `json:"state"`
			ToolCount *int                       `json:"toolCount"`
		} `json:"servers"`
	}
	if err := json.Unmarshal([]byte(data), &file); err != nil {
		t.Fatal(err)
	}
	got := file.Servers["stitch"]
	if file.Version != 1 || got.Transport != "stdio" || got.Command != "npx" || !reflect.DeepEqual(got.Args, []string{"stitch-mcp"}) || !keychainRef(got.Env["API_KEY"]) {
		t.Fatalf("mcp.json %s", data)
	}
	if keychain["crewdeck-runner/mcp:stitch:env:API_KEY"] != "s3cr3t" {
		t.Fatalf("keychain %v", keychain)
	}
	resolved, err := store.Resolve("stitch")
	if err != nil || !reflect.DeepEqual(resolved, stitch()) {
		t.Fatalf("Resolve = %+v, %v", resolved, err)
	}
}

func TestWithoutAKeychainTheValueIsInTheFileAndNowhereElse(t *testing.T) {
	store := Store{Keyring: absentKeyring{}, Dir: t.TempDir()}
	figma := Server{Name: "figma", Transport: TransportHTTP, URL: "https://mcp.figma.test/mcp", Headers: map[string]string{"Authorization": "Bearer x"}}
	if err := store.Add(figma); err != nil {
		t.Fatal(err)
	}
	data, _ := readFile(t, store.Dir)
	if !strings.Contains(data, `"value": "Bearer x"`) {
		t.Fatalf("mcp.json %s", data)
	}
	entries, _ := os.ReadDir(store.Dir)
	for _, entry := range entries {
		if entry.Name() == FileName {
			continue
		}
		// Only mcp.json's lock, which holds nothing.
		if info, err := entry.Info(); err != nil || entry.Name() != FileName+".lock" || info.Size() != 0 {
			t.Fatalf("the Runner's folder holds %v, want mcp.json and its empty lock only", entries)
		}
	}
	resolved, err := store.Resolve("figma")
	if err != nil || !reflect.DeepEqual(resolved, figma) {
		t.Fatalf("Resolve = %+v, %v", resolved, err)
	}
}

func TestAnExistingNameIsRefusedAndRemoveDeletesItsKeychainEntries(t *testing.T) {
	keychain := memoryKeyring{"crewdeck-runner/codex": "sk-proj"}
	store := Store{Keyring: keychain, Dir: t.TempDir()}
	if err := store.Add(stitch()); err != nil {
		t.Fatal(err)
	}
	if err := store.Add(stitch()); !errors.Is(err, ErrExists) {
		t.Fatalf("Add twice = %v, want ErrExists", err)
	}
	if err := store.Remove("stitch"); err != nil {
		t.Fatal(err)
	}
	if len(keychain) != 1 || keychain["crewdeck-runner/codex"] != "sk-proj" {
		t.Fatalf("keychain after remove %v", keychain)
	}
	if names, err := store.Names(); err != nil || len(names) != 0 {
		t.Fatalf("Names = %v, %v", names, err)
	}
	if err := store.Remove("stitch"); !errors.Is(err, ErrUnknown) {
		t.Fatalf("Remove twice = %v, want ErrUnknown", err)
	}
}

// refusingKeyring holds its entries and refuses to delete them (a locked keychain).
type refusingKeyring struct{ memoryKeyring }

func (refusingKeyring) Delete(string, string) error { return errors.New("the keychain is locked") }

func TestAKeychainThatRefusesKeepsTheDeclaration(t *testing.T) {
	dir := t.TempDir()
	keychain := memoryKeyring{}
	if err := (Store{Keyring: keychain, Dir: dir}).Add(stitch()); err != nil {
		t.Fatal(err)
	}
	locked := Store{Keyring: refusingKeyring{keychain}, Dir: dir}
	if err := locked.Remove("stitch"); err == nil {
		t.Fatal("Remove with a keychain that refuses succeeded")
	}
	if err := locked.DeleteSecrets(); err == nil {
		t.Fatal("DeleteSecrets with a keychain that refuses succeeded")
	}
	if names, _ := locked.Names(); !reflect.DeepEqual(names, []string{"stitch"}) {
		t.Fatalf("Names = %v, want stitch kept", names)
	}
	if err := (Store{Keyring: keychain, Dir: dir}).DeleteSecrets(); err != nil || len(keychain) != 0 {
		t.Fatalf("DeleteSecrets = %v, keychain %v", err, keychain)
	}
}

func TestATestRecordsItsStateAndTheListGivesNoSecret(t *testing.T) {
	store := Store{Keyring: memoryKeyring{}, Dir: t.TempDir()}
	if err := store.Add(stitch()); err != nil {
		t.Fatal(err)
	}
	if err := store.Add(Server{Name: "figma", Transport: TransportHTTP, URL: "https://x.test", Headers: map[string]string{"Authorization": "Bearer x"}}); err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 11, 14, 9, 0, 0, 0, time.UTC)
	twelve := 12
	if err := store.Record("stitch", &twelve, at); err != nil {
		t.Fatal(err)
	}
	if err := store.Record("figma", nil, at); err != nil {
		t.Fatal(err)
	}
	declared, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(declared) != 2 || declared[0].Name != "figma" || declared[0].State != StateFailed || declared[0].ToolCount != nil ||
		declared[1].Name != "stitch" || declared[1].State != StateReady || *declared[1].ToolCount != 12 || !declared[1].TestedAt.Equal(at) {
		t.Fatalf("Load = %+v", declared)
	}
	if err := store.Record("absent", nil, at); !errors.Is(err, ErrUnknown) {
		t.Fatalf("Record of an unknown name = %v", err)
	}
}

func TestNoFileIsNoServer(t *testing.T) {
	store := Store{Keyring: memoryKeyring{}, Dir: t.TempDir()}
	if declared, err := store.Load(); err != nil || len(declared) != 0 {
		t.Fatalf("Load = %v, %v", declared, err)
	}
	if _, err := store.Resolve("stitch"); !errors.Is(err, ErrUnknown) {
		t.Fatalf("Resolve = %v", err)
	}
}

func keychainRef(raw json.RawMessage) bool {
	var ref map[string]any
	return json.Unmarshal(raw, &ref) == nil && len(ref) == 1 && ref["keychain"] == true
}

func TestTheReportHoldsNamesTransportsStatesAndCountsOnly(t *testing.T) {
	store := Store{Keyring: memoryKeyring{}, Dir: t.TempDir()}
	if err := store.Add(stitch()); err != nil {
		t.Fatal(err)
	}
	if err := store.Add(Server{Name: "figma", Transport: TransportHTTP, URL: "https://mcp.figma.test/mcp", Headers: map[string]string{"Authorization": "Bearer x"}}); err != nil {
		t.Fatal(err)
	}
	four := 4
	if err := store.Record("figma", &four, time.Now()); err != nil {
		t.Fatal(err)
	}
	declared, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(Report(declared))
	if err != nil {
		t.Fatal(err)
	}
	want := `[{"name":"figma","state":"ready","toolCount":4,"transport":"http"},{"name":"stitch","state":"failed","toolCount":null,"transport":"stdio"}]`
	if string(data) != want {
		t.Fatalf("report %s, want %s", data, want)
	}
}

// syncKeyring is a keychain that answers, safe for concurrent use.
type syncKeyring struct {
	mu sync.Mutex
	memoryKeyring
}

func (k *syncKeyring) Get(service, user string) (string, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	return k.memoryKeyring.Get(service, user)
}

func (k *syncKeyring) Set(service, user, secret string) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	return k.memoryKeyring.Set(service, user, secret)
}

func (k *syncKeyring) Delete(service, user string) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	return k.memoryKeyring.Delete(service, user)
}

func TestConcurrentCommandsLoseNoDeclaration(t *testing.T) {
	dir := t.TempDir()
	keychain := &syncKeyring{memoryKeyring: memoryKeyring{}}
	if err := (Store{Keyring: keychain, Dir: dir}).Add(stitch()); err != nil {
		t.Fatal(err)
	}
	const adds = 24
	var wg sync.WaitGroup
	errs := make(chan error, 2*adds)
	for i := range adds {
		wg.Add(2)
		go func() {
			defer wg.Done()
			// Each command is its own process: its own Store, the same folder.
			server := stitch()
			server.Name = fmt.Sprintf("server-%02d", i)
			errs <- (Store{Keyring: keychain, Dir: dir}).Add(server)
		}()
		go func() {
			defer wg.Done()
			count := i
			errs <- (Store{Keyring: keychain, Dir: dir}).Record("stitch", &count, time.Now())
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	names, err := (Store{Keyring: keychain, Dir: dir}).Names()
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != adds+1 {
		t.Fatalf("%d declarations kept, want %d: %v", len(names), adds+1, names)
	}
	declared, _ := (Store{Keyring: keychain, Dir: dir}).Load()
	if declared[len(declared)-1].Name != "stitch" || declared[len(declared)-1].State != StateReady {
		t.Fatalf("stitch lost its test: %+v", declared[len(declared)-1])
	}
}

// lockingKeyring stores its entries, then makes the Runner's folder read-only
// (a full disk, a crash before the file is written), and refuses to delete.
type lockingKeyring struct {
	memoryKeyring
	dir string
}

func (k lockingKeyring) Set(service, user, secret string) error {
	k.memoryKeyring[service+"/"+user] = secret
	return os.Chmod(k.dir, 0o500)
}

func (lockingKeyring) Delete(string, string) error { return errors.New("the keychain is locked") }

func TestAKeychainEntryIsNeverWithoutADeclarationThatReachesIt(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "crewdeck")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })
	keychain := memoryKeyring{}
	if err := (Store{Keyring: lockingKeyring{keychain, dir}, Dir: dir}).Add(stitch()); err == nil {
		t.Fatal("Add succeeded with a folder that refuses its file")
	}
	if len(keychain) == 0 {
		t.Fatal("the keychain was not written: the test proves nothing")
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	store := Store{Keyring: keychain, Dir: dir}
	if names, _ := store.Names(); !reflect.DeepEqual(names, []string{"stitch"}) {
		t.Fatalf("Names = %v, want stitch, whose keychain entry Remove must reach", names)
	}
	if err := store.Remove("stitch"); err != nil {
		t.Fatal(err)
	}
	if len(keychain) != 0 {
		t.Fatalf("keychain %v, want nothing left", keychain)
	}
}

func TestTheServerAfterTheLastOneTheProtocolCarriesIsRefusedBeforeItsSecrets(t *testing.T) {
	keychain := memoryKeyring{}
	store := Store{Keyring: absentKeyring{}, Dir: t.TempDir()}
	for i := range MaxServers {
		server := stitch()
		server.Name = fmt.Sprintf("server-%03d", i)
		if err := store.Add(server); err != nil {
			t.Fatal(err)
		}
	}
	store.Keyring = keychain
	if err := store.Add(stitch()); !errors.Is(err, ErrTooMany) {
		t.Fatalf("Add of server %d = %v, want ErrTooMany", MaxServers+1, err)
	}
	if len(keychain) != 0 {
		t.Fatalf("keychain %v, want nothing written", keychain)
	}
	if names, _ := store.Names(); len(names) != MaxServers {
		t.Fatalf("%d declarations, want %d", len(names), MaxServers)
	}
	if err := store.Remove("server-000"); err != nil {
		t.Fatal(err)
	}
	if err := store.Add(stitch()); err != nil {
		t.Fatalf("Add once back under the limit = %v", err)
	}
}
