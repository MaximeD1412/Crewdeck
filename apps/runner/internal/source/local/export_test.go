package local

// HoldGit takes the Projet's lock of its clone, as a merge running does;
// the returned function gives it back.
func (p *Project) HoldGit() (release func()) {
	p.gitMu.Lock()
	return p.gitMu.Unlock
}
