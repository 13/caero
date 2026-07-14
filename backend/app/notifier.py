"""Alert notifier (email + Telegram)."""
from __future__ import annotations

import asyncio
import logging
import smtplib
from decimal import Decimal
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_bot_token: str = settings.telegram_bot_token


def configure_telegram(token: str) -> None:
    global _bot_token
    _bot_token = token or settings.telegram_bot_token


def get_telegram_token() -> str:
    return _bot_token


def _build_message(subject: str, body: str, to_email: str) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg.attach(MIMEText(body, "plain"))
    return msg


# Transient failures (network blips, Telegram 5xx, SMTP hiccups) are common
# enough that one lost notification defeats the point of a price tracker.
_RETRY_DELAYS_SECONDS = (2, 5)


async def _send_telegram_alert(*, chat_id: str, text: str) -> None:
    token = _bot_token
    if not token:
        logger.info("Telegram bot token not configured — skipping Telegram notification")
        return
    for attempt, delay in enumerate((*_RETRY_DELAYS_SECONDS, None), start=1):
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"https://api.telegram.org/bot{token}/sendMessage",
                    json={"chat_id": chat_id, "text": text},
                    timeout=10.0,
                )
                response.raise_for_status()
                logger.info("Telegram alert sent to chat %s", chat_id)
                return
        except Exception as exc:
            if delay is None:
                logger.error(
                    "Failed to send Telegram alert to chat %s after %d attempts: %s",
                    chat_id, attempt, exc,
                )
                return
            logger.warning(
                "Telegram send to chat %s failed (attempt %d), retrying in %ds: %s",
                chat_id, attempt, delay, exc,
            )
            await asyncio.sleep(delay)


def _send_email_alert_sync(*, to_email: str, msg: MIMEMultipart, subject: str) -> None:
    import time

    for attempt, delay in enumerate((*_RETRY_DELAYS_SECONDS, None), start=1):
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
                if settings.smtp_tls:
                    server.starttls()
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password)
                server.sendmail(settings.smtp_from, [to_email], msg.as_string())
            logger.info("Email alert sent to %s (%s)", to_email, subject)
            return
        except Exception as exc:
            if delay is None:
                logger.error(
                    "Failed to send email alert to %s after %d attempts: %s",
                    to_email, attempt, exc,
                )
                return
            logger.warning(
                "Email send to %s failed (attempt %d), retrying in %ds: %s",
                to_email, attempt, delay, exc,
            )
            time.sleep(delay)


async def _post_with_retry(channel: str, url: str, **request_kwargs) -> None:
    for attempt, delay in enumerate((*_RETRY_DELAYS_SECONDS, None), start=1):
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, timeout=10.0, **request_kwargs)
                response.raise_for_status()
                logger.info("%s notification sent", channel)
                return
        except Exception as exc:
            if delay is None:
                logger.error("Failed to send %s notification after %d attempts: %s", channel, attempt, exc)
                return
            logger.warning("%s send failed (attempt %d), retrying in %ds: %s", channel, attempt, delay, exc)
            await asyncio.sleep(delay)


async def _send_webhook_notifications(subject: str, body: str) -> None:
    """Broadcast to every configured global webhook channel (ntfy/Gotify/Discord)."""
    if settings.ntfy_url:
        await _post_with_retry(
            "ntfy",
            settings.ntfy_url,
            content=body.encode("utf-8"),
            headers={"Title": subject},
        )
    if settings.gotify_url and settings.gotify_token:
        await _post_with_retry(
            "Gotify",
            f"{settings.gotify_url.rstrip('/')}/message",
            params={"token": settings.gotify_token},
            json={"title": subject, "message": body, "priority": 5},
        )
    if settings.discord_webhook_url:
        await _post_with_retry(
            "Discord",
            settings.discord_webhook_url,
            json={"content": f"**{subject}**\n{body}"[:2000]},
        )


def _webhooks_configured() -> bool:
    return bool(
        settings.ntfy_url
        or (settings.gotify_url and settings.gotify_token)
        or settings.discord_webhook_url
    )


async def notify(
    *,
    email: str | None,
    telegram_chat_id: str | None,
    subject: str,
    body: str,
) -> None:
    """Send a notification to the recipient channels plus all global webhooks."""
    if not email and not telegram_chat_id and not _webhooks_configured():
        logger.info("No notification recipient configured (%s)", subject)
        return

    if email:
        if not settings.smtp_host:
            logger.info("SMTP not configured — skipping email notification to %s", email)
        else:
            msg = _build_message(subject, body, email)
            await asyncio.to_thread(
                _send_email_alert_sync, to_email=email, msg=msg, subject=subject
            )

    if telegram_chat_id:
        await _send_telegram_alert(chat_id=telegram_chat_id, text=f"{subject}\n\n{body}")

    await _send_webhook_notifications(subject, body)


async def send_alert(
    *,
    to_email: str | None = None,
    telegram_chat_id: str | None = None,
    product_name: str,
    product_url: str,
    condition: str,
    current_price: Decimal,
    threshold_price: Decimal | None = None,
    threshold_percent: Decimal | None = None,
    previous_price: Decimal | None = None,
) -> None:
    if condition == "below":
        subject = f"[Caero] Price alert: {product_name} is below {threshold_price}"
        body = (
            f"The price of {product_name} has dropped to {current_price}.\n"
            f"Your threshold: {threshold_price}\n"
            f"Product URL: {product_url}\n"
        )
    elif condition == "lowered_percent":
        drop = ""
        if previous_price and previous_price > 0:
            drop_percent = (previous_price - current_price) / previous_price * Decimal(100)
            drop = f" (-{drop_percent.quantize(Decimal('0.1'))}%)"
        subject = f"[Caero] Price alert: {product_name} dropped{drop}"
        body = (
            f"The price of {product_name} dropped from {previous_price} to {current_price}{drop}.\n"
            f"Your threshold: at least {threshold_percent}% down\n"
            f"Product URL: {product_url}\n"
        )
    elif condition == "lowered":
        subject = f"[Caero] Price alert: {product_name} price lowered"
        body = (
            f"The price of {product_name} has been lowered to {current_price}.\n"
            f"Product URL: {product_url}\n"
        )
    else:
        subject = f"[Caero] Price change: {product_name}"
        body = (
            f"The price of {product_name} has changed to {current_price}.\n"
            f"Product URL: {product_url}\n"
        )

    await notify(
        email=to_email,
        telegram_chat_id=telegram_chat_id,
        subject=subject,
        body=body,
    )
