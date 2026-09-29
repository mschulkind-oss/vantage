# Live reload watched

The document livereload.spec.ts keeps open and rewrites on disk. No other spec
reads it, so an edit here can never land in the middle of someone else's test.
