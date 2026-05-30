package live

import (
	"sync"
	"time"
)

// coalescer batches incoming change paths and emits a single de-duplicated,
// flush when the input has been quiet for quietPeriod or maxWait has elapsed
// since the first path of the current batch — whichever comes first.
//
// The debounce decision is factored into debounceReady so it can be unit-tested
// without real timers; the running coalescer uses a single goroutine driven by
// a timer to apply that same rule.
type coalescer struct {
	quiet   time.Duration
	maxWait time.Duration
	emit    func([]string)

	mu      sync.Mutex
	pending map[string]struct{}
	first   time.Time // when the current batch started accumulating
	last    time.Time // most recent add

	timer  *time.Timer
	closed bool
	now    func() time.Time // overridable for tests
}

// newCoalescer returns a started coalescer. emit is called (from an internal
// goroutine) once per flushed batch with the sorted-by-caller paths; here they
// are returned unsorted — flush callers sort before broadcasting.
func newCoalescer(quiet, maxWait time.Duration, emit func([]string)) *coalescer {
	return &coalescer{
		quiet:   quiet,
		maxWait: maxWait,
		emit:    emit,
		pending: make(map[string]struct{}),
		now:     time.Now,
	}
}

// add records a path into the current batch and (re)arms the flush timer.
func (c *coalescer) add(path string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	now := c.now()
	if len(c.pending) == 0 {
		c.first = now
	}
	c.last = now
	c.pending[path] = struct{}{}
	c.arm(now)
}

// arm schedules the next flush check. The wait is the smaller of the remaining
// quiet window and the remaining max-wait window, clamped to >= 0.
func (c *coalescer) arm(now time.Time) {
	if c.timer != nil {
		c.timer.Stop()
	}
	d := c.nextDelay(now)
	c.timer = time.AfterFunc(d, c.onTimer)
}

// nextDelay computes how long until the batch is eligible to flush given the
// current first/last timestamps.
func (c *coalescer) nextDelay(now time.Time) time.Duration {
	quietLeft := c.quiet - now.Sub(c.last)
	capLeft := c.maxWait - now.Sub(c.first)
	d := quietLeft
	if capLeft < d {
		d = capLeft
	}
	if d < 0 {
		d = 0
	}
	return d
}

// onTimer fires when a flush window may have elapsed. If the batch is ready it
// flushes; otherwise it re-arms (a late add can push the quiet deadline out).
func (c *coalescer) onTimer() {
	c.mu.Lock()
	if c.closed || len(c.pending) == 0 {
		c.mu.Unlock()
		return
	}
	now := c.now()
	if !debounceReady(c.first, c.last, now, c.quiet, c.maxWait) {
		c.arm(now)
		c.mu.Unlock()
		return
	}
	paths := make([]string, 0, len(c.pending))
	for p := range c.pending {
		paths = append(paths, p)
	}
	c.pending = make(map[string]struct{})
	emit := c.emit
	c.mu.Unlock()

	emit(paths)
}

// stop halts the coalescer; pending paths are dropped and no further flushes
// occur.
func (c *coalescer) stop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
	if c.timer != nil {
		c.timer.Stop()
	}
}

// debounceReady reports whether a batch that started at first and last received
// a change at last should flush at time now: either the input has been quiet
// for at least quiet, or the batch has been open for at least maxWait.
func debounceReady(first, last, now time.Time, quiet, maxWait time.Duration) bool {
	if now.Sub(last) >= quiet {
		return true
	}
	if now.Sub(first) >= maxWait {
		return true
	}
	return false
}
