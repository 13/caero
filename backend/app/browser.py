"""Shared Patchright browser instance.

Owned by the FastAPI lifespan in app.main; consumers (scheduler, routers)
read it from here instead of importing app.main, which would be a circular
import.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from patchright.async_api import Browser

_browser: Browser | None = None
_backend: str = "unknown"


def set_browser(browser: Browser | None, backend: str = "patchright") -> None:
    global _browser, _backend
    _browser = browser
    _backend = backend


def get_browser() -> Browser | None:
    return _browser


def get_backend() -> str:
    return _backend
