
-- =============================================================================
-- Tefnut Emission Factors — Migration 0005
-- Target: Amazon RDS PostgreSQL 16+
--
-- Replaces the simple emission_factor_library (migration 0002) with a
-- full multi-category, multi-source, priority-ranked emission_factors table.
-- The old table is kept for backward compatibility — new code uses this one.
--
-- Selection priority (lower number = higher priority):
--   1  plant-specific factor    (org_id + facility_id set)
--   2  geography-specific       (org_id set, geography set)
--   3  latest active source     (org_id set, no geography)
--   4  internal default         (org_id IS NULL — global)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ENUM: source_type
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE ef_source_type AS ENUM (
    'gcca_default',
    'ipcc_efdb',
    'national_inventory',
    'peer_reviewed',
    'plant_specific',
    'operator_supplied',
    'regulatory',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 1. EMISSION FACTORS  (the master table)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emission_factors (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Scoping (NULL org_id = global default visible to all tenants)
    org_id              UUID REFERENCES organizations(id) ON DELETE CASCADE,
    facility_id         UUID REFERENCES facilities(id) ON DELETE CASCADE,

    -- Classification
    factor_code         TEXT NOT NULL,          -- machine-readable key, e.g. 'GCCA_COAL_ANTHRACITE'
    category            TEXT NOT NULL,          -- 'fuel' | 'electricity' | 'cement_process' | 'transport' | 'water'
    subcategory         TEXT NOT NULL,          -- e.g. 'diesel', 'clinker', 'grid_egypt'
    fuel_type           TEXT,                   -- matches FuelType enum when category='fuel'
    process_type        TEXT,                   -- e.g. 'dry_kiln_ph_pc', 'calcination'
    geography           TEXT,                   -- ISO country code or region, e.g. 'EG', 'Global'

    -- Source provenance
    source_name         TEXT NOT NULL,          -- e.g. 'GCCA Table 4 v3.1', 'IPCC EFDB EB20'
    source_type         ef_source_type NOT NULL DEFAULT 'gcca_default',
    source_file         TEXT,                   -- original filename if imported
    source_sheet        TEXT,                   -- Excel sheet name if applicable
    reporting_year      SMALLINT,               -- year the factor was published/measured
    applicable_from     DATE,                   -- factor valid from this date
    applicable_to       DATE,                   -- factor valid until this date (NULL = still active)

    -- The factor value
    unit                TEXT NOT NULL,          -- e.g. 'kgCO2/GJ', 'kgCO2/MWh', 'tCO2/t clinker'
    value               DOUBLE PRECISION NOT NULL CHECK (value >= 0),
    value_min           DOUBLE PRECISION,       -- lower bound of range (if published as range)
    value_max           DOUBLE PRECISION,       -- upper bound of range
    confidence_score    DOUBLE PRECISION        -- 0.0–1.0; NULL = unknown
                        CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),

    -- Selection priority (lower = higher priority)
    priority_rank       SMALLINT NOT NULL DEFAULT 4
                        CHECK (priority_rank BETWEEN 1 AND 4),
    -- 1 = plant-specific, 2 = geography-specific, 3 = latest active source, 4 = internal default

    -- Lifecycle
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    notes               TEXT,

    -- Audit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Uniqueness: one active factor per (org, facility, code, geography, year)
    CONSTRAINT uq_ef_scope UNIQUE NULLS NOT DISTINCT
        (org_id, facility_id, factor_code, geography, reporting_year)
);

