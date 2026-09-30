//go:build !unix

package live

// openFileLimit is 0, unknown, where there is no rlimit to read.
func openFileLimit() int { return 0 }
