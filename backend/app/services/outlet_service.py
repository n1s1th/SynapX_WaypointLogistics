from datetime import datetime
from typing import Optional, Union
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.outlet_settings import OutletSettings
from app.models.reference import DockType, Outlet
from app.schemas.outlet_settings import OutletSettingsRead, OutletSettingsUpdate


class OutletService:
    @staticmethod
    def _find_outlet(db: Session, outlet_id_or_code: Union[int, str]) -> Outlet:
        if isinstance(outlet_id_or_code, int) or (isinstance(outlet_id_or_code, str) and outlet_id_or_code.isdigit()):
            outlet = db.query(Outlet).filter(Outlet.id == int(outlet_id_or_code)).first()
        else:
            outlet = db.query(Outlet).filter(Outlet.code == str(outlet_id_or_code).upper()).first()
        
        if not outlet:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Outlet '{outlet_id_or_code}' not found."
            )
        return outlet

    @staticmethod
    def _get_or_create_settings(db: Session, outlet: Outlet) -> OutletSettings:
        settings = db.query(OutletSettings).filter(OutletSettings.outlet_id == outlet.id).first()
        if not settings:
            settings = OutletSettings(
                outlet_id=outlet.id,
                parking="No restrictions",
                driver_check_in_call=True,
                share_dock_gate_code=True,
                email_alerts_issues=True,
                sms_alerts_priority=False,
                last_synced_at=datetime.utcnow(),
            )
            db.add(settings)
            db.commit()
            db.refresh(settings)
        return settings

    @classmethod
    def get_settings(cls, db: Session, outlet_id_or_code: Union[int, str]) -> OutletSettingsRead:
        outlet = cls._find_outlet(db, outlet_id_or_code)
        settings = cls._get_or_create_settings(db, outlet)

        dock_type_label = {
            DockType.REAR_DOCK: "Rear dock",
            DockType.STREET: "Street unload",
            DockType.MALL_BAY: "Mall bay",
        }.get(outlet.dock_type, "Rear dock")

        vehicle_access = "Vans only" if outlet.van_only else "Trucks and vans"
        window_start = outlet.window_start.strftime("%H:%M") if outlet.window_start else "04:00"
        window_end = outlet.window_end.strftime("%H:%M") if outlet.window_end else "07:45"
        brand_label = outlet.brand.value.title() if hasattr(outlet.brand, "value") else str(outlet.brand).title()
        depot_label = outlet.depot.value.title() if hasattr(outlet.depot, "value") else str(outlet.depot).title()

        return OutletSettingsRead(
            outlet_id=outlet.id,
            outlet_code=outlet.code,
            outlet_name=outlet.name,
            brand=brand_label,
            district=outlet.district,
            serving_depot=depot_label,
            store_manager=settings.store_manager,
            contact_phone=settings.contact_phone,
            emergency_contact=settings.emergency_contact,
            window_start=window_start,
            window_end=window_end,
            dock_type=dock_type_label,
            vehicle_access=vehicle_access,
            parking=settings.parking,
            driver_check_in_call=settings.driver_check_in_call,
            share_dock_gate_code=settings.share_dock_gate_code,
            email_alerts_issues=settings.email_alerts_issues,
            sms_alerts_priority=settings.sms_alerts_priority,
            is_verified=True,
            last_synced_at=settings.last_synced_at,
        )

    @classmethod
    def update_settings(
        cls, db: Session, outlet_id_or_code: Union[int, str], update_data: OutletSettingsUpdate
    ) -> OutletSettingsRead:
        outlet = cls._find_outlet(db, outlet_id_or_code)
        settings = cls._get_or_create_settings(db, outlet)

        if update_data.contact_phone is not None:
            settings.contact_phone = update_data.contact_phone
        if update_data.emergency_contact is not None:
            settings.emergency_contact = update_data.emergency_contact
        if update_data.driver_check_in_call is not None:
            settings.driver_check_in_call = update_data.driver_check_in_call
        if update_data.share_dock_gate_code is not None:
            settings.share_dock_gate_code = update_data.share_dock_gate_code
        if update_data.email_alerts_issues is not None:
            settings.email_alerts_issues = update_data.email_alerts_issues
        if update_data.sms_alerts_priority is not None:
            settings.sms_alerts_priority = update_data.sms_alerts_priority

        settings.last_synced_at = datetime.utcnow()
        db.commit()
        db.refresh(settings)

        return cls.get_settings(db, outlet.id)

    @classmethod
    def reset_settings(cls, db: Session, outlet_id_or_code: Union[int, str]) -> OutletSettingsRead:
        outlet = cls._find_outlet(db, outlet_id_or_code)
        settings = cls._get_or_create_settings(db, outlet)

        settings.contact_phone = None
        settings.emergency_contact = None
        settings.driver_check_in_call = True
        settings.share_dock_gate_code = True
        settings.email_alerts_issues = True
        settings.sms_alerts_priority = False
        settings.last_synced_at = datetime.utcnow()
        db.commit()
        db.refresh(settings)

        return cls.get_settings(db, outlet.id)


outlet_service = OutletService()
