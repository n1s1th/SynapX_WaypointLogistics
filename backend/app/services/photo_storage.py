"""Where driver photos are kept (proof of delivery, problem reports, SOS).

Cloudflare R2 when backend/.env has the five R2_* settings; otherwise the local
uploads folder, so teammates and judges without the keys still have a working
app. If R2 can't be reached the photo is kept locally instead, so a driver's
proof is never lost. Either way the caller gets the address for photo_url.
"""
import logging
import os
from datetime import datetime, timezone
from functools import lru_cache
from uuid import uuid4

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

# app/static/uploads, served at /static/uploads (app/main.py)
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "uploads")
EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}


class R2Settings(BaseSettings):
    """Read from backend/.env like the main settings; empty when R2 isn't set up."""
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    R2_ENDPOINT: str = ""  # https://<account-id>.r2.cloudflarestorage.com
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET: str = ""
    R2_PUBLIC_URL: str = ""  # the bucket's public address, e.g. https://pub-xxxx.r2.dev

    @property
    def configured(self) -> bool:
        return all([self.R2_ENDPOINT, self.R2_ACCESS_KEY_ID, self.R2_SECRET_ACCESS_KEY, self.R2_BUCKET, self.R2_PUBLIC_URL])


@lru_cache
def r2_settings() -> R2Settings:
    return R2Settings()


@lru_cache
def r2_client():
    import boto3  # only needed once R2 is set up

    settings = r2_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.R2_ENDPOINT,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def _save_locally(name: str, contents: bytes) -> str:
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    with open(os.path.join(UPLOAD_DIR, name), "wb") as f:
        f.write(contents)
    return f"/static/uploads/{name}"


def save_photo(contents: bytes, content_type: str, folder: str = "driver") -> str:
    """Stores one photo under a random name and returns its address. folder is the
    R2 prefix (the loader passes "loader" for flag photos)."""
    name = f"{uuid4().hex}.{EXTENSIONS.get(content_type, 'jpg')}"
    settings = r2_settings()
    if not settings.configured:
        return _save_locally(name, contents)
    key = f"{folder}/{datetime.now(timezone.utc):%Y-%m-%d}/{name}"
    try:
        r2_client().put_object(Bucket=settings.R2_BUCKET, Key=key, Body=contents, ContentType=content_type)
    except Exception as exc:  # network, keys, bucket: keep the photo anyway
        logger.warning("R2 upload failed, photo kept locally: %s", exc)
        return _save_locally(name, contents)
    return f"{settings.R2_PUBLIC_URL.rstrip('/')}/{key}"
