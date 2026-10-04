from app.core.config import settings


def payload(code="OUT-1"):
    return {
        "code": code, "name": "Kandy Store", "address": "5 Main Street", "district": "Kandy",
        "active": True, "brand": "fresh", "depot": "kandy", "dock_type": "rear_dock", "van_only": False,
        "delivery_restrictions": "Use rear loading bay; no large trucks",
        "contacts": [{"name": "Nimal", "role": "Receiver", "phone": "+94771234567", "email": "nimal@example.com"}],
        "receiving_windows": [{"weekday": 0, "opens_at": "09:00", "closes_at": "12:00"}, {"weekday": 0, "opens_at": "13:00", "closes_at": "17:00"}],
    }


def test_create_list_update_and_conflict(client):
    response = client.post("/api/v1/outlets/", json=payload())
    assert response.status_code == 201, response.text
    created = response.json()
    assert len(created["contacts"]) == 1 and len(created["receiving_windows"]) == 2
    listed = client.get("/api/v1/outlets/").json()[0]
    assert listed["code"] == "OUT-1"
    assert listed["address"] == "5 Main Street"
    assert listed["active"] is True
    assert len(listed["contacts"]) == 1
    assert len(listed["receiving_windows"]) == 2
    assert client.get(f"/api/v1/outlets/{created['id']}").status_code == 200
    updated = payload()
    updated.update(expected_updated_at=created["updated_at"], active=False, contacts=[{"name": "Amal", "email": "amal@example.com"}], receiving_windows=[])
    result = client.put(f"/api/v1/outlets/{created['id']}", json=updated)
    assert result.status_code == 200, result.text
    assert result.json()["active"] is False and len(result.json()["contacts"]) == 1 and result.json()["receiving_windows"] == []
    assert client.put(f"/api/v1/outlets/{created['id']}", json=updated).status_code == 409
    child_only = {**updated, "expected_updated_at": result.json()["updated_at"], "contacts": [{"name": "New contact", "phone": "0771234567"}]}
    child_result = client.put(f"/api/v1/outlets/{created['id']}", json=child_only)
    assert child_result.status_code == 200
    assert child_result.json()["updated_at"] != result.json()["updated_at"]
    assert client.put(f"/api/v1/outlets/{created['id']}", json=child_only).status_code == 409
    assert client.post("/api/v1/outlets/", json=payload()).status_code == 409


def test_invalid_windows_and_contacts(client):
    for changed in (
        {"receiving_windows": [{"weekday": 7, "opens_at": "09:00", "closes_at": "10:00"}]},
        {"receiving_windows": [{"weekday": 0, "opens_at": "12:00", "closes_at": "09:00"}]},
        {"receiving_windows": [{"weekday": 0, "opens_at": "09:00", "closes_at": "12:00"}, {"weekday": 0, "opens_at": "11:00", "closes_at": "13:00"}]},
        {"contacts": [{"name": "Unreachable"}]},
    ):
        assert client.post("/api/v1/outlets/", json={**payload(), **changed}).status_code == 422
    assert client.get("/api/v1/outlets/999999").status_code == 404
    assert client.get("/api/v1/outlets/?limit=101").status_code == 422


def test_writes_require_dispatcher_auth(client, monkeypatch):
    monkeypatch.setattr(settings, "KEYCLOAK_DEV_MODE", False)
    assert client.post("/api/v1/outlets/", json=payload()).status_code == 401
