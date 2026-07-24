// Package config holds the unified runtime configuration for Vantage.
//
// A single [Config] models both run modes. Single-repo (serve) mode is built
// with [Defaults] then [Config.ApplyEnv] then explicit flag overrides
// (flag > env > default). Daemon mode is built with [Defaults] then
// [LoadDaemonFile] (TOML) then flag overrides, with [Config.MultiRepo] set.
//
// The frontend is the contract authority: this package does not re-derive any
// wire shapes, it only resolves the inputs that drive the services. Two
// semantics are load-bearing and mirrored from the historical behavior:
//
//   - exclude_dirs: absent from a source ⇒ [DefaultExcludeDirs]; present (even
//     when empty) ⇒ replace the defaults wholesale.
//   - walk_timeout: a bare TOML number is interpreted as seconds and stored as
//     a [time.Duration].
package config

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/caarlos0/env/v11"
)

// ExampleConfig is the annotated daemon-config template written by
// `vantage init-config`. It is embedded so the binary is self-contained.
//
//go:embed example.toml
var ExampleConfig string

// DefaultExcludeDirs lists directories hidden from file listings and
// recent-files by default: version-control metadata, dependency trees, language
// caches, and common build outputs. A config source may replace this set but an
// absent value leaves it intact (see the package doc).
var DefaultExcludeDirs = []string{
	// Version control
	".git", ".hg", ".svn",
	// Dependencies
	"node_modules", ".venv", "venv",
	// Language caches
	"__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".egg-info", ".tox", ".nox",
	// Build outputs
	"dist", "build",
	// General caches
	".cache",
}

// defaultHost is the loopback address bound when no host is configured.
const defaultHost = "127.0.0.1"

// defaultPort is the TCP port bound when no port is configured.
const defaultPort = 8000

// defaultWalkTimeout bounds the untracked-file discovery subprocess.
const defaultWalkTimeout = 30 * time.Second

// RepoConfig describes one repository served in daemon mode.
type RepoConfig struct {
	// Name is the repo's identifier; it appears in URLs and as the sidebar
	// label, and must be unique across the configuration.
	Name string `toml:"name"`
	// Path is the absolute, symlink-resolved repository root.
	Path string `toml:"path"`
	// AllowedReadRoots are additional absolute roots outside Path that the
	// filesystem service may read (e.g. shared skill directories).
	AllowedReadRoots []string `toml:"allowed_read_roots"`
}

// Config is the resolved configuration shared by both run modes.
//
// Single-repo mode populates TargetRepo and leaves Repos empty. Daemon mode
// sets MultiRepo, fills Repos (explicitly and via SourceDirs discovery), and
// ignores TargetRepo.
type Config struct {
	// MultiRepo is true in daemon mode. It is the authoritative mode switch.
	MultiRepo bool

	// TargetRepo is the single-repo root (serve mode). Absolute and
	// symlink-resolved once [Config.Resolve] has run.
	TargetRepo string

	// Repos are the repositories served in daemon mode.
	Repos []RepoConfig
	// SourceDirs are parent directories scanned for additional git repos.
	SourceDirs []string

	// Host is the set of bind addresses. Always normalized to a slice; a
	// single TOML string or HOST env value becomes a one-element slice.
	Host []string
	// Port is the TCP listen port.
	Port int

	// AllowedOrigins are extra hostnames permitted to open the live-reload
	// WebSocket, beyond the always-allowed loopback names. Required when the
	// browser reaches Vantage under a non-localhost name (e.g. a machine's DNS
	// name over a tunnel); the browser's Origin hostname must appear here or the
	// handshake is rejected. Bare hostnames — no scheme or port.
	AllowedOrigins []string

	// ExcludeDirs are directory names hidden from listings and recents.
	ExcludeDirs []string
	// ExcludeDirsSet records whether a source explicitly provided ExcludeDirs.
	// It distinguishes "absent ⇒ defaults" from "present empty ⇒ replace".
	ExcludeDirsSet bool

	// ShowHidden controls whether dot-files appear in the sidebar.
	ShowHidden bool
	// WalkMaxDepth caps untracked-file discovery depth; nil means unlimited.
	WalkMaxDepth *int
	// WalkTimeout bounds the untracked-file discovery subprocess. A TOML
	// number is read as seconds.
	WalkTimeout time.Duration
	// UseIgnoreFiles toggles honoring ~/.config/vantage/ignore and
	// <repo>/.vantageignore. When false vantage acts as if neither existed.
	UseIgnoreFiles bool
	// LogLevel is the slog handler level name (DEBUG/INFO/WARNING/ERROR).
	LogLevel string
}

