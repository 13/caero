from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


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
    single_user_mode: bool = Field(default=True)
    secret_key: str = Field(default="change-me-in-production-please-use-a-long-random-string")
    access_token_expire_minutes: int = Field(default=60 * 24 * 7)  # 7 days

    # Notifications
    smtp_host: str = Field(default="")
    smtp_port: int = Field(default=587)
    smtp_user: str = Field(default="")
    smtp_password: str = Field(default="")
    smtp_from: str = Field(default="caero@localhost")
    smtp_tls: bool = Field(default=True)

    @property
    def database_url(self) -> str:
        if self.db_type == "postgresql":
            return (
                f"postgresql+asyncpg://{self.pg_user}:{self.pg_password}"
                f"@{self.pg_host}:{self.pg_port}/{self.pg_database}"
            )
        return f"sqlite+aiosqlite:///{self.sqlite_path}"


settings = Settings()
