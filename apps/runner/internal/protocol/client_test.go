package protocol

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

const token = "rnr_test-token"

// fakeServer is the server's side of the protocol, each connection handled by `serve` once its hello is read.
type fakeServer struct {
	t      *testing.T
	url    string
	hellos chan contracts.RunnerHello
	serve  func(ctx context.Context, conn *websocket.Conn, n int)
}

func newFakeServer(t *testing.T, serve func(ctx context.Context, conn *websocket.Conn, n int)) *fakeServer {
	t.Helper()
	s := &fakeServer{t: t, hellos: make(chan contracts.RunnerHello, 16), serve: serve}
	n := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/ws" || r.URL.Query().Get("client") != "runner" || r.Header.Get("Authorization") != "Bearer "+token {
			http.Error(w, "refused", http.StatusBadRequest)
			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		ctx := r.Context()
		var hello contracts.RunnerHello
		if err := readJSON(ctx, conn, &hello); err != nil {
			return
		}
		s.hellos <- hello
		n++
		s.serve(ctx, conn, n)
	}))
	t.Cleanup(srv.Close)
	s.url = srv.URL
	return s
}

func readJSON(ctx context.Context, conn *websocket.Conn, v any) error {
	_, data, err := conn.Read(ctx)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, v)
}

func sendJSON(ctx context.Context, conn *websocket.Conn, v any) {
	data, _ := json.Marshal(v)
	_ = conn.Write(ctx, websocket.MessageText, data)
}

func stamped(typ string, fields map[string]any) map[string]any {
	at := now()
	message := map[string]any{"type": typ, "id": newID(at), "at": at.Format(time.RFC3339Nano)}
	for k, v := range fields {
		message[k] = v
	}
	return message
}

func accept(ctx context.Context, conn *websocket.Conn) {
	sendJSON(ctx, conn, stamped(TypeHelloAccepted, map[string]any{"runnerId": "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a00", "protocolVersion": contracts.ProtocolVersion}))
}

func holdOpen(ctx context.Context, conn *websocket.Conn) {
	for {
		if _, _, err := conn.Read(ctx); err != nil {
			return
		}
	}
}

func newClient(server string, mutate func(*Config)) *Client {
	cfg := Config{
		Server:  server,
		Token:   token,
		Machine: Machine{RunnerVersion: "0.1.0", Machine: "atelier", OS: contracts.RunnerHelloOsLinux, Arch: contracts.RunnerHelloArchAmd64},
		Logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
		Backoff: Backoff{Min: 10 * time.Millisecond, Max: 20 * time.Millisecond},
	}
	if mutate != nil {
		mutate(&cfg)
	}
	return New(cfg)
}

func run(t *testing.T, client *Client) (cancel func(), result <-chan error) {
	t.Helper()
	ctx, stop := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- client.Run(ctx) }()
	t.Cleanup(stop)
	return stop, done
}

func awaitHello(t *testing.T, s *fakeServer) contracts.RunnerHello {
	t.Helper()
	select {
	case hello := <-s.hellos:
		return hello
	case <-time.After(5 * time.Second):
		t.Fatal("no hello")
		return contracts.RunnerHello{}
	}
}

func awaitResult(t *testing.T, result <-chan error) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return")
		return nil
	}
}

func TestTheClientReconnectsAfterTheServerDropsTheSocketAndResendsItsHello(t *testing.T) {
	s := newFakeServer(t, func(ctx context.Context, conn *websocket.Conn, n int) {
		accept(ctx, conn)
		if n == 1 {
			conn.CloseNow() // dropped, without a close frame
			return
		}
		holdOpen(ctx, conn)
	})
	accepted := make(chan contracts.RunnerHelloAccepted, 4)
	stop, result := run(t, newClient(s.url, func(c *Config) {
		c.OnAccepted = func(a contracts.RunnerHelloAccepted) { accepted <- a }
	}))

	first := awaitHello(t, s)
	second := awaitHello(t, s)

	if first.Id == second.Id {
		t.Fatalf("the second hello reuses the id %s", first.Id)
	}
	for _, hello := range []contracts.RunnerHello{first, second} {
		if hello.ProtocolVersion != contracts.ProtocolVersion || hello.RunnerVersion != "0.1.0" || hello.Machine != "atelier" {
			t.Fatalf("hello %+v", hello)
		}
	}
	for range 2 {
		select {
		case <-accepted:
		case <-time.After(5 * time.Second):
			t.Fatal("hello.accepted not seen twice")
		}
	}
	stop()
	if err := awaitResult(t, result); err != nil {
		t.Fatalf("Run after its context ended: %v", err)
	}
}

