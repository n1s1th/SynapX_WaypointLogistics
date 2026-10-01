from datetime import time
import pytest
from app.models.reference import Brand, Depot, DockType, Outlet


@pytest.fixture
def sample_outlet(db_session):
    outlet = db_session.query(Outlet).filter(Outlet.code == "OUT005").first()
    if not outlet:
        outlet = Outlet(
            code="OUT005",
            name="Fresh Colombo",
            brand=Brand.FRESH,
            district="Colombo",
            dock_type=DockType.REAR_DOCK,
            van_only=False,
            window_start=time(4, 0),
            window_end=time(7, 45),
            depot=Depot.PELIYAGODA,
        )
        db_session.add(outlet)
        db_session.commit()
        db_session.refresh(outlet)
    return outlet


def test_get_outlet_settings(client, sample_outlet):
    res = client.get(f"/api/v1/outlets/{sample_outlet.code}/settings")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["outlet_code"] == "OUT005"
    assert data["brand"] == "Fresh"
    assert data["district"] == "Colombo"
    assert data["serving_depot"] == "Peliyagoda"
    assert data["dock_type"] == "Rear dock"
    assert data["vehicle_access"] == "Trucks and vans"
    assert data["window_start"] == "04:00"
    assert data["window_end"] == "07:45"
    assert data["driver_check_in_call"] is True
    assert data["share_dock_gate_code"] is True
    assert data["email_alerts_issues"] is True
    assert data["sms_alerts_priority"] is False


def test_update_outlet_settings(client, sample_outlet):
    update_payload = {
        "contact_phone": "+94 11 999 8888",
        "emergency_contact": "Nimal P. · ext 9000",
        "sms_alerts_priority": True,
        "driver_check_in_call": False,
    }
    res = client.patch(f"/api/v1/outlets/{sample_outlet.id}/settings", json=update_payload)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["contact_phone"] == "+94 11 999 8888"
    assert data["emergency_contact"] == "Nimal P. · ext 9000"
    assert data["sms_alerts_priority"] is True
    assert data["driver_check_in_call"] is False
    assert data["share_dock_gate_code"] is True  # preserved


def test_reset_outlet_settings(client, sample_outlet):
    res = client.post(f"/api/v1/outlets/{sample_outlet.code}/settings/reset")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["contact_phone"] is None
    assert data["emergency_contact"] is None
    assert data["driver_check_in_call"] is True
    assert data["sms_alerts_priority"] is False
