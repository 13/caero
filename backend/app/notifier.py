"""Email notifier."""
from __future__ import annotations

import logging
import smtplib
from decimal import Decimal
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import settings

logger = logging.getLogger(__name__)


def _build_message(subject: str, body: str, to_email: str) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg.attach(MIMEText(body, "plain"))
    return msg


def send_alert(
    *,
    to_email: str,
    product_name: str,
    product_url: str,
    condition: str,
    current_price: Decimal,
    threshold_price: Decimal | None = None,
) -> None:
    if not settings.smtp_host:
        logger.info(
            "SMTP not configured — skipping notification to %s for %s",
            to_email,
            product_name,
        )
        return

    if condition == "below":
        subject = f"[Caero] Price alert: {product_name} is below {threshold_price}"
        body = (
            f"The price of {product_name} has dropped to {current_price}.\n"
            f"Your threshold: {threshold_price}\n"
            f"Product URL: {product_url}\n"
        )
    else:
        subject = f"[Caero] Price change: {product_name}"
        body = (
            f"The price of {product_name} has changed to {current_price}.\n"
            f"Product URL: {product_url}\n"
        )

    msg = _build_message(subject, body, to_email)

    try:
        if settings.smtp_tls:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
                server.starttls()
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password)
                server.sendmail(settings.smtp_from, [to_email], msg.as_string())
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password)
                server.sendmail(settings.smtp_from, [to_email], msg.as_string())
        logger.info("Alert sent to %s for %s", to_email, product_name)
    except Exception as exc:
        logger.error("Failed to send alert to %s: %s", to_email, exc)