// Defaults returns a Config seeded with the built-in defaults: loopback host,
// port 8000, the default exclude set, hidden files shown, a 30s walk timeout,
// ignore files enabled, and an INFO log level. The single-repo target defaults
// to the current directory.
func Defaults() *Config {
	excl := make([]string, len(DefaultExcludeDirs))
	copy(excl, DefaultExcludeDirs)
	return &Config{
		TargetRepo:     ".",
		Host:           []string{defaultHost},
		Port:           defaultPort,
		ExcludeDirs:    excl,
		ExcludeDirsSet: false,
		ShowHidden:     true,
		WalkMaxDepth:   nil,
		WalkTimeout:    defaultWalkTimeout,
		UseIgnoreFiles: true,
		LogLevel:       "INFO",
	}
}

// envInputs mirrors the environment surface honored in single-repo mode. Only
// keys that are actually present override the corresponding Config field;
// EXCLUDE_DIRS and WALK_TIMEOUT are handled separately so their presence can be
// tracked and their units interpreted.
type envInputs struct {
	TargetRepo     *string `env:"TARGET_REPO"`
	Host           *string `env:"HOST"`
	AllowedOrigins *string `env:"ALLOWED_ORIGINS"`
	Port           *int    `env:"PORT"`
	ShowHidden     *bool   `env:"SHOW_HIDDEN"`
	WalkMaxDepth   *int    `env:"WALK_MAX_DEPTH"`
	UseIgnoreFiles *bool   `env:"USE_IGNORE_FILES"`
	LogLevel       *string `env:"VANTAGE_LOG_LEVEL"`
}

// ApplyEnv overlays environment variables onto c, modeling the env tier of the
// single-repo precedence chain (flag > env > default). Only present variables
// take effect, so unset variables preserve the seeded defaults. EXCLUDE_DIRS
// follows the absent-vs-present replacement rule; WALK_TIMEOUT is read as
// seconds. Returns an error only for malformed numeric or boolean values.
func (c *Config) ApplyEnv() error {
	var in envInputs
	if err := env.Parse(&in); err != nil {
		return fmt.Errorf("config: parsing environment: %w", err)
	}
	if in.TargetRepo != nil {
		c.TargetRepo = *in.TargetRepo
	}
	if in.Host != nil {
		c.Host = normalizeHosts(*in.Host)
	}
	if in.AllowedOrigins != nil {
		c.AllowedOrigins = normalizeHosts(*in.AllowedOrigins)
	}
	if in.Port != nil {
		c.Port = *in.Port
	}
	if in.ShowHidden != nil {
		c.ShowHidden = *in.ShowHidden
	}
	if in.WalkMaxDepth != nil {
		c.WalkMaxDepth = in.WalkMaxDepth
	}
	if in.UseIgnoreFiles != nil {
		c.UseIgnoreFiles = *in.UseIgnoreFiles
	}
	if in.LogLevel != nil {
		c.LogLevel = *in.LogLevel
	}

	if raw, ok := os.LookupEnv("EXCLUDE_DIRS"); ok {
		// Present (even empty) replaces the defaults. Empty/whitespace entries
		// are dropped, so EXCLUDE_DIRS="" means "exclude nothing".
		c.SetExcludeDirs(dropEmpty(splitList(raw)))
	}
	if raw, ok := os.LookupEnv("WALK_TIMEOUT"); ok {
		d, err := parseSeconds(raw)
		if err != nil {
			return fmt.Errorf("config: WALK_TIMEOUT: %w", err)
		}
		c.WalkTimeout = d
	}
	return nil
}

