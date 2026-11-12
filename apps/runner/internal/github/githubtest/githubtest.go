// Package githubtest is a fake GitHub for the Runner's tests (ADR 0010): an
// httptest server answering GraphQL by operationName and variables from
// fixtures, REST by method and path, with scripted errors, recording every
// call with its Authorization header. No test calls GitHub.
//
// A GraphQL fixture is a JSON file:
//
//	{"operation": "MirrorObject", "variables": {"owner": "acme", "number": 38}, "data": {…}, "errors": […]}
//
// It answers a request of its operation whose variables include its own (a
// null variable matches an absent one); the fixture naming the most variables
// wins, then the one loaded last, so that a later folder overrides an earlier.
package githubtest

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"testing"
	"time"
)

// Call is a request the fake received.
type Call struct {
	Operation     string         // a GraphQL request's operationName, "" for REST
	Variables     map[string]any // a GraphQL request's
	Method        string
	Path          string
	Authorization string
}

// Failure is an answer scripted instead of a fixture's.
type Failure struct {
	Status int
	Header http.Header
}

// Unauthorized is GitHub's answer to a bad or expired token.
func Unauthorized() Failure { return Failure{Status: http.StatusUnauthorized} }

// Forbidden is GitHub's answer to a token without the permission.
func Forbidden() Failure { return Failure{Status: http.StatusForbidden} }

// RateLimited is GitHub's primary rate limit: 403, no request left until reset.
func RateLimited(reset time.Time) Failure {
	h := http.Header{}
	h.Set("X-RateLimit-Remaining", "0")
	h.Set("X-RateLimit-Reset", strconv.FormatInt(reset.Unix(), 10))
	return Failure{Status: http.StatusForbidden, Header: h}
}

// SecondaryLimited is GitHub's secondary rate limit: 429 with Retry-After.
func SecondaryLimited(after time.Duration) Failure {
	h := http.Header{}
	h.Set("Retry-After", strconv.Itoa(int(after.Seconds())))
	return Failure{Status: http.StatusTooManyRequests, Header: h}
}

// BadGateway is GitHub down.
func BadGateway() Failure { return Failure{Status: http.StatusBadGateway} }

type fixture struct {
	Operation string          `json:"operation"`
	Variables map[string]any  `json:"variables"`
	Data      json.RawMessage `json:"data"`
	Errors    json.RawMessage `json:"errors,omitempty"`
	order     int
}

type rest struct {
	status int
	body   string
}

type failure struct {
	match   string // an operation, "METHOD /path", or "" for any request
	failure Failure
	times   int
}

// Server is the fake. URL is its base, GitHub's https://api.github.com;
// GraphQL is at URL + "/graphql".
type Server struct {
	URL string

	t        testing.TB
	mu       sync.Mutex
	fixtures []fixture
	rest     map[string]rest
	failures []failure
	calls    []Call
}

// New starts a fake loading the fixtures of dirs, in order.
func New(t testing.TB, dirs ...string) *Server {
	t.Helper()
	s := &Server{t: t, rest: map[string]rest{}}
	srv := httptest.NewServer(http.HandlerFunc(s.serve))
	t.Cleanup(srv.Close)
	s.URL = srv.URL
	for _, dir := range dirs {
		s.Load(dir)
	}
	return s
}

// Load adds the GraphQL fixtures of dir (*.json), overriding the earlier ones
// they match equally.
func (s *Server) Load(dir string) {
	s.t.Helper()
	paths, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil || len(paths) == 0 {
		s.t.Fatalf("githubtest: no fixture in %s", dir)
	}
	sort.Strings(paths)
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			s.t.Fatal(err)
		}
		var f fixture
		if err := json.Unmarshal(data, &f); err != nil || f.Operation == "" {
			s.t.Fatalf("githubtest: %s is not a fixture: %v", path, err)
		}
		s.add(f)
	}
}

// Reply adds a GraphQL fixture built by the test: data is marshalled.
func (s *Server) Reply(operation string, variables map[string]any, data any) {
	s.t.Helper()
	raw, err := json.Marshal(data)
	if err != nil {
		s.t.Fatal(err)
	}
	s.add(fixture{Operation: operation, Variables: variables, Data: raw})
}

// ReplyErrors adds a GraphQL fixture answering errors (GraphQL's, with a 200).
func (s *Server) ReplyErrors(operation string, variables map[string]any, errors any) {
	s.t.Helper()
	raw, err := json.Marshal(errors)
	if err != nil {
		s.t.Fatal(err)
	}
	s.add(fixture{Operation: operation, Variables: variables, Errors: raw})
}

