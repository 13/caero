"""Notifier: email, Telegram and global webhook channels.

Messages are built once as a structured `Notification` and rendered per
channel — Telegram gets HTML with links/buttons, email and ntfy/Gotify get
plain text, Discord gets markdown.
"""
from __future__ import annotations

import asyncio
import html
import ipaddress
import logging
import smtplib
from dataclasses import dataclass, field
from decimal import Decimal
from email.header import Header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from urllib.parse import urlparse

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_bot_token: str = settings.telegram_bot_token


def configure_telegram(token: str) -> None:
    global _bot_token
    _bot_token = token or settings.telegram_bot_token


def get_telegram_token() -> str:
    return _bot_token


# ── Message model & rendering ─────────────────────────────────────────────────


@dataclass
class Notification:
    title: str
    emoji: str = ""
    product: str | None = None
    facts: list[tuple[str, str]] = field(default_factory=list)
    text: list[str] = field(default_factory=list)
    links: list[tuple[str, str]] = field(default_factory=list)

    @property
    def subject(self) -> str:
        """Plain one-line subject (email subject, ntfy/Gotify title)."""
        return f"{self.title}: {self.product}" if self.product else self.title


_CURRENCY_SYMBOLS = {"EUR": "€", "USD": "$", "GBP": "£", "JPY": "¥", "INR": "₹"}


def format_price(price: Decimal | None, currency: str | None = None) -> str:
    if price is None:
        return "—"
    amount = f"{price:,.2f}"
    code = (currency or "").upper()
    if code in _CURRENCY_SYMBOLS:
        return f"{_CURRENCY_SYMBOLS[code]}{amount}"
    return f"{code} {amount}" if code else amount


def caero_url(path: str = "/") -> str | None:
    """Absolute link into the Caero UI, or None when PUBLIC_URL is not set."""
    base = settings.public_url.strip().rstrip("/")
    if not base:
        return None
    return f"{base}/{path.lstrip('/')}"


def product_links(product_id: int, shop_url: str | None) -> list[tuple[str, str]]:
    links = []
    if (url := caero_url(f"/products/{product_id}")) is not None:
        links.append(("Open in Caero", url))
    if shop_url:
        links.append(("Open shop", shop_url))
    return links


def render_plain(message: Notification) -> str:
    blocks = []
    if message.product:
        blocks.append(message.product)
    if message.facts:
        blocks.append("\n".join(f"{label}: {value}" for label, value in message.facts))
    blocks.extend(message.text)
    if message.links:
        blocks.append("\n".join(f"{label}: {url}" for label, url in message.links))
    return "\n\n".join(blocks) + "\n"


def render_telegram_html(message: Notification, *, include_links: bool = True) -> str:
    esc = html.escape
    head = f"{message.emoji} <b>{esc(message.title)}</b>" if message.emoji else f"<b>{esc(message.title)}</b>"
    lines = [head]
    if message.product:
        lines.append(esc(message.product))
    blocks = ["\n".join(lines)]
    if message.facts:
        blocks.append("\n".join(f"{esc(label)}: <b>{esc(value)}</b>" for label, value in message.facts))
    blocks.extend(esc(paragraph) for paragraph in message.text)
    if include_links and message.links:
        blocks.append(
            " · ".join(f'<a href="{esc(url, quote=True)}">{esc(label)}</a>' for label, url in message.links)
        )
    return "\n\n".join(blocks)


def render_discord(message: Notification) -> str:
    head = f"{message.emoji} **{message.title}**" if message.emoji else f"**{message.title}**"
    lines = [head]
    if message.product:
        lines.append(message.product)
    blocks = ["\n".join(lines)]
    if message.facts:
        blocks.append("\n".join(f"{label}: **{value}**" for label, value in message.facts))
    blocks.extend(message.text)
    if message.links:
        # <url> suppresses Discord's link embeds.
        blocks.append(" · ".join(f"[{label}](<{url}>)" for label, url in message.links))
    return "\n\n".join(blocks)[:2000]


