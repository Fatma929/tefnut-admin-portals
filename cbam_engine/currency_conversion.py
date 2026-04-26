"""
Tefnut CBAM — ECB Exchange Rate Layer
Fetches daily EUR rates from the European Central Bank Statistical Data Warehouse API.
Caches results in cbam_fx_rates table.
"""
from __future__ import annotations

import logging
import os
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)

ECB_API_URL = "https://data-api.ecb.europa.eu/service/data/EXR/D.{currency}.EUR.SP00.A"


class CurrencyConversionLayer:
    """
    Provides EUR exchange rates for CBAM carbon price credit calculations.

    Resolution order:
      1. cbam_fx_rates cache (DB lookup)
      2. ECB API fetch + cache
      3. Most recent cached rate + CBAM_RATE_DATE_FALLBACK warning
      4. Raise ValueError("CBAM_UNSUPPORTED_CURRENCY") if nothing available
    """

    def __init__(self) -> None:
        self._warnings: list[str] = []

    def get_rate_to_eur(
        self,
        currency_code: str,
        rate_date: Optional[str],
        db=None,
    ) -> tuple[float, str]:
        """
        Returns (rate_to_eur, actual_rate_date).
        If rate_date is None, uses the latest available rate.
        """
        self._warnings = []
        currency_code = currency_code.upper()

        if currency_code == "EUR":
            return 1.0, rate_date or str(date.today())

        target_date = rate_date

        # If no date provided, flag fallback and use latest
        if target_date is None:
            self._warnings.append("CBAM_RATE_DATE_FALLBACK")

        # 1. Try DB cache
        if db is not None:
            cached = self._lookup_cache(db, currency_code, target_date)
            if cached is not None:
                return cached

        # 2. Try ECB API
        try:
            rate, actual_date = self._fetch_from_ecb(currency_code, target_date)
            if db is not None:
                self._cache_rate(db, currency_code, actual_date, rate)
            return rate, actual_date
        except Exception as exc:
            logger.warning("ECB API fetch failed for %s: %s", currency_code, exc)

        # 3. Fallback to most recent cached rate
        if db is not None:
            fallback = self._lookup_most_recent(db, currency_code)
            if fallback is not None:
                self._warnings.append("CBAM_RATE_DATE_FALLBACK")
                return fallback

        # 4. Standalone fallback via psycopg2
        try:
            return self._standalone_lookup(currency_code, target_date)
        except Exception:
            pass

        raise ValueError("CBAM_UNSUPPORTED_CURRENCY")

    def _lookup_cache(self, db, currency_code: str, rate_date: Optional[str]):
        """Look up exact date in cbam_fx_rates."""
        if rate_date is None:
            return self._lookup_most_recent(db, currency_code)
        try:
            row = db.queryOne(
                "SELECT rate_to_eur, rate_date FROM cbam_fx_rates "
                "WHERE currency_code = $1 AND rate_date = $2",
                [currency_code, rate_date],
            )
            if row:
                return float(row["rate_to_eur"]), str(row["rate_date"])
        except Exception as exc:
            logger.debug("Cache lookup failed: %s", exc)
        return None

    def _lookup_most_recent(self, db, currency_code: str):
        """Return most recent cached rate for currency."""
        try:
            row = db.queryOne(
                "SELECT rate_to_eur, rate_date FROM cbam_fx_rates "
                "WHERE currency_code = $1 ORDER BY rate_date DESC LIMIT 1",
                [currency_code],
            )
            if row:
                return float(row["rate_to_eur"]), str(row["rate_date"])
        except Exception as exc:
            logger.debug("Most-recent cache lookup failed: %s", exc)
        return None

    def _fetch_from_ecb(self, currency_code: str, rate_date: Optional[str]) -> tuple[float, str]:
        """Fetch rate from ECB Statistical Data Warehouse API."""
        import urllib.request
        import urllib.parse

        url = ECB_API_URL.format(currency=currency_code)
        params = "?format=jsondata"
        if rate_date:
            params += f"&startPeriod={rate_date}&endPeriod={rate_date}"
        else:
            params += "&detail=dataonly"

        full_url = url + params
        req = urllib.request.Request(full_url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            import json
            data = json.loads(resp.read().decode("utf-8"))

        # Parse ECB JSON response structure
        series = data["dataSets"][0]["series"]
        series_key = list(series.keys())[0]
        observations = series[series_key]["observations"]

        # Get time dimension
        time_periods = data["structure"]["dimensions"]["observation"][0]["values"]

        # Find the last observation
        last_idx = max(int(k) for k in observations.keys())
        rate = float(observations[str(last_idx)][0])
        actual_date = time_periods[last_idx]["id"]

        return rate, actual_date

    def _cache_rate(self, db, currency_code: str, rate_date: str, rate: float) -> None:
        """Insert or update rate in cbam_fx_rates."""
        try:
            db.query(
                """INSERT INTO cbam_fx_rates (currency_code, rate_date, rate_to_eur)
                   VALUES ($1, $2, $3)
                   ON CONFLICT (currency_code, rate_date)
                   DO UPDATE SET rate_to_eur = EXCLUDED.rate_to_eur,
                                 fetched_at_utc = now()""",
                [currency_code, rate_date, rate],
            )
        except Exception as exc:
            logger.warning("Failed to cache FX rate: %s", exc)

    def _standalone_lookup(self, currency_code: str, rate_date: Optional[str]) -> tuple[float, str]:
        """Fallback: connect directly via DATABASE_URL env var using psycopg2."""
        import psycopg2
        import psycopg2.extras

        db_url = os.environ.get("DATABASE_URL")
        if not db_url:
            raise ValueError("DATABASE_URL not set")

        conn = psycopg2.connect(db_url)
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if rate_date:
                    cur.execute(
                        "SELECT rate_to_eur, rate_date FROM cbam_fx_rates "
                        "WHERE currency_code = %s AND rate_date = %s",
                        [currency_code, rate_date],
                    )
                else:
                    cur.execute(
                        "SELECT rate_to_eur, rate_date FROM cbam_fx_rates "
                        "WHERE currency_code = %s ORDER BY rate_date DESC LIMIT 1",
                        [currency_code],
                    )
                row = cur.fetchone()
                if row:
                    return float(row["rate_to_eur"]), str(row["rate_date"])
        finally:
            conn.close()

        raise ValueError("CBAM_UNSUPPORTED_CURRENCY")
