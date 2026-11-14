package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/accounts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/claude/permission"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mcp"
	"github.com/spf13/cobra"
)

const mcpNameRule = "Un nom de Serveur MCP s’écrit en minuscules, chiffres et tirets, 40 caractères au plus."

// mcpCLI declares the Serveurs MCP of this Runner (US-73, ADR 0013); its
// fields are what tests replace.
type mcpCLI struct {
	out   io.Writer
	store mcp.Store
	// list starts or reaches a server and lists its tools.
	list func(context.Context, mcp.Server) ([]mcp.Tool, error)
	// refresh asks the running Runner to report again; nil when none runs.
	refresh func(context.Context) error
	now     func() time.Time
}

func newMCPCLI(cmd *cobra.Command) (*mcpCLI, error) {
	store, err := mcp.Default()
	if err != nil {
		return nil, err
	}
	socket, err := accounts.DefaultSocket()
	if err != nil {
		return nil, err
	}
	return &mcpCLI{
		out:   cmd.OutOrStdout(),
		store: store,
		list:  mcp.ListTools,
		refresh: func(ctx context.Context) error {
			_, err := accounts.Refresh(ctx, socket)
			return err
		},
		now: time.Now,
	}, nil
}

// usage ends a command with exit code 2: what was typed cannot be run.
func usage(format string, args ...any) error {
	return &exitError{code: 2, err: fmt.Errorf(format, args...)}
}

// newMCPCommand is `crewdeck-runner mcp`: add, list, remove and test the
// Serveurs MCP, and, hidden, `permission`, the MCP server Claude Code runs
// for a Session.
func newMCPCommand() *cobra.Command { return mcpCommand(newMCPCLI) }

func mcpCommand(newCLI func(*cobra.Command) (*mcpCLI, error)) *cobra.Command {
	command := &cobra.Command{
		Use:   "mcp",
		Short: "Declare the Serveurs MCP the agents may use, their secrets kept on this machine",
		Args:  cobra.NoArgs,
	}
	with := func(run func(*mcpCLI, *cobra.Command, []string) error) func(*cobra.Command, []string) error {
		return func(cmd *cobra.Command, args []string) error {
			cli, err := newCLI(cmd)
			if err != nil {
				return err
			}
			return run(cli, cmd, args)
		}
	}

	var flags struct {
		env, headers []string
		url          string
	}
	add := &cobra.Command{
		Use:   "add <nom> [--env K=V]… -- <commande> [args…] | add <nom> --url <url> [--header 'K: V']…",
		Short: "Declare a Serveur MCP, stdio or streamable HTTP, then test it",
		Args:  cobra.MinimumNArgs(1),
		RunE: with(func(cli *mcpCLI, cmd *cobra.Command, args []string) error {
			server, err := parseServer(args[0], args[1:], flags.env, flags.url, flags.headers)
			if err != nil {
				return err
			}
			return cli.add(cmd.Context(), server)
		}),
	}
	add.Flags().StringArrayVar(&flags.env, "env", nil, "an environment variable of a stdio server, K=V (its value kept in the keychain)")
	add.Flags().StringVar(&flags.url, "url", "", "the address of a streamable HTTP server")
	add.Flags().StringArrayVar(&flags.headers, "header", nil, "a header of an HTTP server, 'K: V' (its value kept in the keychain)")

	var asJSON bool
	list := &cobra.Command{
		Use:   "list",
		Short: "List the Serveurs MCP declared on this Runner, never a secret",
		Args:  cobra.NoArgs,
		RunE:  with(func(cli *mcpCLI, _ *cobra.Command, _ []string) error { return cli.printList(asJSON) }),
	}
	list.Flags().BoolVar(&asJSON, "json", false, "print [{ name, transport, state, toolCount }]")

	remove := &cobra.Command{
		Use:   "remove <nom>",
		Short: "Remove a Serveur MCP and its secrets from this machine",
		Args:  cobra.ExactArgs(1),
		RunE:  with(func(cli *mcpCLI, cmd *cobra.Command, args []string) error { return cli.remove(cmd.Context(), args[0]) }),
	}
	test := &cobra.Command{
		Use:   "test <nom>",
		Short: "Start or reach a Serveur MCP and list its tools",
		Args:  cobra.ExactArgs(1),
		RunE:  with(func(cli *mcpCLI, cmd *cobra.Command, args []string) error { return cli.test(cmd.Context(), args[0]) }),
	}
	command.AddCommand(add, list, remove, test, newPermissionCommand())
	return command
}