// SetExcludeDirs replaces the exclude set and marks it as explicitly provided,
// so a later "absent" source does not reinstate the defaults. Passing an empty
// (non-nil) slice is a valid request to exclude nothing.
func (c *Config) SetExcludeDirs(dirs []string) {
	if dirs == nil {
		dirs = []string{}
	}
	c.ExcludeDirs = dirs
	c.ExcludeDirsSet = true
}

// daemonFile is the TOML schema for daemon mode. Pointer/optional fields let us
// distinguish an absent key from a zero value, which the exclude_dirs and
// walk-tuning semantics depend on.
type daemonFile struct {
	Repos          []RepoConfig `toml:"repos"`
	SourceDirs     []string     `toml:"source_dirs"`
	Host           hostField    `toml:"host"`
	AllowedOrigins hostField    `toml:"allowed_origins"`
	Port           *int         `toml:"port"`
	ExcludeDirs    *[]string    `toml:"exclude_dirs"`
	ShowHidden     *bool        `toml:"show_hidden"`
	WalkMaxDepth   *int         `toml:"walk_max_depth"`
	WalkTimeout    *float64     `toml:"walk_timeout"`
	UseIgnore      *bool        `toml:"use_ignore_files"`
	LogLevel       *string      `toml:"log_level"`
}

// hostField accepts either a single string or an array of strings for a TOML
// host-list key (`host`, `allowed_origins`), always yielding a normalized
// slice.
type hostField struct {
	hosts []string
	set   bool
}

// UnmarshalTOML decodes the host key from either a scalar string or an array.
func (h *hostField) UnmarshalTOML(v any) error {
	switch val := v.(type) {
	case string:
		h.hosts = normalizeHosts(val)
	case []any:
		out := make([]string, 0, len(val))
		for _, item := range val {
			s, ok := item.(string)
			if !ok {
				return fmt.Errorf("config: host entries must be strings, got %T", item)
			}
			out = append(out, strings.TrimSpace(s))
		}
		h.hosts = dropEmpty(out)
	default:
		return fmt.Errorf("config: host must be a string or array of strings, got %T", v)
	}
	h.set = true
	return nil
}

// LoadDaemonFile reads a daemon TOML config from path, overlays it onto Config
// defaults, discovers repos from any source_dirs, and marks MultiRepo. It does
// not call Resolve or Validate; the caller applies flag overrides between this
// call and resolution.
func LoadDaemonFile(path string) (*Config, error) {
	expanded, err := expandUser(path)
	if err != nil {
		return nil, err
	}
	abs, err := filepath.Abs(expanded)
	if err != nil {
		return nil, fmt.Errorf("config: resolving config path %q: %w", path, err)
	}

	var df daemonFile
	if _, err := toml.DecodeFile(abs, &df); err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("config: config file not found: %s", abs)
		}
		return nil, fmt.Errorf("config: decoding %s: %w", abs, err)
	}

	c := Defaults()
	c.MultiRepo = true
	c.Repos = df.Repos
	c.SourceDirs = df.SourceDirs

	if df.Host.set {
		c.Host = df.Host.hosts
	}
	if df.AllowedOrigins.set {
		c.AllowedOrigins = df.AllowedOrigins.hosts
	}
	if df.Port != nil {
		c.Port = *df.Port
	}
	if df.ExcludeDirs != nil {
		c.SetExcludeDirs(*df.ExcludeDirs)
	}
	if df.ShowHidden != nil {
		c.ShowHidden = *df.ShowHidden
	}
	if df.WalkMaxDepth != nil {
		c.WalkMaxDepth = df.WalkMaxDepth
	}
	if df.WalkTimeout != nil {
		c.WalkTimeout = secondsToDuration(*df.WalkTimeout)
	}
	if df.UseIgnore != nil {
		c.UseIgnoreFiles = *df.UseIgnore
	}
	if df.LogLevel != nil {
		c.LogLevel = *df.LogLevel
	}

	if err := c.Resolve(); err != nil {
		return nil, err
	}
	if len(c.SourceDirs) > 0 {
		c.DiscoverReposFromSourceDirs()
	}
	return c, nil
}

