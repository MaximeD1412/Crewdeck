package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/claude/control"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/claude/hook"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/claude/permission"
	"github.com/spf13/cobra"
)

// exitError ends the command with its code instead of 1 (a hook's 2 blocks
// the tool call, its message read by Claude).
type exitError struct {
	code int
	err  error
}

func (e *exitError) Error() string { return e.err.Error() }
func (e *exitError) Unwrap() error { return e.err }

// sessionFlags are the flags of the commands Claude Code runs for a Session:
// --session, and --control, the Session's control socket (by default the
// one of the Runner's state folder).
type sessionFlags struct{ session, control string }

func (f *sessionFlags) add(command *cobra.Command) {
	command.Flags().StringVar(&f.session, "session", "", "the Session's id")
	command.Flags().StringVar(&f.control, "control", "", "the Session's control socket (default ~/.crewdeck/sessions/<id>/control.sock)")
	_ = command.MarkFlagRequired("session")
}

func (f *sessionFlags) ask() (func(context.Context, control.Request) (control.Reply, error), error) {
	socket := f.control
	if socket == "" {
		var err error
		if socket, err = control.DefaultSocket(f.session); err != nil {
			return nil, err
		}
	}
	return func(ctx context.Context, r control.Request) (control.Reply, error) {
		return control.Ask(ctx, socket, r)
	}, nil
}

// newMCPCommand is `crewdeck-runner mcp permission`, hidden: the MCP server
// of `--permission-prompt-tool`, which Claude Code starts for a Session.
func newMCPCommand() *cobra.Command {
	command := &cobra.Command{Use: "mcp", Short: "MCP servers Claude Code runs for a Session", Hidden: true, Args: cobra.NoArgs}
	var flags sessionFlags
	serve := &cobra.Command{
		Use:   "permission",
		Short: "Serve the permission tool on stdio, its requests sent to the Session's adapter",
		Args:  cobra.NoArgs,
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
	command.AddCommand(serve)
	return command
}

// newHookCommand is `crewdeck-runner hook pre-tool-use`, hidden: Claude
// Code's `PreToolUse` hook, which holds an `AskUserQuestion` until the
// Pilote answers.
func newHookCommand() *cobra.Command {
	command := &cobra.Command{Use: "hook", Short: "Hooks Claude Code runs for a Session", Hidden: true, Args: cobra.NoArgs}
	var flags sessionFlags
	preToolUse := &cobra.Command{
		Use:   "pre-tool-use",
		Short: "Send an AskUserQuestion to the Session's adapter and give Claude the Pilote's answers",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			ask, err := flags.ask()
			if err == nil {
				err = hook.PreToolUse(cmd.Context(), cmd.InOrStdin(), cmd.OutOrStdout(), ask)
			}
			if err != nil {
				return &exitError{code: 2, err: fmt.Errorf("Le Runner n’a pas pu transmettre la question au Pilote : %w", err)}
			}
			return nil
		},
	}
	flags.add(preToolUse)
	command.AddCommand(preToolUse)
	return command
}

// exitCode is the code a command's error ends the process with.
func exitCode(err error) int {
	var exit *exitError
	if errors.As(err, &exit) {
		return exit.code
	}
	return 1
}
