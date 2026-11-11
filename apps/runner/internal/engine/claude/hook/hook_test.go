package hook_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/claude/control"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/claude/hook"
)

// askUserQuestion is the hook's input as the spike recorded it
// (testdata/03-question.hook.jsonl).
const askUserQuestion = `{"session_id":"c9585bf6-dd44-4e8a-907d-dc5e6f319e0f","cwd":"/home/pilote/spike","permission_mode":"default","hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"Quelle couleur pour le titre du README ?","header":"Couleur","options":[{"label":"Rouge","description":"Titre du README en rouge"},{"label":"Bleu","description":"Titre du README en bleu"}],"multiSelect":false}]},"tool_use_id":"toolu_01KYG2Q9dXrQRxtp2hpymKjG"}`

func TestAQuestionIsForwardedAndItsAnswerGivenBackAsClaudeReadsIt(t *testing.T) {
	var asked control.Request
	var out bytes.Buffer
	err := hook.PreToolUse(context.Background(), strings.NewReader(askUserQuestion), &out, func(_ context.Context, r control.Request) (control.Reply, error) {
		asked = r
		return control.Reply{Allow: true, Answers: map[string]string{"Quelle couleur pour le titre du README ?": "Bleu"}}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if asked.Kind != control.Question || asked.ToolName != "AskUserQuestion" || asked.ToolUseID != "toolu_01KYG2Q9dXrQRxtp2hpymKjG" || !strings.HasPrefix(string(asked.Input), `{"questions":`) {
		t.Fatalf("asked %+v", asked)
	}
	// The recorded output of 03-a-updated-input, which made Claude read « Bleu ».
	want := `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"questions":[{"question":"Quelle couleur pour le titre du README ?","header":"Couleur","options":[{"label":"Rouge","description":"Titre du README en rouge"},{"label":"Bleu","description":"Titre du README en bleu"}],"multiSelect":false}],"answers":{"Quelle couleur pour le titre du README ?":"Bleu"}}}}`
	if !sameJSON(t, out.String(), want) {
		t.Fatalf("output\n%s\nwant\n%s", out.String(), want)
	}
}

func TestAnotherToolGoesThroughWithNoOutput(t *testing.T) {
	var out bytes.Buffer
	input := `{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"},"tool_use_id":"toolu_x"}`
	err := hook.PreToolUse(context.Background(), strings.NewReader(input), &out, func(context.Context, control.Request) (control.Reply, error) {
		t.Fatal("asked for a Bash call")
		return control.Reply{}, nil
	})
	if err != nil || out.Len() != 0 {
		t.Fatalf("err %v, output %q", err, out.String())
	}
}

func TestAnAdapterThatCannotBeReachedFailsTheHook(t *testing.T) {
	var out bytes.Buffer
	err := hook.PreToolUse(context.Background(), strings.NewReader(askUserQuestion), &out, func(context.Context, control.Request) (control.Reply, error) {
		return control.Reply{}, errors.New("control: connection refused")
	})
	if err == nil || out.Len() != 0 {
		t.Fatalf("err %v, output %q: want an error and nothing on stdout", err, out.String())
	}
}

func sameJSON(t *testing.T, a, b string) bool {
	t.Helper()
	var x, y any
	if err := json.Unmarshal([]byte(a), &x); err != nil {
		t.Fatalf("%q: %v", a, err)
	}
	if err := json.Unmarshal([]byte(b), &y); err != nil {
		t.Fatal(err)
	}
	ja, _ := json.Marshal(x)
	jb, _ := json.Marshal(y)
	return string(ja) == string(jb)
}