// Resolve makes all configured paths absolute and symlink-resolved. It is
// idempotent and safe to call after flag overrides. The single-repo TargetRepo
// is resolved too so serve mode and daemon mode share the same path discipline.
func (c *Config) Resolve() error {
	if c.TargetRepo != "" {
		p, err := resolvePath(c.TargetRepo)
		if err != nil {
			return err
		}
		c.TargetRepo = p
	}
	for i := range c.Repos {
		p, err := resolvePath(c.Repos[i].Path)
		if err != nil {
			return err
		}
		c.Repos[i].Path = p
		for j := range c.Repos[i].AllowedReadRoots {
			r, err := resolvePath(c.Repos[i].AllowedReadRoots[j])
			if err != nil {
				return err
			}
			c.Repos[i].AllowedReadRoots[j] = r
		}
	}
	for i := range c.SourceDirs {
		p, err := resolvePath(c.SourceDirs[i])
		if err != nil {
			return err
		}
		c.SourceDirs[i] = p
	}
	return nil
}

// DiscoverReposFromSourceDirs scans each source dir for immediate subdirectories
// that contain a .git entry (directory or file, the latter covering worktrees)
// and appends any not already configured. Names default to the directory name,
// with a numeric "-N" suffix on collision. It returns the newly added repos.
//
// Unreadable source dirs and entries are skipped silently; callers that want to
// warn can inspect the source-dir existence themselves.
func (c *Config) DiscoverReposFromSourceDirs() []RepoConfig {
	existingPaths := make(map[string]struct{}, len(c.Repos))
	existingNames := make(map[string]struct{}, len(c.Repos))
	for _, r := range c.Repos {
		existingPaths[r.Path] = struct{}{}
		existingNames[r.Name] = struct{}{}
	}

	var added []RepoConfig
	for _, dir := range c.SourceDirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		// os.ReadDir already returns entries sorted by name.
		for _, entry := range entries {
			name := entry.Name()
			if strings.HasPrefix(name, ".") {
				continue
			}
			full := filepath.Join(dir, name)
			info, err := os.Stat(full)
			if err != nil || !info.IsDir() {
				continue
			}
			if _, err := os.Stat(filepath.Join(full, ".git")); err != nil {
				continue
			}
			resolved, err := resolvePath(full)
			if err != nil {
				continue
			}
			if _, dup := existingPaths[resolved]; dup {
				continue
			}

			repoName := name
			for counter := 2; ; counter++ {
				if _, taken := existingNames[repoName]; !taken {
					break
				}
				repoName = fmt.Sprintf("%s-%d", name, counter)
			}

			repo := RepoConfig{Name: repoName, Path: resolved}
			c.Repos = append(c.Repos, repo)
			existingPaths[resolved] = struct{}{}
			existingNames[repoName] = struct{}{}
			added = append(added, repo)
		}
	}
	return added
}

// GetRepo returns the configured repo with the given name, or nil if none.
func (c *Config) GetRepo(name string) *RepoConfig {
	for i := range c.Repos {
		if c.Repos[i].Name == name {
			return &c.Repos[i]
		}
	}
	return nil
}

