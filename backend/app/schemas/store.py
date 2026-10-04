from typing import Optional
from pydantic import BaseModel


class StoreManagerRead(BaseModel):
    id: int
    full_name: str
    email: str
    role: str


class StoreOutletRead(BaseModel):
    id: int
    code: str
    name: str
    brand: str
    district: str
    depot: Optional[str] = None
    window_start: Optional[str] = None
    window_end: Optional[str] = None


class StoreMeRead(BaseModel):
    """Who is signed in to the Store Manager screens and which outlet they run."""

    manager: StoreManagerRead
    outlet: StoreOutletRead
