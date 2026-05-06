"""SMTP email service — uses Python stdlib smtplib, no external deps.

Configure via environment variables (or .env):
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_TLS
"""
from __future__ import annotations

import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import settings

logger = logging.getLogger(__name__)


def _is_configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_from)


def send_email(to: str, subject: str, body_html: str, body_text: str = "") -> bool:
    """Send an email. Returns True on success, False on failure (never raises)."""
    if not _is_configured():
        logger.warning("Email not configured — skipping send to %s: %s", to, subject)
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = to

    if body_text:
        msg.attach(MIMEText(body_text, "plain"))
    msg.attach(MIMEText(body_html, "html"))

    try:
        context = ssl.create_default_context()
        if settings.smtp_tls:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
                server.ehlo()
                server.starttls(context=context)
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password)
                server.sendmail(settings.smtp_from, to, msg.as_string())
        else:
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=context, timeout=10) as server:
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password)
                server.sendmail(settings.smtp_from, to, msg.as_string())
        logger.info("Email sent to %s: %s", to, subject)
        return True
    except Exception as exc:
        logger.error("Failed to send email to %s: %s", to, exc)
        return False


def send_password_reset_notification(to: str, username: str) -> bool:
    html = f"""
    <html><body style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px">
      <h2 style="color:#00d9a5">AutoClean AI — Password Reset</h2>
      <p>Hi <strong>{username}</strong>,</p>
      <p>An administrator has reset your password. Please contact your administrator to obtain your new credentials and log in.</p>
      <p style="margin-top:16px">Once logged in, change your password immediately from your Profile page.</p>
      <p style="color:#666;font-size:12px">If you didn't expect this, contact your administrator.</p>
    </body></html>
    """
    text = f"Hi {username}, an administrator has reset your AutoClean AI password. Contact your administrator for your new credentials and change your password after logging in."
    return send_email(to, "AutoClean AI — Your password has been reset", html, text)


def send_welcome_email(to: str, username: str) -> bool:
    html = f"""
    <html><body style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px">
      <h2 style="color:#00d9a5">Welcome to AutoClean AI</h2>
      <p>Hi <strong>{username}</strong>,</p>
      <p>Your account has been created successfully. You can now log in and start cleaning your data.</p>
      <p><a href="{settings.allowed_origins.split(',')[0]}/login" style="color:#00d9a5">Log in →</a></p>
    </body></html>
    """
    text = f"Welcome to AutoClean AI, {username}! Your account is ready."
    return send_email(to, "Welcome to AutoClean AI", html, text)


def send_test_email(to: str) -> bool:
    html = """
    <html><body style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px">
      <h2 style="color:#00d9a5">AutoClean AI — Test Email</h2>
      <p>If you received this, your SMTP configuration is working correctly.</p>
    </body></html>
    """
    return send_email(to, "AutoClean AI — SMTP test", html, "SMTP test from AutoClean AI — configuration is working.")
