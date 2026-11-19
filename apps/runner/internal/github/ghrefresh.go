package github

import (
	"regexp"
	"strconv"
	"strings"
)

// Refresh is what the Miroir refreshes after a `gh` command that exited 0
// (ADR 0010, risk AGT-7): the object it named (Number, or a PR's Branch,
// looked up in the copy), every open object of the repository (All) when it
// names none, or nothing (None) for a read. Repository is the `owner/name`
// the command named (`-R`, a URL, an API path); empty, the current one.
type Refresh struct {
	Number     int
	Branch     string
	All        bool
	None       bool
	Repository string
}

// The verbs of `gh issue` and `gh pr` that write.
var writes = map[string]bool{
	"create": true, "edit": true, "close": true, "reopen": true, "comment": true, "merge": true,
	"ready": true, "review": true, "delete": true, "lock": true, "unlock": true, "transfer": true, "develop": true,
}

// labelWrites are the verbs of `gh label` that write.
var labelWrites = map[string]bool{"create": true, "edit": true, "delete": true}

// valueFlags are the flags of `gh issue` and `gh pr` that take a value: the
// word after them is never the object.
var valueFlags = map[string]bool{
	"-R": true, "--repo": true, "-b": true, "--body": true, "-F": true, "--body-file": true, "-t": true, "--title": true,
	"-l": true, "--label": true, "--add-label": true, "--remove-label": true, "-a": true, "--assignee": true,
	"--add-assignee": true, "--remove-assignee": true, "-m": true, "--milestone": true, "-p": true, "--project": true,
	"--add-project": true, "--remove-project": true, "-T": true, "--template": true, "-B": true, "--base": true,
	"-H": true, "--head": true, "-r": true, "--reviewer": true, "--add-reviewer": true, "--remove-reviewer": true,
	"-n": true, "--name": true, "--branch-repo": true, "--subject": true, "--match-head-commit": true,
	"-A": true, "--author-email": true, "--reason": true, "--recover": true,
}

var (
	number    = regexp.MustCompile(`^#?([1-9][0-9]*)$`)
	objectURL = regexp.MustCompile(`^https://github\.com/([A-Za-z0-9-]+/[A-Za-z0-9._-]+)/(?:issues|pull)/([1-9][0-9]*)(?:[/?#].*)?$`)
	apiPath   = regexp.MustCompile(`^repos/([^/]+)/([^/]+)(?:/(issues|pulls)/([1-9][0-9]*)(?:/.*)?|/.*)?$`)
)

// Named says what the `gh` command args (without `gh`) changed, from its
// arguments, or, for `issue create` and `pr create`, from the URL it printed
// last on stdout.
func Named(args []string, stdout string) Refresh {
	args = verbFirst(args)
	if len(args) < 2 {
		return Refresh{None: true}
	}
	for _, arg := range args {
		if arg == "--" {
			break
		}
		if arg == "--help" || arg == "-h" {
			return Refresh{None: true}
		}
	}
	switch args[0] {
	case "issue", "pr":
		return object(args[0], args[1], args[2:], stdout)
	case "label":
		if !labelWrites[args[1]] {
			return Refresh{None: true}
		}
		_, repo := scan(args[1], args[2:])
		return Refresh{All: true, Repository: repo}
	case "api":
		return api(args[1:])
	}
	return Refresh{None: true}
}

// verbFirst moves the flags gh accepts before a command's group or verb
// (`gh --repo o/r issue comment 12`, `gh issue -R o/r comment 12`) after
// them, where the verb's own flags are: the group and the verb first. Before
// `api`, nothing moves.
func verbFirst(args []string) []string {
	var words, flags []string
	i := 0
	for ; i < len(args) && len(words) < 2; i++ {
		arg := args[i]
		switch {
		case arg == "--":
			return args
		case strings.HasPrefix(arg, "-") && len(arg) > 1:
			flags = append(flags, arg)
			if (arg == "-R" || arg == "--repo") && i+1 < len(args) {
				i++
				flags = append(flags, args[i])
			}
		default:
			words = append(words, arg)
			if arg == "api" {
				return args
			}
		}
	}
	if len(flags) == 0 {
		return args
	}
	return append(append(words, flags...), args[i:]...)
}

// object is the Refresh of `gh issue|pr <verb> <rest>`.
func object(kind, verb string, rest []string, stdout string) Refresh {
	if !writes[verb] {
		return Refresh{None: true}
	}
	if verb == "develop" && (contains(rest, "--list") || contains(rest, "-l")) {
		return Refresh{None: true}
	}
	positional, repo := scan(verb, rest)
	if verb == "create" {
		if r, ok := lastURL(stdout); ok {
			return r
		}
		return Refresh{All: true, Repository: repo}
	}
	if len(positional) == 0 {
		// The current branch's PR, gh's default: the open objects.
		return Refresh{All: true, Repository: repo}
	}
	first := positional[0]
	if m := number.FindStringSubmatch(first); m != nil {
		n, _ := strconv.Atoi(m[1])
		return Refresh{Number: n, Repository: repo}
	}
	if m := objectURL.FindStringSubmatch(first); m != nil {
		n, _ := strconv.Atoi(m[2])
		return Refresh{Number: n, Repository: m[1]}
	}
	if kind == "pr" {
		return Refresh{Branch: first, Repository: repo}
	}
	return Refresh{All: true, Repository: repo}
}

