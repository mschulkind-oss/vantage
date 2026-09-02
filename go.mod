module github.com/mschulkind-oss/vantage

go 1.26

// v0.5.5 was tagged by hand rather than through `just release`, so its tree
// carries no web/dist. //go:embed accepts the empty directory, so `go install
// …@v0.5.5` builds a binary that serves "Frontend bundle not found." instead of
// the app. Everything else published for 0.5.5 is correct — the archives,
// wheels, npm package and Homebrew formula are all built by CI, which rebuilds
// the frontend itself and never reads the committed copy.
//
// The tag cannot be repaired: Go's checksum database recorded its tree hash on
// first fetch, so re-pointing it would turn a placeholder into a checksum
// failure for everyone. Retracting is the supported way to withdraw it — `go
// get` and `go install` skip retracted versions when resolving @latest, and
// warn when one is asked for by name.
//
// A retraction only takes effect once a LATER version carrying this directive
// is published, so this is inert until the next release.
retract v0.5.5

require (
	github.com/BurntSushi/toml v1.6.0
	github.com/caarlos0/env/v11 v11.4.1
	github.com/coder/websocket v1.8.15
	github.com/fsnotify/fsnotify v1.10.1
	github.com/go-chi/chi/v5 v5.3.2
	github.com/sabhiram/go-gitignore v0.0.0-20210923224102-525f6e181f06
	github.com/spf13/cobra v1.10.2
	github.com/stretchr/testify v1.12.1
	golang.org/x/sync v0.22.0
)

require (
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	github.com/spf13/pflag v1.0.9 // indirect
	go.yaml.in/yaml/v3 v3.0.5 // indirect
	golang.org/x/sys v0.13.0 // indirect
)
