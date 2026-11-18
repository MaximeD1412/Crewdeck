package session

// SetAfterUnhold makes f run as a run's place is given back, between the
// release of m.mu and the start of the resumes that waited for it.
func SetAfterUnhold(m *Manager, f func()) {
	m.mu.Lock()
	m.afterUnhold = f
	m.mu.Unlock()
}