def _button_safe(url: str) -> bool:
    """Telegram rejects inline buttons for LAN IPs, localhost and dotless hosts."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    host = parsed.hostname or ""
    if parsed.scheme not in ("http", "https") or "." not in host:
        return False
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return True
    return False


def telegram_payload(chat_id: str, message: Notification) -> dict:
    payload: dict = {
        "chat_id": chat_id,
        "parse_mode": "HTML",
        "link_preview_options": {"is_disabled": True},
    }
    if message.links and all(_button_safe(url) for _, url in message.links):
        payload["text"] = render_telegram_html(message, include_links=False)
        payload["reply_markup"] = {
            "inline_keyboard": [[{"text": label, "url": url} for label, url in message.links]]
        }
    else:
        payload["text"] = render_telegram_html(message)
    return payload


# ── Channel senders ───────────────────────────────────────────────────────────


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


async def send_telegram_message(token: str, chat_id: str, message: Notification) -> None:
    """Single send attempt; raises on failure.

    A 400 almost always means Telegram refused the formatting or a button URL.
    Resend as plain text then, so the notification still arrives.
    """
    async with httpx.AsyncClient() as client:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        response = await client.post(url, json=telegram_payload(chat_id, message), timeout=10.0)
        if response.status_code == 400:
            logger.warning(
                "Telegram rejected formatted message to chat %s (%s) — resending as plain text",
                chat_id, response.text[:200],
            )
            text = f"{message.emoji} {message.subject}".strip() + "\n\n" + render_plain(message)
            response = await client.post(url, json={"chat_id": chat_id, "text": text}, timeout=10.0)
        response.raise_for_status()


async def _send_telegram_alert(*, chat_id: str, message: Notification) -> None:
    token = _bot_token
    if not token:
        logger.info("Telegram bot token not configured — skipping Telegram notification")
        return
    for attempt, delay in enumerate((*_RETRY_DELAYS_SECONDS, None), start=1):
        try:
            await send_telegram_message(token, chat_id, message)
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


def _header_value(value: str) -> str:
    """HTTP headers are ASCII-only; ntfy decodes RFC 2047 for anything else (umlauts, emoji)."""
    if value.isascii():
        return value
    return Header(value, "utf-8").encode()


async def _send_webhook_notifications(message: Notification) -> None:
    """Broadcast to every configured global webhook channel (ntfy/Gotify/Discord)."""
    body = render_plain(message)
    if settings.ntfy_url:
        headers = {"Title": _header_value(message.subject)}
        if message.links:
            headers["Click"] = message.links[0][1]
        await _post_with_retry(
            "ntfy",
            settings.ntfy_url,
            content=body.encode("utf-8"),
            headers=headers,
        )
    if settings.gotify_url and settings.gotify_token:
        await _post_with_retry(
            "Gotify",
            f"{settings.gotify_url.rstrip('/')}/message",
            params={"token": settings.gotify_token},
            json={"title": message.subject, "message": body, "priority": 5},
        )
    if settings.discord_webhook_url:
        await _post_with_retry(
            "Discord",
            settings.discord_webhook_url,
            json={"content": render_discord(message)},
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
    message: Notification,
) -> None:
    """Send a notification to the recipient channels plus all global webhooks."""
    if not email and not telegram_chat_id and not _webhooks_configured():
        logger.info("No notification recipient configured (%s)", message.subject)
        return

    if email:
        if not settings.smtp_host:
            logger.info("SMTP not configured — skipping email notification to %s", email)
        else:
            subject = f"[Caero] {message.subject}"
            msg = _build_message(subject, render_plain(message), email)
            await asyncio.to_thread(
                _send_email_alert_sync, to_email=email, msg=msg, subject=subject
            )

    if telegram_chat_id:
        await _send_telegram_alert(chat_id=telegram_chat_id, message=message)

    await _send_webhook_notifications(message)


def build_alert_message(
    *,
    product_id: int,
    product_name: str,
    product_url: str,
    condition: str,
    current_price: Decimal,
    currency: str | None = None,
    threshold_price: Decimal | None = None,
    threshold_percent: Decimal | None = None,
    previous_price: Decimal | None = None,
) -> Notification:
    def fmt(value: Decimal | None) -> str:
        return format_price(value, currency)

    was = fmt(previous_price)
    if previous_price and previous_price > 0 and current_price != previous_price:
        change = (current_price - previous_price) / previous_price * Decimal(100)
        sign = "+" if change > 0 else "−"
        was = f"{was} ({sign}{abs(change).quantize(Decimal('0.1'))}%)"

    facts = [("Now", fmt(current_price))]
    if previous_price is not None:
        facts.append(("Was", was))

    if condition == "below":
        emoji, title = "🎯", "Below your target price"
        facts.append(("Target", fmt(threshold_price)))
    elif condition == "lowered_percent":
        emoji, title = "📉", "Price dropped"
        facts.append(("Alert", f"at least {threshold_percent}% down"))
    elif condition == "lowered":
        emoji, title = "📉", "Price dropped"
    else:
        emoji, title = "🔔", "Price changed"

    return Notification(
        emoji=emoji,
        title=title,
        product=product_name,
        facts=facts,
        links=product_links(product_id, product_url),
    )


async def send_alert(
    *,
    to_email: str | None = None,
    telegram_chat_id: str | None = None,
    **message_kwargs,
) -> None:
    await notify(
        email=to_email,
        telegram_chat_id=telegram_chat_id,
        message=build_alert_message(**message_kwargs),
    )
