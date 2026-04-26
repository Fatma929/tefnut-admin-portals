-- =============================================================================
-- Tefnut CBAM Support Tables — Migration 0003
-- Target: PostgreSQL (RDS)
--
-- Standards covered:
--   EU CBAM 2023/956 — Carbon Border Adjustment Mechanism
--
-- Tables added:
--   cbam_ets_price_history  — weekly EU ETS carbon price snapshots
--   cbam_fx_rates           — daily FX rates to EUR for CBAM calculations
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. CBAM ETS PRICE HISTORY  (weekly EU ETS carbon price — EUR/tCO₂e)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cbam_ets_price_history (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    week_start_date     DATE        NOT NULL UNIQUE,
    price_eur_per_t_co2e NUMERIC(10,4) NOT NULL,
    source_url          TEXT        NOT NULL,
    fetched_at_utc      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cbam_ets_week
    ON cbam_ets_price_history(week_start_date);

-- ---------------------------------------------------------------------------
-- 2. CBAM FX RATES  (daily exchange rates to EUR)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cbam_fx_rates (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    currency_code   CHAR(3)     NOT NULL,
    rate_date       DATE        NOT NULL,
    rate_to_eur     NUMERIC(18,8) NOT NULL,
    fetched_at_utc  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (currency_code, rate_date)
);

CREATE INDEX IF NOT EXISTS idx_cbam_fx_currency_date
    ON cbam_fx_rates(currency_code, rate_date);
