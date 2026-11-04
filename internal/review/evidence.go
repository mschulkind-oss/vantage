package review

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"sync"
)

// Evidence is what the server can say about a document right now, for the
// coherent-pair protocol of docs/design/planning-question-state.md §4: the boot
// id says whether two readings come from one server run, the generation orders
// the document's observed contents, and the content hash says which contents.
type Evidence struct {
	BootID             string `json:"boot_id"`
	DocumentGeneration int64  `json:"document_generation"`
	// ContentHash is [ContentHash] of the document as the server read it, or ""
	// when it could not be read as text.
	ContentHash string `json:"content_hash"`
}

// docState is the last content hash observed for one document and the
// generation assigned to it.
type docState struct {
	hash       string
	generation int64
}

// evidenceState is the Store's in-memory evidence. Nothing here is persisted: a
// restart changes the boot id, and a reader holding another boot id's numbers
// never compares them with these.
type evidenceState struct {
	mu   sync.Mutex
	boot string
	docs map[string]*docState
}

// ContentHash is the content hash of a document's text: the first 128 bits of
// SHA-256 as 32 lowercase hex digits, the spelling the planning scan uses for
// the same bytes.
func ContentHash(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:16])
}

// newRandomID returns 16 random hex digits for boot ids and root text versions.
func newRandomID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("review: no randomness: " + err.Error())
	}
	return hex.EncodeToString(b[:])
}

// BootID is this Store's server boot id, fixed for its lifetime.
func (s *Store) BootID() string {
	s.ev.mu.Lock()
	defer s.ev.mu.Unlock()
	return s.bootLocked()
}

func (s *Store) bootLocked() string {
	if s.ev.boot == "" {
		s.ev.boot = newRandomID()
	}
	return s.ev.boot
}

// ObserveDocument records that the document at path in repo currently has
// contentHash ("" for an unreadable one) and returns the evidence for it. The
// generation starts at 1 and increases by one each time an observation differs
// from the previous one, so it orders observed contents without any hash being
// used as an order. A change between two observations that are never made is
// not counted.
func (s *Store) ObserveDocument(repo, path, contentHash string) Evidence {
	s.ev.mu.Lock()
	defer s.ev.mu.Unlock()
	if s.ev.docs == nil {
		s.ev.docs = map[string]*docState{}
	}
	key := repo + "\x00" + path
	d := s.ev.docs[key]
	switch {
	case d == nil:
		d = &docState{hash: contentHash, generation: 1}
		s.ev.docs[key] = d
	case d.hash != contentHash:
		d.hash = contentHash
		d.generation++
	}
	return Evidence{BootID: s.bootLocked(), DocumentGeneration: d.generation, ContentHash: contentHash}
}

// ObserveWithRevision reads the document through src and the review's mutation
// revision (0 when there is no review) under the review's lock, so the pair is
// one reading: no write lands between the two.
func (s *Store) ObserveWithRevision(filePath, repo string, src DocSource) (Evidence, int64, error) {
	defer s.lock(filePath, repo)()
	data, err := s.getLocked(filePath, repo)
	if err != nil {
		return Evidence{}, 0, err
	}
	var revision int64
	if data != nil {
		revision = data.MutationRevision
	}
	return observeFrom(src).Evidence, revision, nil
}
