package local

// HoldGit takes the Projet's lock of its clone, as a merge running does;
// the returned function gives it back.
func (p *Project) HoldGit() (release func()) {
	p.gitMu.Lock()
	return p.gitMu.Unlock
}

// BeforeFastForward calls fn in a merge right before the folder's `merge
// --ff-only`, once the change's head was checked.
func (p *Project) BeforeFastForward(fn func()) {
	p.mu.Lock()
	p.beforeFastForward = fn
	p.mu.Unlock()
}