func TestTheClientSendsAHeartbeatEveryPeriodOnceAccepted(t *testing.T) {
	beats := make(chan contracts.RunnerHeartbeat, 8)
	s := newFakeServer(t, func(ctx context.Context, conn *websocket.Conn, _ int) {
		accept(ctx, conn)
		for {
			var beat contracts.RunnerHeartbeat
			if err := readJSON(ctx, conn, &beat); err != nil {
				return
			}
			beats <- beat
			sendJSON(ctx, conn, stamped(TypeHeartbeatAck, nil))
		}
	})
	_, _ = run(t, newClient(s.url, func(c *Config) { c.HeartbeatEvery = 20 * time.Millisecond }))

	awaitHello(t, s)
	for range 3 {
		select {
		case beat := <-beats:
			if beat.Type != TypeHeartbeat || !uuidV7.MatchString(beat.Id) {
				t.Fatalf("heartbeat %+v", beat)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("no heartbeat")
		}
	}
}

func TestTheClientClosesASilentConnectionAndConnectsAgain(t *testing.T) {
	s := newFakeServer(t, func(ctx context.Context, conn *websocket.Conn, _ int) {
		accept(ctx, conn)
		holdOpen(ctx, conn) // reads the heartbeats, never answers
	})
	_, _ = run(t, newClient(s.url, func(c *Config) {
		c.HeartbeatEvery = 10 * time.Millisecond
		c.SilentAfter = 50 * time.Millisecond
	}))

	awaitHello(t, s)
	awaitHello(t, s)
}

func TestTheClientStopsOnAnUnknownToken(t *testing.T) {
	s := newFakeServer(t, func(ctx context.Context, conn *websocket.Conn, _ int) {
		sendJSON(ctx, conn, stamped(TypeHelloRejected, map[string]any{"reason": "unknown-token"}))
		conn.Close(websocket.StatusCode(contracts.CloseUnauthorized), "unknown-token")
	})
	_, result := run(t, newClient(s.url, nil))

	if err := awaitResult(t, result); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("Run = %v, want ErrUnauthorized", err)
	}
	if len(s.hellos) != 1 {
		t.Fatalf("%d hellos, want 1 and no new attempt", len(s.hellos))
	}
}

func TestTheClientStopsWithTheLatestVersionWhenAnUpdateIsRequired(t *testing.T) {
	s := newFakeServer(t, func(ctx context.Context, conn *websocket.Conn, _ int) {
		sendJSON(ctx, conn, stamped(TypeHelloRejected, map[string]any{"reason": "update-required", "latestVersion": "0.2.0"}))
		conn.Close(websocket.StatusCode(contracts.CloseUpdateRequired), "update-required")
	})
	_, result := run(t, newClient(s.url, nil))

	var update *UpdateRequiredError
	if err := awaitResult(t, result); !errors.As(err, &update) || update.LatestVersion != "0.2.0" {
		t.Fatalf("Run = %v, want an UpdateRequiredError of 0.2.0", err)
	}
}

func TestTheClientStopsWhenAnotherConnectionReplacesIt(t *testing.T) {
	s := newFakeServer(t, func(ctx context.Context, conn *websocket.Conn, _ int) {
		accept(ctx, conn)
		conn.Close(websocket.StatusCode(contracts.CloseReplaced), "replaced")
	})
	_, result := run(t, newClient(s.url, nil))

	if err := awaitResult(t, result); !errors.Is(err, ErrReplaced) {
		t.Fatalf("Run = %v, want ErrReplaced", err)
	}
}

