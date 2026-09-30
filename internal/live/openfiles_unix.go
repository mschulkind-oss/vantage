//go:build unix

package live

import (
	"math"
	"syscall"
)

// openFileLimit is the process's soft limit on open files, or 0 when it cannot
// be read.
func openFileLimit() int {
	var lim syscall.Rlimit
	if err := syscall.Getrlimit(syscall.RLIMIT_NOFILE, &lim); err != nil {
		return 0
	}
	if lim.Cur > math.MaxInt32 {
		return math.MaxInt32
	}
	return int(lim.Cur)
}
