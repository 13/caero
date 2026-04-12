"""Alert notifier (email + Telegram)."""
from __future__ import annotations

import logging
import smtplib
from decimal import Decimal
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


def _build_message(subject: str, body: str, to_email: str) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg.attach(MIMEText(body, "plain"))
    return msg


def _build_notification(subject: str, body: str) -> str:
    return f"{subject}\n\n{body}"


def _send_telegram_alert(*, chat_id: str, text: str) -> None:
    if not settings.telegram_bot_token:
        logger.info("Telegram bot token not configured — skipping Telegram notification")
        return
    try:
        response = httpx.post(
            f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": text},
            timeout=10.0,
        )
        response.raise_for_status()
        logger.info("Telegram alert sent to chat %s", chat_id)
    except Exception as exc:
        logger.error("Failed to send Telegram alert to chat %s: %s", chat_id, exc)


def _send_email_alert(*, to_email: str, msg: MIMEMultipart, product_name: str) -> None:
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
        logger.info("Email alert sent to %s for %s", to_email, product_name)
    except Exception as exc:
        logger.error("Failed to send email alert to %s: %s", to_email, exc)


def send_alert(
    *,
    to_email: str | None = None,
    telegram_chat_id: str | None = None,
    product_name: str,
    product_url: str,
    condition: str,
    current_price: Decimal,
    threshold_price: Decimal | None = None,
) -> None:
    if not to_email and not telegram_chat_id:
        logger.info("No alert recipient configured for %s", product_name)
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

    if to_email:
        if not settings.smtp_host:
            logger.info(
                "SMTP not configured — skipping email notification to %s for %s",
                to_email,
                product_name,
            )
        else:
            msg = _build_message(subject, body, to_email)
            _send_email_alert(to_email=to_email, msg=msg, product_name=product_name)

    if telegram_chat_id:
        _send_telegram_alert(
            chat_id=telegram_chat_id,
            text=_build_notification(subject, body),
        )
