"""Configuration owned by the outbound email module."""

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class EmailSettings(BaseSettings):
    EMAIL_ENABLED: bool = False
    EMAIL_FROM: str | None = None
    EMAIL_SMTP_HOST: str | None = None
    EMAIL_SMTP_PORT: int = 587
    EMAIL_SMTP_USERNAME: str | None = None
    EMAIL_SMTP_PASSWORD: str | None = None
    EMAIL_SMTP_STARTTLS: bool = True
    EMAIL_SMTP_SSL: bool = False
    EMAIL_WORKER_BATCH_SIZE: int = 25
    # Compatibility with the project's existing Gmail .env values.
    EMAIL_USER: str | None = None
    EMAIL_APP_PASSWORD: str | None = None

    @model_validator(mode="after")
    def resolve_legacy_gmail_settings(self):
        if self.EMAIL_USER:
            self.EMAIL_FROM = self.EMAIL_FROM or self.EMAIL_USER
            self.EMAIL_SMTP_USERNAME = self.EMAIL_SMTP_USERNAME or self.EMAIL_USER
            if not self.EMAIL_SMTP_HOST and self.EMAIL_USER.lower().endswith(("@gmail.com", "@googlemail.com")):
                self.EMAIL_SMTP_HOST = "smtp.gmail.com"
        if self.EMAIL_APP_PASSWORD and not self.EMAIL_SMTP_PASSWORD:
            self.EMAIL_SMTP_PASSWORD = "".join(self.EMAIL_APP_PASSWORD.split())
        return self

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


email_settings = EmailSettings()
