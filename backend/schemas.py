"""Pydantic request models for the JSON endpoints. Multipart endpoints (photo
uploads, check-ins) take their fields via FastAPI Form/UploadFile params instead."""
from pydantic import BaseModel


class SignupRequest(BaseModel):
    email: str
    password: str
    name: str
    phone: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class ResolveEventRequest(BaseModel):
    job_id: int


class AddAdminRequest(BaseModel):
    email: str
    name: str
