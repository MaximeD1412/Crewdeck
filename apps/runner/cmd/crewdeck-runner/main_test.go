package main

import (
	"bytes"
	"testing"
)

func TestVersionPrintsTheBuildVersion(t *testing.T) {
	previous := version
	version = "1.2.3"
	t.Cleanup(func() { version = previous })

	var out bytes.Buffer
	root := newRootCommand()
	root.SetOut(&out)
	root.SetArgs([]string{"version"})

	if err := root.Execute(); err != nil {
		t.Fatalf("version: %v", err)
	}
	if got := out.String(); got != "1.2.3\n" {
		t.Fatalf("version printed %q, want %q", got, "1.2.3\n")
	}
}

func TestVersionDefaultsToDev(t *testing.T) {
	if version != "dev" {
		t.Fatalf("default version is %q, want %q", version, "dev")
	}
}
