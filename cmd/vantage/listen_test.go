package main

import (
	"net"
	"strconv"
	"testing"

	"github.com/spf13/pflag"
	"github.com/stretchr/testify/require"

	"github.com/mschulkind-oss/vantage/internal/config"
)

// freePort returns a port nothing is listening on, by binding one and letting
// it go. Racy in principle; the tests below occupy the port themselves before
// anything else can.
func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	port := ln.Addr().(*net.TCPAddr).Port
	require.NoError(t, ln.Close())
	return port
}

func closeAll(lns []net.Listener) {
	for _, ln := range lns {
		_ = ln.Close()
	}
}

func TestListenAllUsesRequestedPortWhenFree(t *testing.T) {
	want := freePort(t)
	lns, got, err := listenAll([]string{"127.0.0.1"}, want, false)
	require.NoError(t, err)
	defer closeAll(lns)
	require.Equal(t, want, got)
	require.Len(t, lns, 1)
}

func TestListenAllWalksPastOccupiedPorts(t *testing.T) {
	first := freePort(t)

	// Occupy the requested port and the one after it, so the walk has to take
	// two steps rather than one.
	var blockers []net.Listener
	for _, p := range []int{first, first + 1} {
		ln, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(p)))
		if err != nil {
			t.Skipf("port %d unexpectedly unavailable: %v", p, err)
		}
		blockers = append(blockers, ln)
	}
	defer closeAll(blockers)

	lns, got, err := listenAll([]string{"127.0.0.1"}, first, false)
	require.NoError(t, err)
	defer closeAll(lns)
	require.Equal(t, first+2, got, "should land on the first free port above the requested one")
}

// TestListenAllSharesOnePortAcrossHosts is the reason the listeners are opened
// here instead of by http.Server: every bind address has to agree on the port,
// and a port free on one is not necessarily free on another.
func TestListenAllSharesOnePortAcrossHosts(t *testing.T) {
	first := freePort(t)

	// Free on 127.0.0.1, taken on ::1 — so the pair cannot use it.
	blocker, err := net.Listen("tcp", net.JoinHostPort("::1", strconv.Itoa(first)))
	if err != nil {
		t.Skip("no IPv6 loopback available")
	}
	defer blocker.Close()

	lns, got, err := listenAll([]string{"127.0.0.1", "::1"}, first, false)
	require.NoError(t, err)
	defer closeAll(lns)
	require.NotEqual(t, first, got, "a port taken on any host must be skipped for all of them")
	require.Len(t, lns, 2)
	for _, ln := range lns {
		require.Equal(t, got, ln.Addr().(*net.TCPAddr).Port, "every host binds the same port")
	}
}

// TestListenAllGivesUpRatherThanWrapping pins the upper bound: exhausting
// every valid port up to 65535 fails outright instead of wrapping around to
// low, often-privileged ports. Starting the scan at 65536 (not a real port at
// all) would prove nothing about this — net.Listen would refuse it as an
// invalid address before the wraparound logic ever ran. So this occupies the
// three highest valid ports and starts the scan there instead, exhausting the
// real range the walk is meant to respect.
func TestListenAllGivesUpRatherThanWrapping(t *testing.T) {
	top := []int{65533, 65534, 65535}
	var blockers []net.Listener
	for _, p := range top {
		ln, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(p)))
		if err != nil {
			t.Skipf("port %d unexpectedly unavailable: %v", p, err)
		}
		blockers = append(blockers, ln)
	}
	defer closeAll(blockers)

	_, _, err := listenAll([]string{"127.0.0.1"}, 65533, false)
	require.Error(t, err)
	require.Contains(t, err.Error(), "no free port")
}

func TestListenAllRejectsPortZero(t *testing.T) {
	_, _, err := listenAll([]string{"127.0.0.1"}, 0, false)
	require.Error(t, err)
}

func TestListenAllRejectsNegativePort(t *testing.T) {
	_, _, err := listenAll([]string{"127.0.0.1"}, -1, false)
	require.Error(t, err)
}

// TestListenAllSurfacesNonAddrInUseErrorsImmediately covers the reason the
// scan distinguishes "port taken" from every other bind failure: an invalid
// host fails identically on every candidate port, so treating it like a busy
// port would scan the whole range just to arrive at a misleading "no free
// port found" instead of the real cause.
func TestListenAllSurfacesNonAddrInUseErrorsImmediately(t *testing.T) {
	port := freePort(t)
	_, _, err := listenAll([]string{"256.256.256.256"}, port, false)
	require.Error(t, err)
	require.NotContains(t, err.Error(), "no free port",
		"a host that can never bind should fail with its own error, not exhaust the scan")
}

