package main

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
	"github.com/spf13/cobra"
)

// deviceCodePrefix starts the text of a new Appareil's QR code.
const deviceCodePrefix = "crewdeck:appareil:"

var (
	errDeviceCode     = errors.New("Ce code n’est pas celui d’un nouvel Appareil : copie le code entier affiché sur le nouvel Appareil (4 + 26 caractères).")
	errDeviceMismatch = errors.New("La preuve du nouvel Appareil ne correspond pas à son code : rien n’a été approuvé. Affiche un nouveau code sur le nouvel Appareil.")
	errNotLinked      = errors.New("Ce Runner n’est pas relié à ton compte : relie-le avec la commande que donne Crewdeck, crewdeck-runner link <code>.")
)

// approver approves a new Appareil from this machine, as its Runner; its
// fields are what tests replace.
type approver struct {
	server string
	http   *http.Client
	store  state.Store
	in     io.Reader
	out    io.Writer
}

func newDevicesCommand(server *string) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "appareils",
		Short: "The Pilote's Appareils, the browsers that read the encrypted data",
		Args:  cobra.NoArgs,
	}
	cmd.AddCommand(&cobra.Command{
		Use:   "approuver <code>",
		Short: "Approve a new Appareil with the code it shows: the Runner wraps the vault key for it",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			store, err := state.Default()
			if err != nil {
				return err
			}
			a := &approver{server: *server, http: &http.Client{Timeout: 10 * time.Second}, store: store, in: cmd.InOrStdin(), out: cmd.OutOrStdout()}
			return a.approve(cmd.Context(), args[0])
		},
	})
	return cmd
}

// parseDeviceCode reads `<shortId>-<secret>` from what the Pilote pasted
// (the QR's prefix, spaces and case aside): the short id and the secret's
// 16 bytes.
func parseDeviceCode(raw string) (string, []byte, error) {
	text := strings.TrimSpace(raw)
	if strings.HasPrefix(strings.ToLower(text), deviceCodePrefix) {
		text = text[len(deviceCodePrefix):]
	}
	text = strings.ToUpper(strings.Join(strings.Fields(text), ""))
	if !linkCode.MatchString(text) {
		return "", nil, errDeviceCode
	}
	secret, err := keys.DecodeBase32(text[5:])
	if err != nil || len(secret) != 16 {
		return "", nil, errDeviceCode
	}
	return text[:4], secret, nil
}

// printable drops what a terminal would read as a command from a name the
// server relays.
func printable(name string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, name)
}

// approve runs docs/security/e2e.md « New Appareil » as the approver: the
// pending Appareil of the code, its proof checked with the code's secret, the
// Pilote's yes, then the vault key wrapped for its public key and proof_A.
func (a *approver) approve(ctx context.Context, raw string) error {
	shortID, secret, err := parseDeviceCode(raw)
	if err != nil {
		return err
	}
	defer clear(secret)
	linked, err := a.store.Load()
	if errors.Is(err, state.ErrNotLinked) {
		return errNotLinked
	}
	if err != nil {
		return err
	}
	server := strings.TrimRight(a.server, "/")
	if server == "" {
		server = strings.TrimRight(linked.Server, "/")
	}
	if u, err := url.Parse(server); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("Le serveur %q n’est pas une adresse http(s).", server)
	}
	vault, err := openVault(a.store)
	if err != nil {
		return err
	}
	raw32, err := a.store.LoadRunnerKey()
	if err != nil {
		return errVaultClosed
	}
	runnerKey, err := ecdh.X25519().NewPrivateKey(raw32)
	if err != nil {
		return errVaultClosed
	}

	var device contracts.RunnerPendingDevice
	if err := a.call(ctx, server, linked.Token, http.MethodGet, "/api/runner/devices/pending/"+url.PathEscape(shortID), nil, &device); err != nil {
		return err
	}
	b64 := base64.RawURLEncoding
	newKey, keyErr := b64.DecodeString(device.PublicKey)
	proof, proofErr := b64.DecodeString(device.Proof)
	if keyErr != nil || proofErr != nil || len(newKey) != 32 || !keys.VerifyNewDeviceProof(proof, secret, newKey) {
		return errDeviceMismatch
	}

	name := printable(device.Name)
	fmt.Fprintf(a.out, "Approuver « %s » ? (o/N) ", name)
	if !accepted(a.in) {
		fmt.Fprintln(a.out, "Rien n’a été approuvé.")
		return nil
	}

	wrap, err := vault.WrapFor(runnerKey, newKey, device.Id)
	if err != nil {
		return err
	}
	body := contracts.RunnerApproveDevice{
		Approver:        contracts.RunnerApproveDeviceApprover{Type: contracts.RunnerApproveDeviceApproverTypeRunner, Id: linked.RunnerID},
		VaultKeyVersion: vault.Version,
		Wrap:            contracts.RunnerApproveDeviceWrap{Enc: b64.EncodeToString(wrap.Enc), Ciphertext: b64.EncodeToString(wrap.Ciphertext), Tag: b64.EncodeToString(wrap.Tag)},
		Proof:           b64.EncodeToString(keys.ApproveDeviceProof(secret, newKey, keys.PublicKeyBytes(runnerKey))),
	}
	if err := a.call(ctx, server, linked.Token, http.MethodPost, "/api/runner/devices/"+url.PathEscape(device.Id)+"/approve", body, nil); err != nil {
		return err
	}
	fmt.Fprintf(a.out, "« %s » est approuvé : il lit maintenant tes Sessions et le texte de tes Idées.\n", name)
	return nil
}

// call sends one request with the Runner's token and decodes its answer, or
// says the server's message.
func (a *approver) call(ctx context.Context, server, token, method, path string, body, into any) error {
	var payload io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		payload = bytes.NewReader(data)
	}
	request, err := http.NewRequestWithContext(ctx, method, server+path, payload)
	if err != nil {
		return err
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("User-Agent", "crewdeck-runner/"+version)
	response, err := a.http.Do(request)
	if err != nil {
		return fmt.Errorf("Le serveur %s ne répond pas : vérifie ta connexion, puis relance la commande.", server)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return err
	}
	if response.StatusCode == http.StatusOK {
		if into == nil {
			return nil
		}
		if err := json.Unmarshal(data, into); err != nil {
			return fmt.Errorf("Réponse inattendue du serveur %s : %v", server, err)
		}
		return nil
	}
	var envelope contracts.ErrorEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil || envelope.Message == "" {
		return fmt.Errorf("Le serveur a répondu %d.", response.StatusCode)
	}
	return errors.New(envelope.Message)
}