// Validate reports configuration errors for daemon mode. The four error classes
// are: no repositories configured, duplicate repository names, a repository
// path that is missing or not a directory, and an allowed read root that is
// missing or not a directory. It returns one human-readable string per problem,
// in a stable order, or an empty slice when the config is sound.
func (c *Config) Validate() []string {
	var errs []string

	if len(c.Repos) == 0 {
		errs = append(errs, "No repositories configured (add [[repos]] entries or source_dirs)")
	}

	seen := make(map[string]struct{}, len(c.Repos))
	for _, repo := range c.Repos {
		if _, dup := seen[repo.Name]; dup {
			errs = append(errs, fmt.Sprintf("Duplicate repository name: %s", repo.Name))
		}
		seen[repo.Name] = struct{}{}

		if info, err := os.Stat(repo.Path); err != nil {
			errs = append(errs, fmt.Sprintf("Repository path does not exist: %s", repo.Path))
		} else if !info.IsDir() {
			errs = append(errs, fmt.Sprintf("Repository path is not a directory: %s", repo.Path))
		}

		for _, root := range repo.AllowedReadRoots {
			if info, err := os.Stat(root); err != nil {
				errs = append(errs, fmt.Sprintf("Allowed read root does not exist for repo '%s': %s", repo.Name, root))
			} else if !info.IsDir() {
				errs = append(errs, fmt.Sprintf("Allowed read root is not a directory for repo '%s': %s", repo.Name, root))
			}
		}
	}

	return errs
}

// DefaultConfigPath returns the daemon config location,
// <UserConfigDir>/vantage/config.toml, honoring XDG_CONFIG_HOME on Linux.
func DefaultConfigPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("config: locating user config dir: %w", err)
	}
	return filepath.Join(dir, "vantage", "config.toml"), nil
}

// ReviewDir returns the on-disk review store, the literal
// ~/.local/share/vantage/reviews. Unlike the other paths this is intentionally
// NOT XDG-resolved: it is an on-disk upgrade contract and must stay byte-stable
// across releases regardless of XDG_DATA_HOME.
func ReviewDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("config: locating home dir: %w", err)
	}
	return filepath.Join(home, ".local", "share", "vantage", "reviews"), nil
}

// normalizeHosts splits a host string on commas, trims whitespace, and drops
// empties — yielding the canonical []string form used everywhere downstream.
func normalizeHosts(s string) []string {
	return dropEmpty(splitList(s))
}

// splitList splits a comma-separated value and trims each element. Empty
// elements are preserved for callers (like EXCLUDE_DIRS) that filter later via
// dropEmpty themselves; normalizeHosts drops them.
func splitList(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		out = append(out, strings.TrimSpace(p))
	}
	return out
}

// dropEmpty returns ss without empty strings, preserving order.
func dropEmpty(ss []string) []string {
	out := make([]string, 0, len(ss))
	for _, s := range ss {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// parseSeconds reads a numeric seconds value (the legacy float convention) into
// a Duration.
func parseSeconds(raw string) (time.Duration, error) {
	secs, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return 0, fmt.Errorf("expected a number of seconds, got %q", raw)
	}
	return secondsToDuration(secs), nil
}

// secondsToDuration converts a float number of seconds to a Duration without
// losing sub-second precision.
func secondsToDuration(secs float64) time.Duration {
	return time.Duration(secs * float64(time.Second))
}

// expandUser expands a leading ~ to the user's home directory.
func expandUser(p string) (string, error) {
	if p == "~" || strings.HasPrefix(p, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("config: expanding %q: %w", p, err)
		}
		if p == "~" {
			return home, nil
		}
		return filepath.Join(home, p[2:]), nil
	}
	return p, nil
}

// resolvePath expands ~, makes the path absolute, and resolves symlinks. When
// the path does not exist yet, symlink resolution is skipped and the absolute
// form is returned so validation can report a precise missing-path error.
func resolvePath(p string) (string, error) {
	expanded, err := expandUser(p)
	if err != nil {
		return "", err
	}
	abs, err := filepath.Abs(expanded)
	if err != nil {
		return "", fmt.Errorf("config: resolving path %q: %w", p, err)
	}
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		return resolved, nil
	}
	return abs, nil
}

// sortedExcludeDirs returns a copy of the exclude set in sorted order. It exists
// for deterministic comparisons and logging; the live set order is irrelevant.
func sortedExcludeDirs(dirs []string) []string {
	out := make([]string, len(dirs))
	copy(out, dirs)
	sort.Strings(out)
	return out
}
