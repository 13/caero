import logging
import secrets
import tomllib
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

_DEFAULT_SECRET_KEY = "change-me-in-production-please-use-a-long-random-string"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database
    db_type: str = Field(default="sqlite", description="'sqlite' or 'postgresql'")
    sqlite_path: str = Field(default="/data/caero.db")
    pg_host: str = Field(default="localhost")
    pg_port: int = Field(default=5432)
    pg_database: str = Field(default="caero")
    pg_user: str = Field(default="caero")
    pg_password: str = Field(default="")

    # Auth
    single_user_mode: bool = Field(default=False)
    secret_key: str = Field(default=_DEFAULT_SECRET_KEY)
    access_token_expire_minutes: int = Field(default=60 * 24 * 7)  # 7 days

    # Notifications
    smtp_host: str = Field(default="")
    smtp_port: int = Field(default=587)
    smtp_user: str = Field(default="")
    smtp_password: str = Field(default="")
    smtp_from: str = Field(default="caero@localhost")
    smtp_tls: bool = Field(default=True)
    telegram_bot_token: str = Field(default="")

    # Webhook notification channels. Each configured channel receives every
    # notification (alerts, selector-broken, redirects, …) in addition to the
    # per-alert email/Telegram recipients.
    ntfy_url: str = Field(default="", description="Full ntfy topic URL, e.g. https://ntfy.sh/my-topic")
    gotify_url: str = Field(default="", description="Gotify server base URL")
    gotify_token: str = Field(default="")
    discord_webhook_url: str = Field(default="")

    # Scraper
    scraper_headless: bool = Field(default=False)
    scraper_locale: str = Field(default="de-DE")
    scraper_timezone: str = Field(default="Europe/Berlin")
    # Parallel scrapes. Each one holds an extra browser context + renderer
    # process; with SCRAPER_HEADLESS=false (xvfb) that costs real RAM, so this
    # is a memory knob as much as a politeness knob. See .env.example.
    scraper_concurrency: int = Field(default=2, ge=1, le=32)
    # Consecutive failures before the "selector broken" notification fires.
    scraper_failure_alert_threshold: int = Field(default=3, ge=1)
    # Random 0..N second offset added to each product's next run so products
    # sharing a check time don't hit shops in one burst. 0 disables jitter.
    # This is the *floor* of the window — see schedule_jitter_per_product_seconds.
    schedule_jitter_seconds: int = Field(default=300, ge=0)
    # The jitter window grows with the number of products sharing a check time:
    # window = max(schedule_jitter_seconds, cohort * this). A fixed window is
    # swamped once the cohort is large enough that jobs launch faster than a
    # scrape completes, which puts every scrape back into one burst.
    schedule_jitter_per_product_seconds: int = Field(default=120, ge=0)
    # Hard ceiling on a single scrape, covering the whole browser interaction and
    # not just page.goto. A wedged Chromium otherwise holds its concurrency slot
    # forever, and enough of them stop scraping entirely. 0 disables.
    scrape_timeout_seconds: int = Field(default=120, ge=0)
    # Infrastructure failures (dead browser, no network, host thrashing) make
    # every product fail at once. Past this many distinct products failing with
    # no successes in between, per-product "selector broken" mail is replaced by
    # one "scraping is down" message per affected user. 0 disables.
    scrape_storm_min_products: int = Field(default=3, ge=0)
    # How late a missed scrape may still run (APScheduler misfire_grace_time).
    # Under load, jobs that pass their run time are otherwise dropped outright,
    # silently leaving gaps in price history. 0 = run no matter how late.
    scrape_misfire_grace_seconds: int = Field(default=3600, ge=0)

    # Price history retention: rows older than this many days are thinned to
    # the daily min and max per product. 0 disables thinning entirely.
    price_history_thin_after_days: int = Field(default=0, ge=0)

    # Daily JSON backup written to <data dir>/backups (SQLite: next to the DB
    # file). Keeps the newest N files; 0 disables backups.
    backup_keep: int = Field(default=7, ge=0)

    # Application log level: DEBUG, INFO, WARNING, ERROR
    log_level: str = Field(default="INFO")

    @property
    def database_url(self) -> str:
        if self.db_type == "postgresql":
            return (
                f"postgresql+asyncpg://{self.pg_user}:{self.pg_password}"
                f"@{self.pg_host}:{self.pg_port}/{self.pg_database}"
            )
        return f"sqlite+aiosqlite:///{self.sqlite_path}"


settings = Settings()

# A publicly known signing key allows anyone to forge login tokens. Outside
# single-user mode, replace it with a random per-process key: the app stays
# secure, at the cost of logins not surviving a restart until SECRET_KEY is set.
if settings.secret_key == _DEFAULT_SECRET_KEY and not settings.single_user_mode:
    settings.secret_key = secrets.token_urlsafe(64)
    logger.critical(
        "SECRET_KEY is unset or still the default. Using a random ephemeral key — "
        "all sessions will be invalidated on every restart. "
        "Set a long random SECRET_KEY in .env to fix this."
    )


def _get_project_version() -> str:
    path = Path(__file__).parent.parent / "pyproject.toml"
    if path.exists():
        try:
            with open(path, "rb") as f:
                return tomllib.load(f)["project"]["version"]
        except Exception:
            pass
    return "0.0.0"


PROJECT_VERSION = _get_project_version()
