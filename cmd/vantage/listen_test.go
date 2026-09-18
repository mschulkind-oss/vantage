package main

import (
	"net"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
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
	lns, got, err := listenAll([]string{"127.0.0.1"}, want)
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

	lns, got, err := listenAll([]string{"127.0.0.1"}, first)
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

	lns, got, err := listenAll([]string{"127.0.0.1", "::1"}, first)
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

	_, _, err := listenAll([]string{"127.0.0.1"}, 65533)
	require.Error(t, err)
	require.Contains(t, err.Error(), "no free port")
}

func TestListenAllRejectsPortZero(t *testing.T) {
	_, _, err := listenAll([]string{"127.0.0.1"}, 0)
	require.Error(t, err)
}

func TestListenAllRejectsNegativePort(t *testing.T) {
	_, _, err := listenAll([]string{"127.0.0.1"}, -1)
	require.Error(t, err)
}

// TestListenAllSurfacesNonAddrInUseErrorsImmediately covers the reason the
// scan distinguishes "port taken" from every other bind failure: an invalid
// host fails identically on every candidate port, so treating it like a busy
// port would scan the whole range just to arrive at a misleading "no free
// port found" instead of the real cause.
func TestListenAllSurfacesNonAddrInUseErrorsImmediately(t *testing.T) {
	port := freePort(t)
	_, _, err := listenAll([]string{"256.256.256.256"}, port)
	require.Error(t, err)
	require.NotContains(t, err.Error(), "no free port",
		"a host that can never bind should fail with its own error, not exhaust the scan")
}