-- Indexes for fast selection queries
CREATE INDEX IF NOT EXISTS idx_ef_category        ON emission_factors(category, subcategory);
CREATE INDEX IF NOT EXISTS idx_ef_factor_code     ON emission_factors(factor_code);
CREATE INDEX IF NOT EXISTS idx_ef_org_active      ON emission_factors(org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ef_geography       ON emission_factors(geography);
CREATE INDEX IF NOT EXISTS idx_ef_priority        ON emission_factors(priority_rank, is_active);
CREATE INDEX IF NOT EXISTS idx_ef_applicable      ON emission_factors(applicable_from, applicable_to);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION fn_ef_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_ef_updated_at ON emission_factors;
CREATE TRIGGER trg_ef_updated_at
  BEFORE UPDATE ON emission_factors
  FOR EACH ROW EXECUTE FUNCTION fn_ef_updated_at();

-- RLS: global factors (org_id IS NULL) readable by all; private factors scoped to org
ALTER TABLE emission_factors ENABLE ROW LEVEL SECURITY;

CREATE POLICY ef_read ON emission_factors
  FOR SELECT
  USING (
    org_id IS NULL
    OR org_id = current_setting('app.current_org_id', TRUE)::UUID
  );

CREATE POLICY ef_insert ON emission_factors
  FOR INSERT
  WITH CHECK (
    org_id IS NULL   -- system/admin inserts global factors
    OR org_id = current_setting('app.current_org_id', TRUE)::UUID
  );

CREATE POLICY ef_update ON emission_factors
  FOR UPDATE
  USING (
    org_id IS NULL
    OR org_id = current_setting('app.current_org_id', TRUE)::UUID
  )
  WITH CHECK (
    org_id IS NULL
    OR org_id = current_setting('app.current_org_id', TRUE)::UUID
  );

GRANT SELECT, INSERT, UPDATE ON emission_factors TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 2. CALCULATION FACTOR USAGE  (traceability — which factor was used per run)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calculation_factor_usage (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    calculation_run_id  UUID NOT NULL REFERENCES calculation_runs(id) ON DELETE CASCADE,
    factor_id           UUID REFERENCES emission_factors(id),   -- NULL if factor was plant-supplied inline
    metric_name         TEXT NOT NULL,          -- e.g. 'calcination_ef', 'coal_anthracite_ef', 'grid_ef'
    selected_value      DOUBLE PRECISION NOT NULL,
    selected_unit       TEXT NOT NULL,
    source_name         TEXT NOT NULL,          -- denormalised for fast audit reads
    priority_rank_used  SMALLINT NOT NULL,
    reason_selected     TEXT NOT NULL,          -- human-readable explanation
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cfu_run    ON calculation_factor_usage(calculation_run_id);
CREATE INDEX IF NOT EXISTS idx_cfu_factor ON calculation_factor_usage(factor_id);
CREATE INDEX IF NOT EXISTS idx_cfu_org    ON calculation_factor_usage(org_id);

ALTER TABLE calculation_factor_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY cfu_tenant ON calculation_factor_usage
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);

GRANT SELECT, INSERT ON calculation_factor_usage TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 3. SEED — Global GCCA defaults (priority_rank = 4, org_id = NULL)
-- ---------------------------------------------------------------------------
INSERT INTO emission_factors
    (factor_code, category, subcategory, fuel_type, geography,
     source_name, source_type, reporting_year,
     unit, value, priority_rank, is_active, notes)
VALUES
    -- Fuel factors (kgCO2/GJ, LHV basis — GCCA Table 4 v3.1)
    ('GCCA_COAL_ANTHRACITE',      'fuel', 'coal_anthracite',      'coal_anthracite',      'Global', 'GCCA Table 4 v3.1', 'gcca_default', 2021, 'kgCO2/GJ', 96.0,  4, TRUE, 'GCCA Cement CO2 Protocol v3.1 Table 4'),
    ('GCCA_PETROL_COKE',          'fuel', 'petrol_coke',          'petrol_coke',          'Global', 'GCCA Table 4 v3.1', 'gcca_default', 2021, 'kgCO2/GJ', 92.8,  4, TRUE, NULL),
    ('GCCA_HEAVY_FUEL_OIL',       'fuel', 'heavy_fuel_oil',       'heavy_fuel_oil',       'Global', 'GCCA Table 4 v3.1', 'gcca_default', 2021, 'kgCO2/GJ', 77.4,  4, TRUE, NULL),
    ('GCCA_DIESEL_OIL',           'fuel', 'diesel_oil',           'diesel_oil',           'Global', 'GCCA Table 4 v3.1', 'gcca_default', 2021, 'kgCO2/GJ', 74.1,  4, TRUE, NULL),
    ('GCCA_NATURAL_GAS',          'fuel', 'natural_gas',          'natural_gas',          'Global', 'GCCA Table 4 v3.1', 'gcca_default', 2021, 'kgCO2/GJ', 56.1,  4, TRUE, NULL),
    ('GCCA_OIL_SHALE',            'fuel', 'oil_shale',            'oil_shale',            'Global', 'GCCA Table 4 v3.1', 'gcca_default', 2021, 'kgCO2/GJ', 107.0, 4, TRUE, NULL),
    ('GCCA_LIGNITE',              'fuel', 'lignite',              'lignite',              'Global', 'GCCA Table 4 v3.1', 'gcca_default', 2021, 'kgCO2/GJ', 101.0, 4, TRUE, NULL),
    ('GCCA_GASOLINE',             'fuel', 'gasoline',             'gasoline',             'Global', 'GCCA Table 4 v3.1', 'gcca_default', 2021, 'kgCO2/GJ', 69.3,  4, TRUE, NULL),
    ('GCCA_WASTE_OIL',            'fuel', 'waste_oil',            'waste_oil',            'Global', 'GCCA Table 4 v3.1', 'gcca_default', 2021, 'kgCO2/GJ', 74.0,  4, TRUE, NULL),
    ('GCCA_TYRES',                'fuel', 'tyres',                'tyres',                'Global', 'GCCA Table 4 v3.1', 'gcca_default', 2021, 'kgCO2/GJ', 85.0,  4, TRUE, NULL),
    ('GCCA_RDF_PLASTICS',         'fuel', 'rdf_plastics',         'rdf_plastics',         'Global', 'GCCA Table 4 v3.1', 'gcca_default', 2021, 'kgCO2/GJ', 75.0,  4, TRUE, NULL),
    ('GCCA_MIXED_INDUSTRIAL',     'fuel', 'mixed_industrial_waste','mixed_industrial_waste','Global','GCCA Table 4 v3.1', 'gcca_default', 2021, 'kgCO2/GJ', 83.0,  4, TRUE, NULL),
    ('GCCA_OTHER_FOSSIL_WASTE',   'fuel', 'other_fossil_waste',   'other_fossil_waste',   'Global', 'GCCA Table 4 v3.1', 'gcca_default', 2021, 'kgCO2/GJ', 80.0,  4, TRUE, NULL),
    ('GCCA_DRIED_SEWAGE_SLUDGE',  'fuel', 'dried_sewage_sludge',  'dried_sewage_sludge',  'Global', 'GCCA Table 4 v3.1', 'gcca_default', 2021, 'kgCO2/GJ', 110.0, 4, TRUE, 'Biomass — memo item only'),
    ('GCCA_WOOD_SAW_DUST',        'fuel', 'wood_saw_dust',        'wood_saw_dust',        'Global', 'GCCA Table 4 v3.1', 'gcca_default', 2021, 'kgCO2/GJ', 110.0, 4, TRUE, 'Biomass — memo item only'),
    ('GCCA_OTHER_BIOMASS',        'fuel', 'other_biomass',        'other_biomass',        'Global', 'GCCA Table 4 v3.1', 'gcca_default', 2021, 'kgCO2/GJ', 110.0, 4, TRUE, 'Biomass — memo item only'),

    -- Cement process factor (tCO2/t clinker — GCCA Method B1)
    ('GCCA_CALCINATION_DEFAULT',  'cement_process', 'clinker', NULL, 'Global',
     'GCCA Method B1', 'gcca_default', 2021, 'tCO2/t clinker', 0.525, 4, TRUE,
     'GCCA default calcination EF — 525 kg CO2/t clinker'),

    -- Electricity factors (kgCO2/MWh — geography-specific, priority 2)
    ('ELEC_EG_2023',  'electricity', 'grid_egypt',  NULL, 'EG',
     'Egyptian Electricity Holding Company 2023', 'national_inventory', 2023,
     'kgCO2/MWh', 461.0, 2, TRUE, 'Egypt national grid EF 2023'),
    ('ELEC_GLOBAL',   'electricity', 'grid_global', NULL, 'Global',
     'IEA World Energy Outlook 2023', 'peer_reviewed', 2023,
     'kgCO2/MWh', 436.0, 4, TRUE, 'Global average grid EF 2023'),

    -- Transport factor (kgCO2/t·km — GCCA default)
    ('GCCA_ROAD_TRANSPORT', 'transport', 'road', NULL, 'Global',
     'GCCA Logistics Guidelines', 'gcca_default', 2021,
     'kgCO2/t·km', 0.062, 4, TRUE, 'Default road freight EF'),

    -- IPCC library factors (priority 3 — latest active source)
    ('IPCC_CEMENT_AU_2020',  'cement_process', 'clinker', NULL, 'AU',
     'Australian NIR 2019', 'national_inventory', 2020,
     'tCO2/t clinker', 0.5475, 3, TRUE, 'Range: 0.535–0.560'),
    ('IPCC_CEMENT_UK_2021',  'cement_process', 'clinker', NULL, 'GB',
     'UK GHG Inventory 2020', 'national_inventory', 2021,
     'tCO2/t clinker', 0.5815, 3, TRUE, 'Range: 0.563–0.600'),
    ('IPCC_CEMENT_CA_2021',  'cement_process', 'clinker', NULL, 'CA',
     'Canada NIR 2021', 'national_inventory', 2021,
     'tCO2/t clinker', 0.527,  3, TRUE, 'Range: 0.521–0.533'),
    ('IPCC_CEMENT_CN_NSP_2022', 'cement_process', 'clinker', NULL, 'CN',
     'Yang et al. J.Geogr.Sci 2017', 'peer_reviewed', 2022,
     'tCO2/t clinker', 0.52,   3, TRUE, 'NSP kiln — range: 0.478–0.556'),
    ('IPCC_CEMENT_CN_VSK_2022', 'cement_process', 'clinker', NULL, 'CN',
     'Yang et al. J.Geogr.Sci 2017', 'peer_reviewed', 2022,
     'tCO2/t clinker', 0.501,  3, TRUE, 'VSK kiln — range: 0.392–0.529'),
    ('IPCC_CEMENT_BR_2023',  'cement_process', 'clinker', NULL, 'BR',
     'Costa et al. J.Cleaner Prod 2020', 'peer_reviewed', 2023,
     'tCO2/t clinker', 0.500,  3, TRUE, 'Reference cement, no CCW substitution')
ON CONFLICT ON CONSTRAINT uq_ef_scope DO NOTHING;