func (s *Server) add(f fixture) {
	// Variables compare as JSON values, whatever their Go type.
	normalized, _ := json.Marshal(f.Variables)
	f.Variables = nil
	_ = json.Unmarshal(normalized, &f.Variables)
	s.mu.Lock()
	defer s.mu.Unlock()
	f.order = len(s.fixtures)
	s.fixtures = append(s.fixtures, f)
}

// REST answers method and path (without its query) with status and body.
func (s *Server) REST(method, path string, status int, body string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rest[method+" "+path] = rest{status: status, body: body}
}

// Fail answers the next `times` requests matching match (an operation,
// "METHOD /path", or "" for any) with f instead.
func (s *Server) Fail(match string, f Failure, times int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failures = append(s.failures, failure{match: match, failure: f, times: times})
}

// Calls are the requests received so far, in order.
func (s *Server) Calls() []Call {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Call(nil), s.calls...)
}

// Count is the number of GraphQL requests of operation received so far.
func (s *Server) Count(operation string) int {
	n := 0
	for _, c := range s.Calls() {
		if c.Operation == operation {
			n++
		}
	}
	return n
}

// Reset forgets the calls received.
func (s *Server) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = nil
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	call := Call{Method: r.Method, Path: r.URL.Path, Authorization: r.Header.Get("Authorization")}
	isGraphQL := r.Method == http.MethodPost && r.URL.Path == "/graphql"
	if isGraphQL {
		var request struct {
			Query         string         `json:"query"`
			OperationName string         `json:"operationName"`
			Variables     map[string]any `json:"variables"`
		}
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &request); err != nil || request.OperationName == "" || request.Query == "" {
			http.Error(w, `{"message":"Problems parsing JSON"}`, http.StatusBadRequest)
			return
		}
		call.Operation, call.Variables = request.OperationName, request.Variables
	}
	s.mu.Lock()
	s.calls = append(s.calls, call)
	scripted := s.takeFailure(call)
	s.mu.Unlock()

	if scripted != nil {
		for key, values := range scripted.Header {
			w.Header()[key] = values
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(scripted.Status)
		fmt.Fprintf(w, `{"message":"%s"}`, http.StatusText(scripted.Status))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if !isGraphQL {
		s.mu.Lock()
		answer, ok := s.rest[r.Method+" "+r.URL.Path]
		s.mu.Unlock()
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			io.WriteString(w, `{"message":"Not Found"}`)
			return
		}
		w.WriteHeader(answer.status)
		io.WriteString(w, answer.body)
		return
	}
	f, ok := s.match(call)
	if !ok {
		s.t.Errorf("githubtest: no fixture for %s %v", call.Operation, call.Variables)
		w.WriteHeader(http.StatusNotImplemented)
		io.WriteString(w, `{"message":"no fixture"}`)
		return
	}
	var out bytes.Buffer
	out.WriteString(`{"data":`)
	if len(f.Data) == 0 {
		out.WriteString("null")
	} else {
		out.Write(f.Data)
	}
	if len(f.Errors) > 0 {
		out.WriteString(`,"errors":`)
		out.Write(f.Errors)
	}
	out.WriteString("}")
	w.Write(out.Bytes())
}

func (s *Server) takeFailure(call Call) *Failure {
	for i := range s.failures {
		f := &s.failures[i]
		if f.times == 0 {
			continue
		}
		if f.match == "" || f.match == call.Operation || f.match == call.Method+" "+call.Path {
			f.times--
			answer := f.failure
			return &answer
		}
	}
	return nil
}

func (s *Server) match(call Call) (fixture, bool) {
	normalized, _ := json.Marshal(call.Variables)
	var variables map[string]any
	_ = json.Unmarshal(normalized, &variables)
	s.mu.Lock()
	defer s.mu.Unlock()
	best, found := fixture{}, false
	for _, f := range s.fixtures {
		if f.Operation != call.Operation || !includes(variables, f.Variables) {
			continue
		}
		if !found || len(f.Variables) > len(best.Variables) || (len(f.Variables) == len(best.Variables) && f.order > best.order) {
			best, found = f, true
		}
	}
	return best, found
}

// includes says whether every variable of want is in got (null as absent).
func includes(got, want map[string]any) bool {
	for key, value := range want {
		other, ok := got[key]
		if value == nil {
			if ok && other != nil {
				return false
			}
			continue
		}
		a, _ := json.Marshal(value)
		b, _ := json.Marshal(other)
		if !ok || !bytes.Equal(a, b) {
			return false
		}
	}
	return true
}
