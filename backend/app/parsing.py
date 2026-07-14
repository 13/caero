"""Pure text-parsing helpers for scraped price strings."""
from __future__ import annotations

import re

# Symbols/codes that identify a currency inside a scraped price string.
# Checked in order; word-boundary match for alphabetic codes.
_CURRENCY_PATTERNS: list[tuple[str, str]] = [
    ("€", "EUR"),
    ("£", "GBP"),
    ("US$", "USD"),
    ("$", "USD"),
    ("zł", "PLN"),
    ("¥", "JPY"),
    ("₹", "INR"),
]
_CURRENCY_CODES = ("EUR", "USD", "GBP", "CHF", "PLN", "SEK", "NOK", "DKK", "JPY")


def detect_currency(raw: str | None) -> str | None:
    """Best-effort currency detection from a scraped price string."""
    if not raw:
        return None
    for symbol, code in _CURRENCY_PATTERNS:
        if symbol in raw:
            return code
    upper = raw.upper()
    for code in _CURRENCY_CODES:
        if re.search(rf"\b{code}\b", upper):
            return code
    return None


def parse_price(raw: str | None, price_format: str = "auto") -> float | None:
    """Normalise price strings to float.

    price_format:
      'eu'   — comma is the decimal separator, dot is thousands (1.234,56)
      'us'   — dot is the decimal separator, comma is thousands (1,234.56)
      'auto' — heuristic; ambiguous strings like "1,234" parse as US thousands
    """
    if not raw:
        return None
    # Remove currency symbols and whitespace
    cleaned = re.sub(r"[^\d.,]", "", raw.strip())
    if not cleaned:
        return None

    if price_format == "eu":
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif price_format == "us":
        cleaned = cleaned.replace(",", "")
    # Auto heuristic below
    elif re.search(r"\d\.\d{3},\d{2}$", cleaned):
        # Thousands dot + comma decimal: 1.234,56 → 1234.56
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif re.search(r",\d{2}$", cleaned):
        # Comma decimal only: 1234,56 → 1234.56
        cleaned = cleaned.replace(",", ".")
    else:
        # English format or no decimal: remove commas as thousands sep
        cleaned = cleaned.replace(",", "")

    try:
        return float(cleaned)
    except ValueError:
        return None
