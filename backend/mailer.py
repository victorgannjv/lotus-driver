"""Password-reset emails via generic SMTP -- works with any relay (corporate mail
server, Office 365, Gmail SMTP, or a transactional provider's SMTP interface).
Named mailer.py, not email.py: this file lands at /app/email.py in the container
otherwise (see cicd/Dockerfile.backend's `COPY backend/ .` into WORKDIR /app), which
would shadow Python's own stdlib `email` package used below."""
import os
import smtplib
import ssl
from email.message import EmailMessage


def send_password_reset_email(to_email: str, reset_link: str) -> None:
    host = os.environ["SMTP_HOST"]
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    from_email = os.getenv("SMTP_FROM_EMAIL") or user or "no-reply@example.com"
    from_name = os.getenv("SMTP_FROM_NAME", "Lotus Driver Tracking")

    msg = EmailMessage()
    msg["Subject"] = "Reset your Lotus Driver Tracking password"
    msg["From"] = f"{from_name} <{from_email}>"
    msg["To"] = to_email
    msg.set_content(
        "We received a request to reset your Lotus Driver Tracking password.\n\n"
        f"Reset it here (link expires in 1 hour): {reset_link}\n\n"
        "If you didn't request this, you can safely ignore this email."
    )

    with smtplib.SMTP(host, port, timeout=10) as smtp:
        smtp.starttls(context=ssl.create_default_context())
        if user and password:
            smtp.login(user, password)
        smtp.send_message(msg)
