from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

from vantage.config import DEFAULT_EXCLUDE_DIRS, DaemonConfig


class Settings(BaseSettings):
    target_repo: Path = Path(".")
    host: str | list[str] = "127.0.0.1"
    port: int = 8000
    # Multi-repo mode flag (set programmatically, not from env)
    multi_repo: bool = False
    # Directories to exclude from file listings and recent files
    exclude_dirs: frozenset[str] = DEFAULT_EXCLUDE_DIRS
    # Show hidden files/directories (starting with .) in the sidebar
    show_hidden: bool = True
    # Performance tuning for large repos (defaults: no limits)
    walk_max_depth: int | None = None  # max directory depth for untracked file discovery
    walk_timeout: float = 30.0  # timeout in seconds for git ls-files subprocess
    # UI overrides
    disable_whats_new: bool = False  # suppress the "What's New" modal
    # Whether to honour ~/.config/vantage/ignore and <repo>/.vantageignore.
    # When False, vantage behaves as if neither file existed.
    use_ignore_files: bool = True

    model_config = SettingsConfigDict(extra="ignore")


def get_settings():
    return Settings()


settings = get_settings()

# Daemon config is loaded separately when running in daemon mode
daemon_config: DaemonConfig | None = None


def set_daemon_config(config: DaemonConfig):
    """Set the daemon configuration for multi-repo mode."""
    global daemon_config, settings
    daemon_config = config
    settings = Settings(
        host=config.host,
        port=config.port,
        multi_repo=True,
        exclude_dirs=config.exclude_dirs,
        show_hidden=config.show_hidden,
        walk_max_depth=config.walk_max_depth,
        walk_timeout=config.walk_timeout,
        disable_whats_new=config.disable_whats_new,
        use_ignore_files=config.use_ignore_files,
    )
    # Cached matchers may have been created before the daemon config
    # loaded — rebuild so the enabled flag propagates.
    from vantage.services.ignore import clear_matcher_cache

    clear_matcher_cache()


def get_daemon_config() -> DaemonConfig | None:
    """Get the current daemon configuration."""
    return daemon_config
