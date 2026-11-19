// Command fakeserver stands in for the Crewdeck server in the darwin job of
// the nightly's smoke test (RUNNER-14, apps/runner/smoke/smoke.sh): an
// httptest server speaking what the compiled Runner and smoke.sh reach of
// the real one, with the messages of packages/contracts/fixtures/runner/:
//
//   - the scenario `smoke` (POST /api/testing/scenarios/smoke) and its
//     helpers, the page's confirmation of the link (POST
//     /api/testing/smoke/confirm) and the start of a Session (POST
//     /api/testing/smoke/sessions), as apps/server/src/testing/ gives them;
//   - the link of the binary (POST /api/runner/link, …/pairing, GET
//     /api/runner/link/:id), its proofs and the vault key's wrap real;
//   - the Runner's socket (/api/ws?client=runner): hello, heartbeats,
//     session.start, session.state;
//   - GET /api/sessions/:id with the scenario's session cookie;
//   - POST /api/runner/sessions/:id/github-token, `sessions.no-repository`
//     as the real server answers for the smoke Projet.
//
// The linux job runs the same smoke.sh against the real server. Never
// shipped: built by the nightly and by smoke_test.go only.
//
//	fakeserver -addr 127.0.0.1:3999 -fixtures packages/contracts/fixtures/runner
package main

import (
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http/httptest"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:3999", "the address to listen on")
	fixtures := flag.String("fixtures", "packages/contracts/fixtures/runner", "the Runner protocol's fixtures")
	flag.Parse()
	if _, err := os.Stat(*fixtures); err != nil {
		fmt.Fprintln(os.Stderr, "fakeserver:", err)
		os.Exit(2)
	}
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		fmt.Fprintln(os.Stderr, "fakeserver:", err)
		os.Exit(2)
	}
	s := &server{fixtures: *fixtures, logger: slog.New(slog.NewTextHandler(os.Stderr, nil))}
	ts := httptest.NewUnstartedServer(s.routes())
	ts.Listener.Close()
	ts.Listener = listener
	ts.Start()
	fmt.Println(ts.URL)
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	ts.CloseClientConnections()
	ts.Close()
}
