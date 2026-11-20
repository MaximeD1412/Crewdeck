package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
	"github.com/spf13/cobra"
)

// reportRead is the longest report `etape report` reads: its figures and
// its content at their longest, escaped.
const reportRead = 1 << 20

// newEtapeCommand is `crewdeck-runner etape`, what an official Skill says
// to the Runner of its Session (RUNNER-12), the Session named by its
// environment (session.SessionEnv), over runner.sock.
func newEtapeCommand() *cobra.Command {
	etape := &cobra.Command{
		Use:   "etape",
		Short: "Talk to the Runner from an Étape's Skill: start, ask, report",
		Args:  cobra.NoArgs,
	}
	etape.AddCommand(&cobra.Command{
		Use:   "start",
		Short: "Start the StepRun, and print the Étape's context as JSON",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			call, err := etapeCall(cmd)
			if err != nil {
				return err
			}
			var context session.StepContext
			if err := call.do(session.OpStepStart, session.StepRequest{SessionID: call.session}, &context); err != nil {
				return err
			}
			return printJSON(cmd.OutOrStdout(), context)
		},
	})
	var file string
	report := &cobra.Command{
		Use:   "report --file <path>|-",
		Short: `Report the Étape: {"figures": {…}, "content": "…"}, the content sealed by the Runner`,
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			call, err := etapeCall(cmd)
			if err != nil {
				return err
			}
			data, err := readReport(cmd.InOrStdin(), file)
			if err != nil {
				return etapeFailed(cmd, err.Error())
			}
			var body struct {
				Figures json.RawMessage `json:"figures"`
				Content *string         `json:"content"`
			}
			if err := json.Unmarshal(data, &body); err != nil || len(body.Figures) == 0 {
				return etapeFailed(cmd, `Le rapport n'est pas un objet JSON {"figures": {…}, "content": "…"}.`)
			}
			if err := call.do(session.OpStepReport, session.StepReportRequest{SessionID: call.session, Figures: body.Figures, Content: body.Content}, nil); err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), "Le rapport est envoyé.")
			return nil
		},
	}
	report.Flags().StringVar(&file, "file", "", "the report's file, - for the standard input")
	_ = report.MarkFlagRequired("file")
	etape.AddCommand(report)
	var question, wait string
	ask := &cobra.Command{
		Use:   "ask --question <json> | --wait <requestId>",
		Short: "Ask the Pilote a question, wait for the answer and print it as JSON",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			call, err := etapeCall(cmd)
			if err != nil {
				return err
			}
			requestID := wait
			switch {
			case (question == "") == (wait == ""):
				return etapeFailed(cmd, "Donne --question <json>, ou --wait <requestId>.")
			case question != "":
				var q session.StepQuestion
				if err := json.Unmarshal([]byte(question), &q); err != nil {
					return etapeFailed(cmd, `La question n'est pas un objet JSON {"title": "…", "options": [{"label": "…"}], "multiple": false}.`)
				}
				var asked session.StepAskReply
				if err := call.do(session.OpStepAsk, session.StepAskRequest{SessionID: call.session, Question: q}, &asked); err != nil {
					return err
				}
				requestID = asked.RequestID
				fmt.Fprintf(cmd.ErrOrStderr(), "requestId %s (crewdeck-runner etape ask --wait %s, si l'attente est coupée)\n", requestID, requestID)
			}
			for {
				var reply session.StepAnswerReply
				if err := call.do(session.OpStepAnswer, session.StepAnswerRequest{SessionID: call.session, RequestID: requestID}, &reply); err != nil {
					return err
				}
				if reply.Answered && reply.Answer != nil {
					return printJSON(cmd.OutOrStdout(), reply.Answer)
				}
				if err := cmd.Context().Err(); err != nil {
					return err
				}
			}
		},
	}
	ask.Flags().StringVar(&question, "question", "", `the question, {"title": "…", "options": [{"label": "…", "detail": "…"}], "multiple": false}`)
	ask.Flags().StringVar(&wait, "wait", "", "wait again for the answer to the question requestId")
	etape.AddCommand(ask)
	return etape
}

// etapeClient calls the ops of the Session's Runner over runner.sock.
type etapeClient struct {
	cmd     *cobra.Command
	socket  string
	session string
}

// etapeCall is the client of the Session the environment names.
func etapeCall(cmd *cobra.Command) (*etapeClient, error) {
	sessionID := os.Getenv(session.SessionEnv)
	if sessionID == "" {
		return nil, etapeFailed(cmd, "crewdeck-runner etape se lance dans une Session du Runner ("+session.SessionEnv+" n'est pas donné).")
	}
	home, err := state.Default()
	if err != nil {
		return nil, err
	}
	return &etapeClient{cmd: cmd, socket: filepath.Join(home.Dir, localsock.SocketName), session: sessionID}, nil
}

// do calls op; a refusal is printed in French, and the command exits 1.
func (c *etapeClient) do(op string, request, reply any) error {
	ctx, cancel := context.WithTimeout(c.cmd.Context(), localsock.Timeout+5*time.Second)
	defer cancel()
	if err := localsock.Call(ctx, c.socket, op, request, reply); err != nil {
		return etapeFailed(c.cmd, etapeRefusal(err))
	}
	return nil
}

func readReport(stdin io.Reader, file string) ([]byte, error) {
	var in io.Reader
	switch file {
	case "-":
		in = stdin
	default:
		f, err := os.Open(file)
		if err != nil {
			return nil, errors.New("Le fichier du rapport ne s'ouvre pas.")
		}
		defer f.Close()
		in = f
	}
	data, err := io.ReadAll(io.LimitReader(in, reportRead+1))
	if err != nil {
		return nil, errors.New("Le rapport ne se lit pas.")
	}
	if len(data) > reportRead {
		return nil, errors.New("Le rapport est trop long.")
	}
	return data, nil
}

func printJSON(out io.Writer, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(out, "%s\n", data)
	return err
}

// etapeFailed prints why in French, and exits 1.
func etapeFailed(cmd *cobra.Command, why string) error {
	fmt.Fprintln(cmd.ErrOrStderr(), why)
	return silentExit(1)
}

// etapeRefusal says in French why the Runner refused an `etape` call.
func etapeRefusal(err error) string {
	var failed *localsock.Failed
	switch {
	case errors.Is(err, localsock.ErrNoRunner):
		return "Le Runner ne tourne pas sur cette machine."
	case errors.As(err, &failed):
		switch failed.Code {
		case "not-found":
			return "Le Runner ne connaît pas cette Session, ni cette question."
		case "no-step":
			return "Cette Session ne fait pas d'Étape."
		case "not-running":
			return "Cette Session ne tourne pas."
		case "offline":
			return "Le Runner n'est pas connecté au serveur : réessaie dans un instant."
		case "too-long":
			return "Le rapport est trop long."
		case "bad-request":
			return "La demande n'est pas valide."
		case "ended":
			return "La Session a pris fin avant la réponse."
		}
		return fmt.Sprintf("Le Runner n'a pas pu le faire (%s).", failed.Code)
	}
	return "Le Runner n'a pas répondu."
}
