// Command crewdeck-runner is the Runner: it runs the agents' Sessions on the
// Pilote's machine for the Crewdeck server (ADR 0004).
package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// version is set at build time with -ldflags "-X main.version=<v>".
var version = "dev"

func newRootCommand() *cobra.Command {
	root := &cobra.Command{
		Use:           "crewdeck-runner",
		Short:         "Runs the agents' Sessions for the Crewdeck server",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.AddCommand(&cobra.Command{
		Use:   "version",
		Short: "Print the Runner's version",
		Args:  cobra.NoArgs,
		Run: func(cmd *cobra.Command, _ []string) {
			fmt.Fprintln(cmd.OutOrStdout(), version)
		},
	})
	return root
}

func main() {
	if err := newRootCommand().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