// newPermissionCommand is `crewdeck-runner mcp permission`, hidden: the MCP
// server of `--permission-prompt-tool`, which Claude Code starts for a Session.
func newPermissionCommand() *cobra.Command {
	var flags sessionFlags
	serve := &cobra.Command{
		Use:    "permission",
		Short:  "Serve the permission tool on stdio, its requests sent to the Session's adapter",
		Hidden: true,
		Args:   cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			ask, err := flags.ask()
			if err != nil {
				return err
			}
			server := &permission.Server{Ask: ask, Version: version}
			return server.Serve(cmd.Context(), cmd.InOrStdin(), cmd.OutOrStdout())
		},
	}
	flags.add(serve)
	return serve
}

// parseServer reads `add`'s arguments into a declaration, or says in French
// what is wrong with them (exit 2).
func parseServer(name string, command, env []string, address string, headers []string) (mcp.Server, error) {
	if name == permission.ServerName {
		return mcp.Server{}, usage("%s est le nom du serveur de permissions du Runner : choisis-en un autre.", name)
	}
	if !mcp.Name.MatchString(name) {
		return mcp.Server{}, usage(mcpNameRule)
	}
	server := mcp.Server{Name: name}
	switch {
	case address != "" && len(command) > 0:
		return mcp.Server{}, usage("Donne soit --url <url>, soit -- <commande> [args…], pas les deux.")
	case address == "" && len(command) == 0:
		return mcp.Server{}, usage("Donne la commande du serveur après -- (crewdeck-runner mcp add <nom> -- <commande>), ou son adresse avec --url.")
	case address != "":
		if len(env) > 0 {
			return mcp.Server{}, usage("--env est pour un serveur stdio : un serveur HTTP prend --header.")
		}
		parsed, err := url.Parse(address)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return mcp.Server{}, usage("--url attend une adresse http:// ou https://.")
		}
		server.Transport, server.URL = mcp.TransportHTTP, address
		for _, header := range headers {
			k, v, ok := strings.Cut(header, ":")
			if !ok || strings.TrimSpace(k) == "" {
				return mcp.Server{}, usage("--header attend « Nom: valeur » : « %s » n’a pas de :.", header)
			}
			if server.Headers == nil {
				server.Headers = map[string]string{}
			}
			server.Headers[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	default:
		if len(headers) > 0 {
			return mcp.Server{}, usage("--header est pour un serveur HTTP : un serveur stdio prend --env.")
		}
		server.Transport, server.Command, server.Args = mcp.TransportStdio, command[0], command[1:]
		for _, variable := range env {
			k, v, ok := strings.Cut(variable, "=")
			if !ok || k == "" {
				return mcp.Server{}, usage("--env attend NOM=valeur : « %s » n’a pas de =.", variable)
			}
			if server.Env == nil {
				server.Env = map[string]string{}
			}
			server.Env[k] = v
		}
	}
	return server, nil
}

func notDeclared(name string) error {
	return fmt.Errorf("%s n’est pas déclaré sur ce Runner.", name)
}

func toolCount(n int) string {
	if n == 1 {
		return "1 outil"
	}
	return fmt.Sprintf("%d outils", n)
}

// refreshRunner asks the running Runner to report its Serveurs MCP again; no
// Runner running, the next connection reports them.
func (c *mcpCLI) refreshRunner(ctx context.Context) {
	_ = c.refresh(ctx)
}

// check lists the server's tools and records the outcome.
func (c *mcpCLI) check(ctx context.Context, server mcp.Server) ([]mcp.Tool, error) {
	listed, err := c.list(ctx, server)
	var count *int
	if err == nil {
		n := len(listed)
		count = &n
	}
	if recordErr := c.store.Record(server.Name, count, c.now().UTC()); recordErr != nil {
		return nil, recordErr
	}
	return listed, err
}

func (c *mcpCLI) add(ctx context.Context, server mcp.Server) error {
	if err := c.store.Add(server); errors.Is(err, mcp.ErrExists) {
		return fmt.Errorf("%s est déjà déclaré : crewdeck-runner mcp remove %s d’abord.", server.Name, server.Name)
	} else if err != nil {
		return err
	}
	listed, err := c.check(ctx, server)
	c.refreshRunner(ctx)
	if err != nil {
		return fmt.Errorf("Serveur MCP %s déclaré, mais le test a échoué : %v", server.Name, err)
	}
	fmt.Fprintf(c.out, "Serveur MCP %s déclaré : %s.\n", server.Name, toolCount(len(listed)))
	return nil
}

func (c *mcpCLI) test(ctx context.Context, name string) error {
	server, err := c.store.Resolve(name)
	if errors.Is(err, mcp.ErrUnknown) {
		return notDeclared(name)
	}
	if err != nil {
		return err
	}
	listed, err := c.check(ctx, server)
	c.refreshRunner(ctx)
	if err != nil {
		return fmt.Errorf("Le test de %s a échoué : %v", name, err)
	}
	for _, tool := range listed {
		fmt.Fprintln(c.out, tool.Name)
	}
	return nil
}

func (c *mcpCLI) remove(ctx context.Context, name string) error {
	if err := c.store.Remove(name); errors.Is(err, mcp.ErrUnknown) {
		return notDeclared(name)
	} else if err != nil {
		return fmt.Errorf("%s n’a pas pu être retiré (%v) : déverrouille le trousseau, puis relance « crewdeck-runner mcp remove %s ».", name, err, name)
	}
	c.refreshRunner(ctx)
	fmt.Fprintf(c.out, "Serveur MCP %s retiré.\n", name)
	return nil
}

// printList prints one line per server, its secrets' values as ***.
func (c *mcpCLI) printList(asJSON bool) error {
	declared, err := c.store.Load()
	if err != nil {
		return err
	}
	if asJSON {
		data, err := json.Marshal(mcp.Report(declared))
		if err != nil {
			return err
		}
		fmt.Fprintln(c.out, string(data))
		return nil
	}
	if len(declared) == 0 {
		fmt.Fprintln(c.out, "Aucun Serveur MCP déclaré sur ce Runner.")
		return nil
	}
	rows := make([][]string, len(declared))
	widths := make([]int, 4)
	for i, d := range declared {
		state := "en échec"
		if d.State == mcp.StateReady && d.ToolCount != nil {
			state = toolCount(*d.ToolCount)
		}
		keys := make([]string, len(d.Keys))
		for j, k := range d.Keys {
			if d.Transport == mcp.TransportHTTP {
				keys[j] = k + ": ***"
			} else {
				keys[j] = k + "=***"
			}
		}
		rows[i] = []string{d.Name, string(d.Transport), state, strings.Join(keys, " ")}
		for j, cell := range rows[i] {
			widths[j] = max(widths[j], len([]rune(cell)))
		}
	}
	for _, row := range rows {
		var line strings.Builder
		for j, cell := range row {
			line.WriteString(cell)
			if j < len(row)-1 {
				line.WriteString(strings.Repeat(" ", widths[j]-len([]rune(cell))+2))
			}
		}
		fmt.Fprintln(c.out, strings.TrimRight(line.String(), " "))
	}
	return nil
}
