from app.parsing import detect_currency, parse_price


class TestParsePrice:
    def test_european_thousands_and_decimal(self):
        assert parse_price("1.234,56 €") == 1234.56

    def test_european_decimal_only(self):
        assert parse_price("12,34 €") == 12.34

    def test_english_thousands_and_decimal(self):
        assert parse_price("$1,234.56") == 1234.56

    def test_english_decimal_only(self):
        assert parse_price("$12.34") == 12.34

    def test_plain_integer(self):
        assert parse_price("999") == 999.0

    def test_english_thousands_no_decimal(self):
        assert parse_price("1,234") == 1234.0

    def test_currency_code_suffix(self):
        assert parse_price("1234.56 EUR") == 1234.56

    def test_empty(self):
        assert parse_price("") is None
        assert parse_price(None) is None

    def test_no_digits(self):
        assert parse_price("N/A") is None

    def test_whitespace_and_symbols(self):
        assert parse_price("  € 49,99 ") == 49.99

    def test_eu_mode_resolves_ambiguity(self):
        # "1,234" is ambiguous: EU comma-decimal vs US thousands
        assert parse_price("1,234", "eu") == 1.234
        assert parse_price("1,234", "us") == 1234.0
        assert parse_price("1,234", "auto") == 1234.0

    def test_eu_mode_full_format(self):
        assert parse_price("1.234,56 €", "eu") == 1234.56

    def test_us_mode_full_format(self):
        assert parse_price("$1,234.56", "us") == 1234.56

    def test_us_mode_rejects_nothing_but_parses_eu_string_wrong_on_purpose(self):
        # Forcing a mode overrides the heuristic — that's the point.
        assert parse_price("10,50", "us") == 1050.0


class TestDetectCurrency:
    def test_euro_symbol(self):
        assert detect_currency("1.234,56 €") == "EUR"

    def test_dollar_symbol(self):
        assert detect_currency("$12.34") == "USD"

    def test_pound_symbol(self):
        assert detect_currency("£9.99") == "GBP"

    def test_code(self):
        assert detect_currency("12.34 CHF") == "CHF"
        assert detect_currency("12.34 eur") == "EUR"

    def test_zloty(self):
        assert detect_currency("99,99 zł") == "PLN"

    def test_none_when_absent(self):
        assert detect_currency("12.34") is None
        assert detect_currency("") is None
        assert detect_currency(None) is None

    def test_code_needs_word_boundary(self):
        # "EUROPE" must not match EUR
        assert detect_currency("EUROPE 12") is None
