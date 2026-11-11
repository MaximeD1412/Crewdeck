// Package service installs and starts the Runner as a user service (ADR
// 0004): a systemd --user unit on Linux and WSL, a launchd agent on macOS.
// On WSL without systemd it says how to enable it, and that `crewdeck-runner
// run` works in the foreground.
package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Name is the service's name: the systemd unit's and, prefixed, launchd's label.
const Name = "crewdeck-runner"

// Label is the launchd agent's label.
const Label = "com.crewdeck.runner"

// Exec runs a command (systemctl, launchctl) and returns its combined output.
type Exec func(ctx context.Context, name string, args ...string) ([]byte, error)

// Config is the machine the service is installed on; Detect fills it.
type Config struct {
	// OS is runtime.GOOS: linux or darwin.
	OS string
	// Home is the Pilote's home folder.
	Home string
	// WSL is true on Windows through WSL.
	WSL bool
	// Systemd is true when systemd runs this machine (/run/systemd/system).
	Systemd bool
	// UID is the Pilote's user id, for launchd's gui/<uid> domain.
	UID int
	// Path is the PATH the service runs with: the one the Moteurs were found on.
	Path string
	// Exec runs systemctl and launchctl; exec.CommandContext by default.
	Exec Exec
}

// Outcome is what Install did.
type Outcome struct {
	// Started is true when the service runs; false when the Pilote must
	// enable systemd first (Help says how).
	Started bool
	// File is the unit or the plist written.
	File string
	// Help is what to tell the Pilote when the service could not be started.
	Help string
}

// Detect describes this machine.
func Detect(goos string, wsl bool) (Config, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Config{}, fmt.Errorf("service: home folder: %w", err)
	}
	_, err = os.Stat("/run/systemd/system")
	return Config{
		OS:      goos,
		Home:    home,
		WSL:     wsl,
		Systemd: err == nil,
		UID:     os.Getuid(),
		Path:    os.Getenv("PATH"),
		Exec:    run,
	}, nil
}

func run(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

// Binary is where install.sh puts the Runner, the service runs it from there.
func Binary(home string) string {
	return filepath.Join(home, ".local", "bin", Name)
}

// WSLHelp says how to run the Runner on a WSL without systemd.
const WSLHelp = "systemd n’est pas activé dans ce WSL : le Runner ne peut pas s’installer comme service.\n" +
	"Pour l’activer, ajoute à /etc/wsl.conf :\n" +
	"  [boot]\n" +
	"  systemd=true\n" +
	"puis lance « wsl --shutdown » dans Windows, rouvre ton terminal WSL et relance la commande d’installation avec un nouveau code.\n" +
	"En attendant, « crewdeck-runner run » fait tourner le Runner au premier plan."

// NoSystemdHelp says how to run the Runner on a Linux without systemd.
const NoSystemdHelp = "systemd ne fait pas tourner cette machine : le Runner ne peut pas s’installer comme service.\n" +
	"Lance-le au premier plan avec « crewdeck-runner run »."

// Install writes the service's file, then enables and starts it (restarting
// one already running, so it reads the new runner.json).
func Install(ctx context.Context, cfg Config) (Outcome, error) {
	if cfg.Exec == nil {
		cfg.Exec = run
	}
	switch cfg.OS {
	case "linux":
		if !cfg.Systemd {
			if cfg.WSL {
				return Outcome{Help: WSLHelp}, nil
			}
			return Outcome{Help: NoSystemdHelp}, nil
		}
		return installSystemd(ctx, cfg)
	case "darwin":
		return installLaunchd(ctx, cfg)
	}
	return Outcome{}, fmt.Errorf("service: %s is not supported", cfg.OS)
}

// UnitPath is the systemd --user unit's path.
func UnitPath(home string) string {
	return filepath.Join(home, ".config", "systemd", "user", Name+".service")
}

// Unit is the systemd --user unit.
func Unit(path string) string {
	var unit strings.Builder
	unit.WriteString("[Unit]\nDescription=Crewdeck Runner\n\n[Service]\n")
	if path != "" {
		fmt.Fprintf(&unit, "Environment=\"PATH=%s\"\n", systemdEscape(path))
	}
	unit.WriteString("ExecStart=%h/.local/bin/" + Name + " run\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n")
	return unit.String()
}

func systemdEscape(value string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`, "%", "%%", "\n", " ").Replace(value)
}

func installSystemd(ctx context.Context, cfg Config) (Outcome, error) {
	file := UnitPath(cfg.Home)
	if err := write(file, Unit(cfg.Path)); err != nil {
		return Outcome{}, err
	}
	// Was it running before? Then it restarts, to read the new runner.json.
	_, inactive := cfg.Exec(ctx, "systemctl", "--user", "is-active", "--quiet", Name+".service")
	steps := [][]string{
		{"systemctl", "--user", "daemon-reload"},
		{"systemctl", "--user", "enable", "--now", Name + ".service"},
	}
	if inactive == nil {
		steps = append(steps, []string{"systemctl", "--user", "restart", Name + ".service"})
	}
	if err := runAll(ctx, cfg.Exec, steps); err != nil {
		return Outcome{File: file}, err
	}
	return Outcome{Started: true, File: file}, nil
}

// PlistPath is the launchd agent's path.
func PlistPath(home string) string {
	return filepath.Join(home, "Library", "LaunchAgents", Label+".plist")
}

// Plist is the launchd agent: it runs `crewdeck-runner run` at login and
// again when it fails.
func Plist(home, path string) string {
	var env string
	if path != "" {
		env = "\t<key>EnvironmentVariables</key>\n\t<dict>\n\t\t<key>PATH</key>\n\t\t<string>" + xmlEscape(path) + "</string>\n\t</dict>\n"
	}
	log := xmlEscape(filepath.Join(home, ".crewdeck", "runner.log"))
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>` + Label + `</string>
	<key>ProgramArguments</key>
	<array>
		<string>` + xmlEscape(Binary(home)) + `</string>
		<string>run</string>
	</array>
` + env + `	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>StandardOutPath</key>
	<string>` + log + `</string>
	<key>StandardErrorPath</key>
	<string>` + log + `</string>
</dict>
</plist>
`
}

func xmlEscape(value string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;").Replace(value)
}

func installLaunchd(ctx context.Context, cfg Config) (Outcome, error) {
	file := PlistPath(cfg.Home)
	if err := write(file, Plist(cfg.Home, cfg.Path)); err != nil {
		return Outcome{}, err
	}
	domain := fmt.Sprintf("gui/%d", cfg.UID)
	// An agent already loaded is removed first: bootstrap refuses it, and the
	// new one reads the new runner.json.
	_, _ = cfg.Exec(ctx, "launchctl", "bootout", domain+"/"+Label)
	if err := runAll(ctx, cfg.Exec, [][]string{{"launchctl", "bootstrap", domain, file}}); err != nil {
		return Outcome{File: file}, err
	}
	return Outcome{Started: true, File: file}, nil
}

func write(file, content string) error {
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return fmt.Errorf("service: create %s: %w", filepath.Dir(file), err)
	}
	if err := os.WriteFile(file, []byte(content), 0o644); err != nil {
		return fmt.Errorf("service: write %s: %w", file, err)
	}
	return nil
}

func runAll(ctx context.Context, execute Exec, steps [][]string) error {
	for _, step := range steps {
		if out, err := execute(ctx, step[0], step[1:]...); err != nil {
			detail := strings.TrimSpace(string(out))
			if detail != "" {
				err = errors.New(detail)
			}
			return fmt.Errorf("%s: %w", strings.Join(step, " "), err)
		}
	}
	return nil
}
