"""Pydantic request models for the JSON endpoints. The delivery-outcome endpoints
(/scans/complete, /scans/fail) take a proof photo, so those use multipart/form-data
with FastAPI Form/UploadFile params directly instead of a model here."""
from pydantic import BaseModel


class SignupRequest(BaseModel):
    email: str
    password: str
    name: str
    phone: str | None = None
    warehouse_id: int | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class AddAdminRequest(BaseModel):
    email: str
    name: str


class ScanRequest(BaseModel):
    code: str
    manifest_id: int | None = None
    lat: float | None = None
    lng: float | None = None
    occurred_at: str | None = None


class WarehouseRequest(BaseModel):
    name: str
    address: str | None = None


class DriverWarehouseRequest(BaseModel):
    warehouse_id: int