func TestAHandlerGetsTheMessagesOfItsTypeAndSendReachesTheServer(t *testing.T) {
	fromRunner := make(chan contracts.RunnerHeartbeat, 1)
	s := newFakeServer(t, func(ctx context.Context, conn *websocket.Conn, _ int) {
		accept(ctx, conn)
		// Ignored or logged by the client, before the message its handler gets.
		sendJSON(ctx, conn, stamped("nobody.handles", nil))
		sendJSON(ctx, conn, stamped(TypeError, map[string]any{"code": "protocol.invalid"}))
		sendJSON(ctx, conn, stamped(TypeHeartbeatAck, nil))
		_ = conn.Write(ctx, websocket.MessageText, []byte("not json"))
		sendJSON(ctx, conn, stamped("custom", map[string]any{"code": "ping.now"}))
		var beat contracts.RunnerHeartbeat
		if err := readJSON(ctx, conn, &beat); err == nil {
			fromRunner <- beat
		}
		holdOpen(ctx, conn)
	})
	client := newClient(s.url, nil)
	type custom struct {
		Type string `json:"type"`
		Code string `json:"code"`
	}
	got := make(chan custom, 1)
	On(client, "custom", func(ctx context.Context, message custom) error {
		got <- message
		return client.Send(ctx, NewHeartbeat())
	})
	_, _ = run(t, client)

	awaitHello(t, s)
	select {
	case message := <-got:
		if message.Type != "custom" || message.Code != "ping.now" {
			t.Fatalf("the handler got %+v", message)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the handler got nothing")
	}
	select {
	case beat := <-fromRunner:
		if beat.Type != TypeHeartbeat {
			t.Fatalf("the server got %+v", beat)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Send did not reach the server")
	}
}

func TestSendRefusesWhileNotConnected(t *testing.T) {
	if err := newClient("http://127.0.0.1:1", nil).Send(context.Background(), NewHeartbeat()); !errors.Is(err, ErrNotConnected) {
		t.Fatalf("Send = %v, want ErrNotConnected", err)
	}
}

func TestASecondHandlerOfATypePanics(t *testing.T) {
	client := newClient("http://127.0.0.1:1", nil)
	client.Handle("custom", func(context.Context, []byte) error { return nil })
	defer func() {
		if recover() == nil {
			t.Fatal("no panic")
		}
	}()
	client.Handle("custom", func(context.Context, []byte) error { return nil })
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestTheServerAddressBecomesTheRunnerSocket(t *testing.T) {
	cases := map[string]string{
		"http://localhost:3000":        "ws://localhost:3000/api/ws?client=runner",
		"https://crewdeck.example/":    "wss://crewdeck.example/api/ws?client=runner",
		"https://crewdeck.example/app": "wss://crewdeck.example/api/ws?client=runner",
	}
	for server, want := range cases {
		got, err := newClient(server, nil).socketURL()
		if err != nil || got != want {
			t.Errorf("socketURL(%s) = %s, %v; want %s", server, got, err, want)
		}
	}
	if _, err := newClient("ftp://crewdeck.example", nil).socketURL(); err == nil {
		t.Error("ftp: want an error")
	}
}

func TestOnConnectedCanSendOnEachAcceptedConnection(t *testing.T) {
	received := make(chan contracts.RunnerCapabilities, 4)
	s := newFakeServer(t, func(ctx context.Context, conn *websocket.Conn, n int) {
		accept(ctx, conn)
		var message contracts.RunnerCapabilities
		for {
			if err := readJSON(ctx, conn, &message); err != nil {
				return
			}
			if message.Type == TypeCapabilities {
				received <- message
				if n == 1 {
					conn.CloseNow()
					return
				}
			}
		}
	})
	var client *Client
	client = newClient(s.url, func(c *Config) {
		c.OnConnected = func(ctx context.Context) {
			if err := client.Send(ctx, NewCapabilities(nil)); err != nil {
				t.Errorf("Send from OnConnected: %v", err)
			}
		}
	})
	stop, result := run(t, client)
	for range 2 {
		select {
		case message := <-received:
			if message.Engines == nil {
				t.Fatalf("capabilities %+v: engines must be a list", message)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("capabilities not sent on each connection")
		}
	}
	stop()
	_ = awaitResult(t, result)
}
