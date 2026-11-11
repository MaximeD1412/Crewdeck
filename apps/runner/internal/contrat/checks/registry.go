// Package checks holds the named Go functions a Contrat's `check` rules call,
// one file per name, for what no rule kind can say (ADR 0005). As soon as two
// Contrats need the same function, it becomes a rule kind.
package checks

import (
	"context"
	"fmt"
	"sync"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// Func says whether `t` passes the check, given the rule's `params`. An error
// is for what is not the output's fault (a parameter the check cannot use, a
// read that failed): the verdict is then not sent.
type Func func(ctx context.Context, t target.Target, params map[string]any) (bool, error)

var (
	mu       sync.RWMutex
	registry = map[string]Func{}
)

// Register adds the check `name`, from the init of its file. A name is registered once.
func Register(name string, fn Func) {
	mu.Lock()
	defer mu.Unlock()
	if _, ok := registry[name]; ok {
		panic(fmt.Sprintf("checks: %s is already registered", name))
	}
	registry[name] = fn
}

// Lookup is the check `name`, if a file registered it.
func Lookup(name string) (Func, bool) {
	mu.RLock()
	defer mu.RUnlock()
	fn, ok := registry[name]
	return fn, ok
}
