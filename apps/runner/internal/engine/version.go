package engine

import (
	"regexp"
	"strconv"
	"strings"
)

// KnownVersions are the versions of a Moteur its adapter was tested on: a
// list of ranges, each comparators separated by spaces (`>=2.1 <2.3`,
// `=3.0.1`), a version being known when it is in one of them. Outside, the
// adapter still runs, and its Capabilities says `knownVersion: false` (risk
// IA-3): the Runner shows it in its state.
type KnownVersions []string

// Contains says whether the version is in one of the ranges. A malformed
// range contains nothing.
func (k KnownVersions) Contains(version string) bool {
	v, ok := parseVersion(version)
	if !ok {
		return false
	}
	for _, r := range k {
		if inRange(v, r) {
			return true
		}
	}
	return false
}

var versionInText = regexp.MustCompile(`\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?`)

// ParseVersion reads the first version of what a Moteur prints for
// `--version` (`2.1.319 (Claude Code)`, `codex-cli 0.167.1`).
func ParseVersion(output string) (string, bool) {
	found := versionInText.FindString(output)
	return found, found != ""
}

type version struct {
	parts      []int
	prerelease string
}

func parseVersion(s string) (version, bool) {
	s = strings.TrimPrefix(strings.TrimSpace(s), "v")
	core, pre, _ := strings.Cut(s, "-")
	if core == "" {
		return version{}, false
	}
	var v version
	for _, part := range strings.Split(core, ".") {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return version{}, false
		}
		v.parts = append(v.parts, n)
	}
	v.prerelease = pre
	return v, true
}

// compare orders two versions as semver does, the missing parts 0 and a
// prerelease below its release (prereleases between themselves as text).
func compare(a, b version) int {
	for i := range max(len(a.parts), len(b.parts)) {
		x, y := part(a.parts, i), part(b.parts, i)
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	switch {
	case a.prerelease == b.prerelease:
		return 0
	case a.prerelease == "":
		return 1
	case b.prerelease == "":
		return -1
	}
	return strings.Compare(a.prerelease, b.prerelease)
}

func part(parts []int, i int) int {
	if i < len(parts) {
		return parts[i]
	}
	return 0
}

var comparator = regexp.MustCompile(`^(>=|<=|>|<|=)(.+)$`)

func inRange(v version, r string) bool {
	fields := strings.Fields(r)
	if len(fields) == 0 {
		return false
	}
	for _, field := range fields {
		m := comparator.FindStringSubmatch(field)
		if m == nil {
			return false
		}
		bound, ok := parseVersion(m[2])
		if !ok {
			return false
		}
		c := compare(v, bound)
		if !map[string]bool{">=": c >= 0, "<=": c <= 0, ">": c > 0, "<": c < 0, "=": c == 0}[m[1]] {
			return false
		}
	}
	return true
}