// scan gives the positional arguments of a verb's rest, its flags' values
// left out, and the repository of its -R or --repo.
func scan(verb string, rest []string) (positional []string, repo string) {
	for i := 0; i < len(rest); i++ {
		arg := rest[i]
		switch {
		case arg == "--":
			return append(positional, rest[i+1:]...), repo
		case strings.HasPrefix(arg, "--"):
			name, value, joined := strings.Cut(arg, "=")
			if !joined && takesValue(verb, name) && i+1 < len(rest) {
				i++
				value = rest[i]
			}
			if name == "--repo" {
				repo = value
			}
		case strings.HasPrefix(arg, "-") && len(arg) > 1:
			name := arg[:2]
			value := arg[2:]
			if value == "" && takesValue(verb, name) && i+1 < len(rest) {
				i++
				value = rest[i]
			}
			if name == "-R" {
				repo = value
			}
		default:
			positional = append(positional, arg)
		}
	}
	return positional, repo
}

// takesValue says whether the flag of verb takes a value: -c is `close`'s
// comment, a switch elsewhere.
func takesValue(verb, flag string) bool {
	if flag == "-c" || flag == "--comment" {
		return verb == "close"
	}
	return valueFlags[flag]
}

// lastURL is the issue or PR whose URL `gh … create` printed last.
func lastURL(stdout string) (Refresh, bool) {
	lines := strings.Split(strings.TrimSpace(stdout), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if m := objectURL.FindStringSubmatch(strings.TrimSpace(lines[i])); m != nil {
			n, _ := strconv.Atoi(m[2])
			return Refresh{Number: n, Repository: m[1]}, true
		}
	}
	return Refresh{}, false
}

// api is the Refresh of `gh api <rest>`: a method other than GET (gh's POST
// once a field is given), or a GraphQL mutation.
func api(rest []string) Refresh {
	var (
		endpoint, method string
		fields           bool
		queries          []string
	)
	for i := 0; i < len(rest); i++ {
		arg := rest[i]
		value := func(name string) string {
			if v, ok := strings.CutPrefix(arg, name+"="); ok && strings.HasPrefix(name, "--") {
				return v
			}
			if len(name) == 2 && len(arg) > 2 && strings.HasPrefix(arg, name) {
				return arg[2:]
			}
			if i+1 < len(rest) {
				i++
				return rest[i]
			}
			return ""
		}
		switch {
		case arg == "-X" || strings.HasPrefix(arg, "-X"):
			method = value("-X")
		case arg == "--method" || strings.HasPrefix(arg, "--method="):
			method = value("--method")
		case arg == "-f" || arg == "-F" || strings.HasPrefix(arg, "-f") || strings.HasPrefix(arg, "-F"):
			fields = true
			queries = append(queries, value(arg[:2]))
		case arg == "--field" || arg == "--raw-field" || strings.HasPrefix(arg, "--field=") || strings.HasPrefix(arg, "--raw-field="):
			fields = true
			name, _, _ := strings.Cut(arg, "=")
			queries = append(queries, value(name))
		case arg == "--input" || strings.HasPrefix(arg, "--input="):
			fields = true
			queries = append(queries, "@"+value("--input"))
		case arg == "-H" || arg == "--header" || arg == "-q" || arg == "--jq" || arg == "-t" || arg == "--template" ||
			arg == "--cache" || arg == "-p" || arg == "--preview" || arg == "--hostname":
			i++
		case strings.HasPrefix(arg, "-"):
		default:
			if endpoint == "" {
				endpoint = arg
			}
		}
	}
	if endpoint == "graphql" {
		for _, field := range queries {
			query, ok := strings.CutPrefix(field, "query=")
			if !ok && !strings.HasPrefix(field, "@") {
				continue
			}
			if !ok || strings.HasPrefix(query, "@") || strings.HasPrefix(strings.TrimSpace(query), "mutation") {
				// A mutation, or a query in a file the command alone reads.
				return Refresh{All: true}
			}
		}
		return Refresh{None: true}
	}
	if method == "" && fields {
		method = "POST"
	}
	if method == "" || strings.EqualFold(method, "GET") || strings.EqualFold(method, "HEAD") {
		return Refresh{None: true}
	}
	path, _, _ := strings.Cut(strings.TrimPrefix(endpoint, "/"), "?")
	m := apiPath.FindStringSubmatch(path)
	if m == nil {
		return Refresh{All: true}
	}
	repo := m[1] + "/" + m[2]
	if m[1] == "{owner}" && m[2] == "{repo}" {
		repo = ""
	}
	if m[4] == "" {
		return Refresh{All: true, Repository: repo}
	}
	n, _ := strconv.Atoi(m[4])
	return Refresh{Number: n, Repository: repo}
}

func contains(args []string, flag string) bool {
	for _, arg := range args {
		if arg == flag {
			return true
		}
	}
	return false
}
