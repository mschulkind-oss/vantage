package review

import "testing"

// TestBuildUnitFingerprintMatchesScanner pins the fingerprint the shared
// scanner emits as `unitFingerprint` (packages/vantage-md/src/planning/evidence.ts,
// pinned by the same literal in frontend/src/lib/planningScanEvidence.test.ts):
// one definition, computed on both ends.
func TestBuildUnitFingerprintMatchesScanner(t *testing.T) {
	u, ok := BuildUnit("a\r\nb c\r\nd", 2, 3)
	if !ok || u.Fingerprint != "6f6a59d1a2c07723dfc69d6a6a7973d4" {
		t.Fatalf("fingerprint = %q (ok %v)", u.Fingerprint, ok)
	}
}
