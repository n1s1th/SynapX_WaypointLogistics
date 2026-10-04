"""Flag photos: POST /loader/issues/by-action/{client_action_id}/photo, stored
through photo_storage (Cloudflare R2, mocked here) and read back as photo_url."""
import uuid

import pytest

from app.services import photo_storage
from tests.api.test_loader_flag_release import BASE, flag, signed_in
from tests.conftest_loader import (  # noqa: F401  (loader_client is a fixture)
    build_run_021,
    loader_client,
)

PUBLIC = "https://pub-test.r2.dev"


class FakeR2:
    def __init__(self):
        self.puts = []

    def put_object(self, **kwargs):
        self.puts.append(kwargs)


@pytest.fixture
def r2(monkeypatch):
    """R2 configured, with a client that records uploads instead of sending them."""
    fake = FakeR2()
    settings = photo_storage.R2Settings(
        R2_ENDPOINT="https://acct.r2.cloudflarestorage.com", R2_ACCESS_KEY_ID="id",
        R2_SECRET_ACCESS_KEY="secret", R2_BUCKET="waypoint", R2_PUBLIC_URL=PUBLIC,
    )
    monkeypatch.setattr(photo_storage, "r2_settings", lambda: settings)
    monkeypatch.setattr(photo_storage, "r2_client", lambda: fake)
    return fake


def flagged(client, db):
    run, _ = build_run_021(db)
    session = signed_in(db, run)
    action_id = str(uuid.uuid4())
    response = flag(client, session.id, action_id=action_id)
    assert response.status_code == 200, response.text
    return action_id, response.json()


def upload(client, action_id, body=b"\xff\xd8\xff photo", content_type="image/jpeg", name="flag.jpg"):
    return client.post(f"{BASE}/issues/by-action/{action_id}/photo", files={"file": (name, body, content_type)})


def test_a_photo_uploads_to_r2_under_loader_and_shows_on_the_issue(loader_client, db_session, r2):
    action_id, issue = flagged(loader_client, db_session)

    response = upload(loader_client, action_id)

    assert response.status_code == 200, response.text
    url = response.json()["photo_url"]
    assert url.startswith(f"{PUBLIC}/loader/") and url.endswith(".jpg")
    assert len(r2.puts) == 1
    assert r2.puts[0]["Key"].startswith("loader/") and r2.puts[0]["ContentType"] == "image/jpeg"
    assert response.json()["photo_path"] == url
    # The L8 screen and the dispatcher's list both get it.
    assert loader_client.get(f"{BASE}/issues/{issue['id']}").json()["photo_url"] == url
    listed = loader_client.get(f"{BASE}/issues", params={"dock": "3"}).json()
    assert next(i for i in listed if i["id"] == issue["id"])["photo_url"] == url


def test_a_photo_over_5_mb_is_refused(loader_client, db_session, r2):
    action_id, _ = flagged(loader_client, db_session)

    response = upload(loader_client, action_id, body=b"0" * (5 * 1024 * 1024 + 1))

    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "PHOTO_TOO_LARGE"
    assert r2.puts == []


@pytest.mark.parametrize("content_type", ["image/gif", "application/pdf"])
def test_other_file_types_are_refused(loader_client, db_session, r2, content_type):
    action_id, _ = flagged(loader_client, db_session)

    response = upload(loader_client, action_id, content_type=content_type, name="flag.bin")

    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "UNSUPPORTED_PHOTO_TYPE"
    assert r2.puts == []


def test_a_photo_for_a_flag_not_on_the_server_yet_is_404(loader_client, db_session, r2):
    flagged(loader_client, db_session)

    response = upload(loader_client, str(uuid.uuid4()))

    assert response.status_code == 404
    assert r2.puts == []


def test_a_repeated_upload_keeps_the_first_photo(loader_client, db_session, r2):
    action_id, _ = flagged(loader_client, db_session)
    first = upload(loader_client, action_id).json()["photo_url"]

    again = upload(loader_client, action_id, content_type="image/png", name="again.png")

    assert again.status_code == 200
    assert again.json()["photo_url"] == first
    assert len(r2.puts) == 1


def test_a_flag_without_a_photo_still_works(loader_client, db_session):
    _, issue = flagged(loader_client, db_session)

    assert issue["photo_url"] is None and issue["photo_path"] is None
    assert loader_client.get(f"{BASE}/issues/{issue['id']}").json()["photo_url"] is None


def test_without_r2_the_photo_is_kept_on_the_server(loader_client, db_session, monkeypatch, tmp_path):
    monkeypatch.setattr(photo_storage, "r2_settings", lambda: photo_storage.R2Settings(
        R2_ENDPOINT="", R2_ACCESS_KEY_ID="", R2_SECRET_ACCESS_KEY="", R2_BUCKET="", R2_PUBLIC_URL="",
    ))
    monkeypatch.setattr(photo_storage, "UPLOAD_DIR", str(tmp_path))
    action_id, _ = flagged(loader_client, db_session)

    url = upload(loader_client, action_id, content_type="image/webp", name="flag.webp").json()["photo_url"]

    assert url.startswith("/static/uploads/") and url.endswith(".webp")
    assert (tmp_path / url.rsplit("/", 1)[1]).read_bytes() == b"\xff\xd8\xff photo"


def test_save_photo_without_a_folder_still_goes_to_driver(r2):
    url = photo_storage.save_photo(b"pod", "image/png")

    assert r2.puts[0]["Key"].startswith("driver/")
    assert url.startswith(f"{PUBLIC}/driver/") and url.endswith(".png")
