package review

import (
	"strings"

	"github.com/mschulkind-oss/vantage/internal/model"
)

// Unit is one question unit as the shared planning scanner reports it, for a
// question whose directive id the scanner found to be unique in its document.
// Fingerprint is [ContentHash] of Text, the unit's complete source lines
// StartLine..EndLine; the server slices those lines from the document the
// scanner read and parses nothing itself.
type Unit struct {
	Fingerprint string
	Text        string
	// PlainText is the unit as the rendered page reads it, from the scanner
	// (`unitText`); "" when an older checker does not report it.
	PlainText string
	StartLine int
	EndLine   int
}

// Scan is what the scanner proves about one document: its unique question
// units by directive id, and the line span of every question unit it found,
// with or without a usable id.
type Scan struct {
	Units map[string]Unit
	Spans []Span
}

// Span is a question unit's file lines, 1-based and inclusive.
type Span struct{ StartLine, EndLine int }

// covers reports whether line lies in any question unit of the scan.
func (sc *Scan) covers(line int) bool {
	for _, sp := range sc.Spans {
		if line >= sp.StartLine && line <= sp.EndLine {
			return true
		}
	}
	return false
}

// Observation is one coherent reading of a document taken while the review's
// lock is held: the text, the evidence for it, and lazily the scanner's unique
// question units for exactly that text.
type Observation struct {
	Evidence Evidence
	// Content is the document as read; "" when it could not be read as text.
	Content string
	// LoadScan, when non-nil, scans Content and returns what the scanner proves
	// about it, or nil when the scan is unavailable, failed or the document
	// changed while it ran. A nil LoadScan means no scanner exists.
	LoadScan func() *Scan
	// ScanFailure, when non-nil, names why the last LoadScan returned nil
	// ([model.ReasonScanRefused]); "" or nil means no checker is installed.
	ScanFailure func() string

	scan   *Scan
	loaded bool
}

// Scanned returns the scan of Content, scanning at most once per observation;
// nil means nothing about question ownership is proven.
func (o *Observation) Scanned() *Scan {
	if !o.loaded {
		o.loaded = true
		if o.LoadScan != nil {
			o.scan = o.LoadScan()
		}
	}
	return o.scan
}

// scanFailure is the reason Scanned is nil: what the observation names, else a
// scanner that is not available.
func (o *Observation) scanFailure() string {
	if o.ScanFailure != nil {
		if r := o.ScanFailure(); r != "" {
			return r
		}
	}
	return model.ReasonScannerUnavailable
}

// Units returns the unique question units of Content (nil: unproven).
func (o *Observation) Units() map[string]Unit {
	if sc := o.Scanned(); sc != nil {
		return sc.Units
	}
	return nil
}

// DocSource reads the document. A store command calls it once, after taking the
// review's lock, so the document and the review are read as one pair.
type DocSource func() *Observation

// StaticDoc is a DocSource for text already in hand: it carries no evidence and
// no scanner, so it proves no question ownership.
func StaticDoc(content string) DocSource {
	return func() *Observation { return &Observation{Content: content} }
}

// orStatic is src, or StaticDoc(content) when src is nil.
func orStatic(src DocSource, content string) DocSource {
	if src == nil {
		return StaticDoc(content)
	}
	return src
}

// observeFrom reads src, treating nil as an unreadable document.
func observeFrom(src DocSource) *Observation {
	if src == nil {
		return &Observation{}
	}
	return src()
}

// BuildUnit slices lines startLine..endLine (1-based, inclusive) from content.
func BuildUnit(content string, startLine, endLine int) (Unit, bool) {
	lines := strings.Split(content, "\n")
	if startLine < 1 || endLine < startLine || endLine > len(lines) {
		return Unit{}, false
	}
	for i := range lines {
		lines[i] = strings.TrimSuffix(lines[i], "\r")
	}
	text := strings.Join(lines[startLine-1:endLine], "\n")
	return Unit{Fingerprint: ContentHash(text), Text: text, StartLine: startLine, EndLine: endLine}, true
}

// proveQuestion decides whether the observation proves that id names exactly one
// question of the document, and that the client's evidence is about that unit.
// It returns the evidence to store, with the unit fingerprint the server itself
// computed, or the name of the first thing it could not prove.
func proveQuestion(o *Observation, id string, given *model.QuestionEvidence) (*model.QuestionEvidence, string) {
	units := o.Units()
	if units == nil {
		return nil, o.scanFailure()
	}
	u, ok := units[id]
	if !ok {
		return nil, "question_id"
	}
	out := &model.QuestionEvidence{
		DocumentGeneration:  o.Evidence.DocumentGeneration,
		DocumentContentHash: o.Evidence.ContentHash,
		UnitFingerprint:     u.Fingerprint,
	}
	if given != nil {
		if given.UnitFingerprint != "" && given.UnitFingerprint != u.Fingerprint {
			return nil, "unit_fingerprint"
		}
		if given.SelectedQuote != "" && !strings.Contains(squash(u.renderedText()), squash(given.SelectedQuote)) {
			return nil, "selected_quote"
		}
		out.SelectedQuote = given.SelectedQuote
	}
	return out, ""
}

// renderedText is the text a reviewer can select in the unit: the scanner's
// rendered reading, or the Markdown source when the checker reports none.
func (u Unit) renderedText() string {
	if u.PlainText != "" {
		return u.PlainText
	}
	return u.Text
}

// squash collapses whitespace runs, so a quote selected across a line break
// still occurs in the source it was selected from.
func squash(s string) string { return strings.Join(strings.Fields(s), " ") }

// ownsAnchor reports whether the scanner proves the block at line belongs to the
// unit of question id.
func ownsAnchor(o *Observation, id string, line int) bool {
	u, ok := o.Units()[id]
	return ok && line >= u.StartLine && line <= u.EndLine
}