// TestListenAllStrictBindsExactlyTheRequestedPort is the operator-named-a-port
// half of the port rule: strict binds exactly what was asked, and an occupied
// port is an error rather than a reason to walk — the whole point being that a
// systemd unit or a script that names a port must never come up on a different
// one it was never configured to use.
func TestListenAllStrictBindsExactlyTheRequestedPort(t *testing.T) {
	want := freePort(t)
	lns, got, err := listenAll([]string{"127.0.0.1"}, want, true)
	require.NoError(t, err)
	defer closeAll(lns)
	require.Equal(t, want, got)
	require.Len(t, lns, 1)
}

func TestListenAllStrictFailsOnOccupiedPortWithoutWalking(t *testing.T) {
	first := freePort(t)
	blocker, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(first)))
	if err != nil {
		t.Skipf("port %d unexpectedly unavailable: %v", first, err)
	}
	defer func() { _ = blocker.Close() }()

	_, _, err = listenAll([]string{"127.0.0.1"}, first, true)
	require.Error(t, err)
	require.Contains(t, err.Error(), "configured explicitly",
		"the error should say the port was chosen, so the operator knows to free it or change it")

	// No walk: the port above the occupied one must not have been taken.
	nextLn, walkErr := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(first+1)))
	require.NoError(t, walkErr, "strict mode must not bind the next port up")
	_ = nextLn.Close()
}

// Two addresses with ports of their own, both bound exactly.
func TestBindConfiguredListenBindsEveryAddressOnItsOwnPort(t *testing.T) {
	a, b := freePort(t), freePort(t)
	cfg := config.Defaults()
	cfg.Listen = []config.ListenAddr{{Host: "127.0.0.1", Port: a}, {Host: "127.0.0.1", Port: b}}
	lns, bound, err := bindConfigured(cfg)
	require.NoError(t, err)
	defer closeAll(lns)
	require.Equal(t, cfg.Listen, bound)
	require.Len(t, lns, 2)
	require.Equal(t, a, lns[0].Addr().(*net.TCPAddr).Port)
	require.Equal(t, b, lns[1].Addr().(*net.TCPAddr).Port)
}

// A listen entry is explicit: a busy one fails the run, and the addresses
// already bound are let go rather than left answering alone.
func TestBindConfiguredListenIsAllOrNothing(t *testing.T) {
	a, b := freePort(t), freePort(t)
	blocker, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(b)))
	require.NoError(t, err)
	defer blocker.Close()

	cfg := config.Defaults()
	cfg.Listen = []config.ListenAddr{{Host: "127.0.0.1", Port: a}, {Host: "127.0.0.1", Port: b}}
	_, _, err = bindConfigured(cfg)
	require.ErrorContains(t, err, strconv.Itoa(b))

	again, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(a)))
	require.NoError(t, err, "the first address must have been released")
	_ = again.Close()
}

// Without listen, host and port behave as before, and the bound addresses
// report the port actually taken.
func TestBindConfiguredFallsBackToHostAndPort(t *testing.T) {
	p := freePort(t)
	cfg := config.Defaults()
	cfg.Port = p
	lns, bound, err := bindConfigured(cfg)
	require.NoError(t, err)
	defer closeAll(lns)
	require.Equal(t, []config.ListenAddr{{Host: "127.0.0.1", Port: p}}, bound)
}

func TestApplyAddressFlags(t *testing.T) {
	newFlags := func(args ...string) (*pflag.FlagSet, *addressFlags) {
		fs := pflag.NewFlagSet("t", pflag.ContinueOnError)
		af := registerAddressFlags(fs)
		require.NoError(t, fs.Parse(args))
		return fs, af
	}

	// --listen replaces whatever host and port a lower tier set.
	cfg := config.Defaults()
	fs, af := newFlags("--listen", "localhost:8001", "--listen", "myhost.tail:8000")
	require.NoError(t, af.apply(fs, cfg))
	require.Equal(t, []config.ListenAddr{{Host: "localhost", Port: 8001}, {Host: "myhost.tail", Port: 8000}}, cfg.Listen)

	// --host or --port overrides a lower tier's listen.
	cfg = config.Defaults()
	cfg.Listen = []config.ListenAddr{{Host: "localhost", Port: 8001}}
	fs, af = newFlags("--port", "9000")
	require.NoError(t, af.apply(fs, cfg))
	require.Nil(t, cfg.Listen)
	require.Equal(t, 9000, cfg.Port)
	require.True(t, cfg.PortExplicit)

	// Both on one command line is a contradiction.
	fs, af = newFlags("--listen", "localhost:8001", "--host", "0.0.0.0")
	require.ErrorContains(t, af.apply(fs, config.Defaults()), "--listen")

	fs, af = newFlags("--listen", "localhost")
	require.Error(t, af.apply(fs, config.Defaults()))

	// No flags: nothing changes.
	cfg = config.Defaults()
	cfg.Listen = []config.ListenAddr{{Host: "localhost", Port: 8001}}
	fs, af = newFlags()
	require.NoError(t, af.apply(fs, cfg))
	require.Len(t, cfg.Listen, 1)
}
