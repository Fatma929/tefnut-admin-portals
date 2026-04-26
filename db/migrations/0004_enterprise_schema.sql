
-- =============================================================================
-- Tefnut Enterprise Schema — Migration 0004
-- Target: Amazon RDS PostgreSQL 16+
--
-- What this migration adds (non-breaking — all new tables/columns):
--
--   ORGANIZATIONS:  + industry, currency, reporting_standard, fiscal_year_start
--   FACILITIES:     + kiln_type, production_lines, plant_type_detail, capacity_detail
--   NEW: reporting_periods   — structured period registry (replaces scattered year ints)
--   NEW: plant_inputs        — structured, queryable input snapshot per period
--   NEW: fuel_entries        — normalised fuel rows linked to plant_inputs
--   NEW: electricity_entries — normalised electricity rows
--   NEW: logistics_entries   — normalised logistics rows
--   NEW: water_entries       — normalised water rows (mirrors water_inventory, queryable)
--   NEW: calculation_runs    — versioned run registry (draft/final/approved)
--   NEW: calculation_results — structured KPI outputs (queryable, not JSON blobs)
--   NEW: benchmarks          — portfolio + reference benchmarks per period
--   NEW: scenario_runs       — future AI / what-if analysis
--   NEW: reduction_projects  — decarbonisation project tracking
--   NEW: iot_data_streams    — IoT integration metadata
--   NEW: erp_imports         — ERP sync audit trail
--
-- Backward compatibility:
--   All existing tables are UNCHANGED.
--   New columns on existing tables use ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
--   All new tables have org_id + RLS policies matching migration 0002.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- NEW ENUM TYPES
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE kiln_type AS ENUM (
    'dry_kiln', 'wet_kiln', 'semi_dry_kiln', 'dry_kiln_ph_pc',
    'vertical_shaft_kiln', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE period_status AS ENUM ('open', 'locked', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE run_status AS ENUM ('draft', 'submitted', 'under_review', 'approved', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE transport_mode AS ENUM ('road', 'rail', 'sea', 'air', 'pipeline', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE scenario_type AS ENUM ('baseline', 'reduction_target', 'what_if', 'ai_recommendation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE project_status AS ENUM ('proposed', 'approved', 'in_progress', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- EXTEND EXISTING TABLES (non-breaking)
-- ---------------------------------------------------------------------------

-- Organizations: add company-level fields
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS industry            TEXT NOT NULL DEFAULT 'cement',
  ADD COLUMN IF NOT EXISTS currency            CHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS reporting_standard  TEXT NOT NULL DEFAULT 'GHG Protocol'
    CHECK (reporting_standard IN ('GHG Protocol', 'ISO 14064-1', 'GCCA', 'EU CBAM', 'CDP', 'GRI')),
  ADD COLUMN IF NOT EXISTS fiscal_year_start   SMALLINT NOT NULL DEFAULT 1
    CHECK (fiscal_year_start BETWEEN 1 AND 12);

-- Facilities: add plant-level detail
ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS kiln_type           kiln_type,
  ADD COLUMN IF NOT EXISTS production_lines    SMALLINT,
  ADD COLUMN IF NOT EXISTS plant_type_detail   TEXT,
  ADD COLUMN IF NOT EXISTS clinker_capacity_t_yr DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS cement_capacity_t_yr  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS commissioning_year  SMALLINT;

-- ---------------------------------------------------------------------------
-- 1. REPORTING PERIODS
--    One row per (facility, year, quarter/annual).
--    Replaces scattered reporting_year integers across tables.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reporting_periods (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    facility_id     UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    period_label    TEXT NOT NULL,          -- e.g. '2026-Q1', '2026-Annual'
    period_type     TEXT NOT NULL DEFAULT 'annual'
                    CHECK (period_type IN ('annual', 'quarterly', 'monthly')),
    year            SMALLINT NOT NULL,
    quarter         SMALLINT CHECK (quarter BETWEEN 1 AND 4),
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    status          period_status NOT NULL DEFAULT 'open',
    locked_at       TIMESTAMPTZ,
    locked_by       UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (facility_id, period_label)
);

CREATE INDEX IF NOT EXISTS idx_periods_org_year     ON reporting_periods(org_id, year);
CREATE INDEX IF NOT EXISTS idx_periods_facility     ON reporting_periods(facility_id);

ALTER TABLE reporting_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY periods_tenant ON reporting_periods
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);
GRANT SELECT, INSERT, UPDATE ON reporting_periods TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 2. PLANT INPUTS  (structured, queryable snapshot of all inputs per period)
--    One row per (facility, reporting_period, version).
--    Replaces the opaque uploaded-file-only approach.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plant_inputs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    facility_id             UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    period_id               UUID NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
    version_no              SMALLINT NOT NULL DEFAULT 1,
    status                  run_status NOT NULL DEFAULT 'draft',

    -- A. Production inputs
    clinker_production_t    DOUBLE PRECISION,
    cement_production_t     DOUBLE PRECISION NOT NULL,
    raw_meal_t              DOUBLE PRECISION,
    clinker_ratio           DOUBLE PRECISION CHECK (clinker_ratio BETWEEN 0 AND 1),
    operating_days          SMALLINT CHECK (operating_days BETWEEN 1 AND 366),

    -- B. Calcination method
    calcination_method      TEXT NOT NULL DEFAULT 'B1'
                            CHECK (calcination_method IN ('B1', 'A1', 'B2')),
    calcination_ef_kg_per_t DOUBLE PRECISION DEFAULT 525.0,

    -- C. Data quality
    data_completeness_pct   DOUBLE PRECISION DEFAULT 0 CHECK (data_completeness_pct BETWEEN 0 AND 100),
    data_quality_score      data_quality_score NOT NULL DEFAULT 'Medium',

    -- D. Audit
    input_sha256_hash       TEXT NOT NULL,
    created_by              UUID NOT NULL REFERENCES users(id),
    approved_by             UUID REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at             TIMESTAMPTZ,
    notes                   TEXT,

    UNIQUE (facility_id, period_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_plant_inputs_org      ON plant_inputs(org_id);
CREATE INDEX IF NOT EXISTS idx_plant_inputs_facility ON plant_inputs(facility_id, period_id);

ALTER TABLE plant_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY plant_inputs_tenant ON plant_inputs
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);
GRANT SELECT, INSERT, UPDATE ON plant_inputs TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 3. FUEL ENTRIES  (normalised — one row per fuel per plant_input)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fuel_entries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plant_input_id      UUID NOT NULL REFERENCES plant_inputs(id) ON DELETE CASCADE,
    fuel_type           TEXT NOT NULL,
    is_kiln_fuel        BOOLEAN NOT NULL DEFAULT TRUE,
    consumption_t       DOUBLE PRECISION NOT NULL CHECK (consumption_t >= 0),
    lhv_gj_per_t        DOUBLE PRECISION NOT NULL CHECK (lhv_gj_per_t > 0),
    ef_kg_co2_per_gj    DOUBLE PRECISION,           -- NULL → use GCCA default
    ef_source           TEXT,                        -- e.g. 'GCCA Table 4', 'plant_lab'
    biogenic_fraction   DOUBLE PRECISION NOT NULL DEFAULT 0
                        CHECK (biogenic_fraction BETWEEN 0 AND 1),
    supplier_name       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fuel_entries_input ON fuel_entries(plant_input_id);

ALTER TABLE fuel_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY fuel_entries_tenant ON fuel_entries
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);
GRANT SELECT, INSERT, UPDATE ON fuel_entries TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 4. ELECTRICITY ENTRIES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS electricity_entries (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plant_input_id          UUID NOT NULL REFERENCES plant_inputs(id) ON DELETE CASCADE,
    purchased_mwh           DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (purchased_mwh >= 0),
    on_site_generated_mwh   DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (on_site_generated_mwh >= 0),
    renewable_mwh           DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (renewable_mwh >= 0),
    grid_ef_kg_co2_per_mwh  DOUBLE PRECISION NOT NULL CHECK (grid_ef_kg_co2_per_mwh > 0),
    grid_ef_source          TEXT DEFAULT 'national_grid',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_electricity_entries_input ON electricity_entries(plant_input_id);

ALTER TABLE electricity_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY electricity_entries_tenant ON electricity_entries
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);
GRANT SELECT, INSERT, UPDATE ON electricity_entries TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 5. LOGISTICS ENTRIES  (Scope 3 transport)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS logistics_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plant_input_id  UUID NOT NULL REFERENCES plant_inputs(id) ON DELETE CASCADE,
    description     TEXT NOT NULL,
    direction       TEXT NOT NULL DEFAULT 'outbound'
                    CHECK (direction IN ('inbound', 'outbound')),
    transport_mode  transport_mode NOT NULL DEFAULT 'road',
    freight_t_km    DOUBLE PRECISION NOT NULL CHECK (freight_t_km >= 0),
    ef_kg_co2_per_t_km DOUBLE PRECISION NOT NULL DEFAULT 0.062,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logistics_entries_input ON logistics_entries(plant_input_id);

ALTER TABLE logistics_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY logistics_entries_tenant ON logistics_entries
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);
GRANT SELECT, INSERT, UPDATE ON logistics_entries TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 6. WATER ENTRIES  (structured water inputs — mirrors water_inventory)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS water_entries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plant_input_id      UUID NOT NULL REFERENCES plant_inputs(id) ON DELETE CASCADE,
    withdrawal_m3       DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (withdrawal_m3 >= 0),
    discharge_m3        DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (discharge_m3 >= 0),
    recycled_m3         DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (recycled_m3 >= 0),
    harvested_rain_m3   DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (harvested_rain_m3 >= 0),
    water_source        TEXT,
    discharge_dest      TEXT,
    water_stress_index  DOUBLE PRECISION,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_water_entries_input ON water_entries(plant_input_id);

ALTER TABLE water_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY water_entries_tenant ON water_entries
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);
GRANT SELECT, INSERT, UPDATE ON water_entries TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 7. CALCULATION RUNS  (versioned run registry)
--    One row per calculation attempt. Links inputs → outputs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calculation_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    facility_id     UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    period_id       UUID NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
    plant_input_id  UUID NOT NULL REFERENCES plant_inputs(id),
    version_no      SMALLINT NOT NULL DEFAULT 1,
    status          run_status NOT NULL DEFAULT 'draft',
    engine_version  TEXT NOT NULL DEFAULT 'GCCA Carbon v3.1',
    run_sha256      TEXT NOT NULL,          -- SHA-256 of the full input payload
    created_by      UUID NOT NULL REFERENCES users(id),
    approved_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at     TIMESTAMPTZ,
    notes           TEXT,
    UNIQUE (facility_id, period_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_calc_runs_org      ON calculation_runs(org_id);
CREATE INDEX IF NOT EXISTS idx_calc_runs_facility ON calculation_runs(facility_id, period_id);
CREATE INDEX IF NOT EXISTS idx_calc_runs_status   ON calculation_runs(status);

ALTER TABLE calculation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY calc_runs_tenant ON calculation_runs
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);
GRANT SELECT, INSERT, UPDATE ON calculation_runs TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 8. CALCULATION RESULTS  (structured KPI outputs — queryable, not JSON blobs)
--    One row per calculation_run. All KPIs stored as typed columns.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calculation_results (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    run_id                      UUID NOT NULL UNIQUE REFERENCES calculation_runs(id) ON DELETE CASCADE,

    -- A. Emissions summary (tCO2e)
    scope1_total_t              DOUBLE PRECISION NOT NULL DEFAULT 0,
    scope2_total_t              DOUBLE PRECISION NOT NULL DEFAULT 0,
    scope3_total_t              DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_co2e_t                DOUBLE PRECISION NOT NULL DEFAULT 0,
    biomass_co2_memo_t          DOUBLE PRECISION NOT NULL DEFAULT 0,

    -- B. Scope 1 detail (tCO2e)
    calcination_co2_t           DOUBLE PRECISION NOT NULL DEFAULT 0,
    kiln_fuel_co2_t             DOUBLE PRECISION NOT NULL DEFAULT 0,
    non_kiln_fuel_co2_t         DOUBLE PRECISION NOT NULL DEFAULT 0,

    -- C. Scope 2 detail
    electricity_co2_t           DOUBLE PRECISION NOT NULL DEFAULT 0,

    -- D. Scope 3 detail
    transport_co2_t             DOUBLE PRECISION NOT NULL DEFAULT 0,

    -- E. Intensity KPIs
    kg_co2_per_t_cement         DOUBLE PRECISION,
    kg_co2_per_t_clinker        DOUBLE PRECISION,
    gj_per_t_clinker            DOUBLE PRECISION,
    m3_water_per_t_product      DOUBLE PRECISION,

    -- F. Water KPIs
    water_withdrawal_m3         DOUBLE PRECISION,
    water_consumption_m3        DOUBLE PRECISION,
    water_recycled_m3           DOUBLE PRECISION,
    water_intensity_l_per_t     DOUBLE PRECISION,

    -- G. Energy
    kiln_energy_tj              DOUBLE PRECISION,
    non_kiln_energy_tj          DOUBLE PRECISION,

    -- H. CBAM
    cbam_see_t_per_t            DOUBLE PRECISION,   -- Specific Embedded Emissions
    cbam_certificate_obligation DOUBLE PRECISION,
    cbam_net_payable_eur        DOUBLE PRECISION,

    -- I. Data quality
    data_quality_score          data_quality_score NOT NULL DEFAULT 'Medium',
    data_completeness_pct       DOUBLE PRECISION DEFAULT 0,
    validation_warnings_json    JSONB NOT NULL DEFAULT '[]',

    -- J. Source mix (for pie chart — stored as JSONB for dashboard speed)
    source_mix_json             JSONB NOT NULL DEFAULT '[]',

    -- K. Audit
    calculated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calc_results_org ON calculation_results(org_id);
CREATE INDEX IF NOT EXISTS idx_calc_results_run ON calculation_results(run_id);

ALTER TABLE calculation_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY calc_results_tenant ON calculation_results
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);
GRANT SELECT, INSERT ON calculation_results TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 9. BENCHMARKS  (portfolio + reference benchmarks per period)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS benchmarks (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    facility_id             UUID REFERENCES facilities(id),  -- NULL = org-level benchmark
    period_id               UUID REFERENCES reporting_periods(id),
    benchmark_type          TEXT NOT NULL
                            CHECK (benchmark_type IN (
                                'portfolio_avg', 'reference_factor',
                                'prior_year', 'industry_best', 'target'
                            )),
    metric                  TEXT NOT NULL,   -- e.g. 'kg_co2_per_t_cement'
    value                   DOUBLE PRECISION NOT NULL,
    unit                    TEXT NOT NULL,
    source                  TEXT,
    valid_from              DATE,
    valid_to                DATE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_benchmarks_org ON benchmarks(org_id);

ALTER TABLE benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY benchmarks_tenant ON benchmarks
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);
GRANT SELECT, INSERT, UPDATE ON benchmarks TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 10. SCENARIO RUNS  (AI / what-if analysis — future proofing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scenario_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    facility_id         UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    base_run_id         UUID REFERENCES calculation_runs(id),
    scenario_type       scenario_type NOT NULL DEFAULT 'what_if',
    name                TEXT NOT NULL,
    description         TEXT,
    assumptions_json    JSONB NOT NULL DEFAULT '{}',
    result_delta_json   JSONB,              -- diff vs base_run
    ai_model_version    TEXT,
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scenarios_org ON scenario_runs(org_id);

ALTER TABLE scenario_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY scenarios_tenant ON scenario_runs
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);
GRANT SELECT, INSERT ON scenario_runs TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 11. REDUCTION PROJECTS  (decarbonisation project tracking)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reduction_projects (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    facility_id         UUID REFERENCES facilities(id),
    name                TEXT NOT NULL,
    description         TEXT,
    status              project_status NOT NULL DEFAULT 'proposed',
    target_metric       TEXT NOT NULL,      -- e.g. 'kg_co2_per_t_cement'
    baseline_value      DOUBLE PRECISION,
    target_value        DOUBLE PRECISION,
    target_year         SMALLINT,
    estimated_reduction_t_co2e DOUBLE PRECISION,
    capex_estimate_usd  DOUBLE PRECISION,
    linked_scenario_id  UUID REFERENCES scenario_runs(id),
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_org ON reduction_projects(org_id);

ALTER TABLE reduction_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_tenant ON reduction_projects
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);
GRANT SELECT, INSERT, UPDATE ON reduction_projects TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 12. IOT DATA STREAMS  (IoT integration metadata — future proofing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS iot_data_streams (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    facility_id     UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    stream_name     TEXT NOT NULL,
    sensor_type     TEXT NOT NULL,          -- e.g. 'energy_meter', 'flow_meter'
    unit            TEXT NOT NULL,
    endpoint_url    TEXT,
    api_key_ref     TEXT,                   -- reference to secrets manager key
    polling_interval_sec INTEGER DEFAULT 300,
    last_synced_at  TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE iot_data_streams ENABLE ROW LEVEL SECURITY;
CREATE POLICY iot_streams_tenant ON iot_data_streams
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);
GRANT SELECT, INSERT, UPDATE ON iot_data_streams TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 13. ERP IMPORTS  (ERP sync audit trail — future proofing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS erp_imports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    facility_id     UUID REFERENCES facilities(id),
    erp_system      TEXT NOT NULL,          -- e.g. 'SAP', 'Oracle', 'Dynamics'
    import_type     TEXT NOT NULL,          -- e.g. 'fuel_consumption', 'production'
    source_ref      TEXT,                   -- ERP document/batch reference
    records_imported INTEGER NOT NULL DEFAULT 0,
    records_failed   INTEGER NOT NULL DEFAULT 0,
    import_sha256   TEXT,
    imported_by     UUID NOT NULL REFERENCES users(id),
    imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error_log_json  JSONB DEFAULT '[]'
);

ALTER TABLE erp_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY erp_imports_tenant ON erp_imports
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);
GRANT SELECT, INSERT ON erp_imports TO tefnut_app;

-- ---------------------------------------------------------------------------
-- DASHBOARD MATERIALISED VIEW  (denormalised for speed — refreshed nightly)
-- Joins calculation_results + plant_inputs + benchmarks for the main dashboard.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dashboard_kpis AS
SELECT
    cr.org_id,
    cr.facility_id,
    rp.year,
    rp.period_label,
    rp.period_type,
    run.version_no,
    run.status                          AS run_status,
    res.scope1_total_t,
    res.scope2_total_t,
    res.scope3_total_t,
    res.total_co2e_t,
    res.kg_co2_per_t_cement,
    res.kg_co2_per_t_clinker,
    res.gj_per_t_clinker,
    res.m3_water_per_t_product,
    res.water_consumption_m3,
    res.cbam_see_t_per_t,
    res.cbam_net_payable_eur,
    res.data_quality_score,
    res.data_completeness_pct,
    res.source_mix_json,
    res.calculated_at,
    -- Prior year delta (self-join)
    prev.kg_co2_per_t_cement            AS prev_year_kg_co2_per_t_cement,
    CASE
        WHEN prev.kg_co2_per_t_cement > 0
        THEN ROUND(((res.kg_co2_per_t_cement - prev.kg_co2_per_t_cement)
                    / prev.kg_co2_per_t_cement * 100)::NUMERIC, 2)
        ELSE NULL
    END                                 AS yoy_change_pct
FROM calculation_runs run
JOIN calculation_results res   ON res.run_id = run.id
JOIN reporting_periods rp      ON rp.id = run.period_id
JOIN facilities cr              ON cr.id = run.facility_id
-- Prior year result (latest approved run)
LEFT JOIN LATERAL (
    SELECT r2.kg_co2_per_t_cement
    FROM calculation_runs run2
    JOIN calculation_results r2 ON r2.run_id = run2.id
    JOIN reporting_periods rp2  ON rp2.id = run2.period_id
    WHERE run2.facility_id = run.facility_id
      AND rp2.year = rp.year - 1
      AND run2.status = 'approved'
    ORDER BY run2.version_no DESC
    LIMIT 1
) prev ON TRUE
WHERE run.status IN ('approved', 'submitted');

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_dashboard_kpis
    ON mv_dashboard_kpis(org_id, facility_id, year, period_label, version_no);

-- Refresh function (call from a scheduled job)
CREATE OR REPLACE FUNCTION refresh_dashboard_kpis()
RETURNS VOID LANGUAGE SQL AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_kpis;
$$;
