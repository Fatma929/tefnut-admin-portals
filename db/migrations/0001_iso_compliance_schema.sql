-- =============================================================================
-- Tefnut ISO Compliance Schema — Migration 0001
-- Target: Cloudflare D1 (SQLite-compatible)
--
-- Standards covered:
--   ISO 14064-1:2018  — GHG Inventory (Carbon Footprint)
--   ISO 14046:2014    — Water Footprint
--   EU CBAM 2023/956  — Carbon Border Adjustment Mechanism
--
-- Design principles:
--   • Every calculation record carries an immutable SHA-256 audit hash
--   • ISO category / flow_type columns enforce standard classification
--   • Uploaded files are linked as audit evidence to specific records
--   • All timestamps are UTC ISO-8601 strings (D1 has no TIMESTAMP type)
-- =============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 1. RIVER BASINS  (lookup table — ISO 14046 §4.1 geographic scope)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS river_basins (
    id          TEXT PRIMARY KEY,          -- e.g. 'nile-lower-egypt'
    name        TEXT NOT NULL,             -- 'Nile Basin — Lower Egypt'
    hydrosheds_level INTEGER,              -- HydroSHEDS level (4–12)
    country     TEXT NOT NULL,
    wri_aqueduct_stress TEXT               -- 'Extremely High' | 'High' | 'Medium-High' | 'Low-Medium' | 'Low'
);

INSERT OR IGNORE INTO river_basins VALUES
    ('nile-lower-egypt',  'Nile Basin — Lower Egypt',  6, 'Egypt', 'High'),
    ('nile-upper-egypt',  'Nile Basin — Upper Egypt',  6, 'Egypt', 'Extremely High'),
    ('mediterranean-eg',  'Mediterranean Coast — Egypt', 5, 'Egypt', 'High');

-- ---------------------------------------------------------------------------
-- 2. ORGANIZATIONS  (ISO 14064-1 §5.1 + ISO 14046 §4.1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    legal_name              TEXT NOT NULL,
    eori_number             TEXT,                          -- EU CBAM identifier
    country                 TEXT NOT NULL DEFAULT 'Egypt',
    reporting_boundary_type TEXT NOT NULL DEFAULT 'operational'
                            CHECK (reporting_boundary_type IN ('operational', 'financial', 'equity_share')),
    base_year               INTEGER NOT NULL,              -- ISO 14064-1 §5.4 base year
    river_basin_id          TEXT REFERENCES river_basins(id),
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 3. FACILITIES  (individual plant / site)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facilities (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    facility_type   TEXT NOT NULL DEFAULT 'cement_plant'
                    CHECK (facility_type IN ('cement_plant', 'grinding_mill', 'quarry', 'logistics_hub', 'other')),
    country         TEXT NOT NULL DEFAULT 'Egypt',
    latitude        REAL,
    longitude       REAL,
    capacity_t_yr   REAL,                                  -- annual production capacity (tonnes)
    river_basin_id  TEXT REFERENCES river_basins(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 4. USERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email       TEXT NOT NULL UNIQUE,
    full_name   TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'analyst'
                CHECK (role IN ('admin', 'sustainability_lead', 'analyst', 'auditor', 'viewer')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 5. UPLOADED FILES  (audit evidence store)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uploaded_files (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    facility_id     TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    uploaded_by     TEXT NOT NULL REFERENCES users(id),
    original_name   TEXT NOT NULL,
    storage_key     TEXT NOT NULL UNIQUE,                  -- R2 object key
    mime_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    sha256_hash     TEXT NOT NULL,                         -- file-level integrity hash
    upload_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    reporting_year  INTEGER NOT NULL,
    engine_type     TEXT NOT NULL CHECK (engine_type IN ('carbon', 'water'))
);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_facility ON uploaded_files(facility_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_hash     ON uploaded_files(sha256_hash);

-- ---------------------------------------------------------------------------
-- 6. CARBON EMISSIONS INVENTORY  (ISO 14064-1 §5.3 — Six Categories)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carbon_inventory (
    id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    facility_id         TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    uploaded_file_id    TEXT REFERENCES uploaded_files(id),   -- audit evidence link
    reporting_year      INTEGER NOT NULL,
    reporting_period_start TEXT NOT NULL,                     -- ISO-8601 date
    reporting_period_end   TEXT NOT NULL,

    -- ISO 14064-1 §5.3 — emission category (1–6)
    iso_category        INTEGER NOT NULL CHECK (iso_category BETWEEN 1 AND 6),
    iso_category_label  TEXT NOT NULL,                        -- human-readable label

    -- Emission source
    source_name         TEXT NOT NULL,                        -- e.g. 'Calcination', 'Grid electricity'
    source_type         TEXT NOT NULL
                        CHECK (source_type IN (
                            'calcination', 'fuel_combustion_kiln', 'fuel_combustion_non_kiln',
                            'purchased_electricity', 'purchased_heat', 'transport_inbound',
                            'transport_outbound', 'raw_materials', 'waste_disposal',
                            'employee_commuting', 'other'
                        )),

    -- Quantification
    co2e_t              REAL NOT NULL CHECK (co2e_t >= 0),    -- tCO₂e
    co2_t               REAL DEFAULT 0,
    ch4_t               REAL DEFAULT 0,
    n2o_t               REAL DEFAULT 0,
    biomass_co2_memo_t  REAL DEFAULT 0,                       -- memo item, not counted in total

    -- Emission factor
    emission_factor_value REAL,
    emission_factor_unit  TEXT,                               -- e.g. 'kg CO₂/GJ'
    emission_factor_source TEXT,                              -- e.g. 'GCCA Table 4'

    -- GWP reference (ISO 14064-1:2018 §6.3.3)
    gwp_reference       TEXT NOT NULL DEFAULT 'IPCC AR6'
                        CHECK (gwp_reference IN ('IPCC AR4', 'IPCC AR5', 'IPCC AR6')),
    gwp_co2             REAL NOT NULL DEFAULT 1.0,
    gwp_ch4             REAL NOT NULL DEFAULT 27.9,           -- AR6 GWP100
    gwp_n2o             REAL NOT NULL DEFAULT 273.0,          -- AR6 GWP100

    -- Data quality (ISO 14064-1 §7)
    data_quality_score  TEXT NOT NULL DEFAULT 'Medium'
                        CHECK (data_quality_score IN ('High', 'Medium', 'Low')),
    data_quality_notes  TEXT,

    -- Audit integrity
    input_sha256_hash   TEXT NOT NULL,                        -- SHA-256 of the input payload
    calculated_by       TEXT NOT NULL REFERENCES users(id),
    calculated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    methodology_tag     TEXT NOT NULL DEFAULT 'GCCA Carbon v3.1'
);

CREATE INDEX IF NOT EXISTS idx_carbon_facility_year ON carbon_inventory(facility_id, reporting_year);
CREATE INDEX IF NOT EXISTS idx_carbon_iso_category  ON carbon_inventory(iso_category);
CREATE INDEX IF NOT EXISTS idx_carbon_hash          ON carbon_inventory(input_sha256_hash);

-- ---------------------------------------------------------------------------
-- 7. WATER INVENTORY  (ISO 14046:2014 §6.4 — Flow Types)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS water_inventory (
    id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    facility_id         TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    uploaded_file_id    TEXT REFERENCES uploaded_files(id),   -- audit evidence link
    reporting_year      INTEGER NOT NULL,
    reporting_period_start TEXT NOT NULL,
    reporting_period_end   TEXT NOT NULL,

    -- ISO 14046 §6.4 — flow type classification
    flow_type           TEXT NOT NULL
                        CHECK (flow_type IN ('withdrawal', 'consumption', 'discharge', 'recycled', 'special')),
    flow_subtype        TEXT,                                  -- e.g. 'surface_water', 'groundwater'

    -- Source / destination
    source_name         TEXT NOT NULL,
    water_source        TEXT
                        CHECK (water_source IN (
                            'surface_water', 'groundwater', 'quarry_water_used',
                            'municipal_potable_water', 'external_wastewater',
                            'harvested_rainwater', 'recycled_internal', 'storm_water', NULL
                        )),
    discharge_destination TEXT
                        CHECK (discharge_destination IN (
                            'ocean', 'surface_water', 'subsurface_well',
                            'offsite_water_treatment', 'beneficial_other_users', NULL
                        )),

    -- Volumes
    volume_m3           REAL NOT NULL CHECK (volume_m3 >= 0),

    -- KPIs (populated on consumption records)
    kpi_1_consumption_m3        REAL,                         -- Net consumption
    kpi_2_intensity_l_per_t     REAL,                         -- L / t cementitious
    freshwater_consumption_m3   REAL,                         -- excl. harvested rainwater

    -- Water stress context (ISO 14046 §6.4.2 characterisation)
    water_stress_index  REAL,                                  -- WRI Aqueduct score 0–5
    characterisation_factor REAL DEFAULT 1.0,                 -- m³ world-eq / m³
    characterisation_method TEXT DEFAULT 'WBCSD Global Water Tool',

    -- Quality parameters (JSON — TDS, pH, temperature, BOD, COD, etc.)
    quality_parameters  TEXT,                                  -- JSON blob

    -- Data quality
    data_quality_score  TEXT NOT NULL DEFAULT 'Medium'
                        CHECK (data_quality_score IN ('High', 'Medium', 'Low')),
    data_quality_notes  TEXT,

    -- Audit integrity
    input_sha256_hash   TEXT NOT NULL,
    calculated_by       TEXT NOT NULL REFERENCES users(id),
    calculated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    methodology_tag     TEXT NOT NULL DEFAULT 'GCCA Water Guidelines 2021'
);

CREATE INDEX IF NOT EXISTS idx_water_facility_year ON water_inventory(facility_id, reporting_year);
CREATE INDEX IF NOT EXISTS idx_water_flow_type     ON water_inventory(flow_type);
CREATE INDEX IF NOT EXISTS idx_water_hash          ON water_inventory(input_sha256_hash);

-- ---------------------------------------------------------------------------
-- 8. GENERATED REPORTS  (immutable audit trail — ISO 14064-1 §9 + ISO 14046 §8)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generated_reports (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    facility_id     TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    generated_by    TEXT NOT NULL REFERENCES users(id),
    report_type     TEXT NOT NULL
                    CHECK (report_type IN (
                        'iso_14064_ghg_inventory',
                        'iso_14046_water_footprint',
                        'cbam_quarterly',
                        'cbam_annual',
                        'esg_disclosure',
                        'combined_sustainability'
                    )),
    reporting_year  INTEGER NOT NULL,
    reporting_period_start TEXT NOT NULL,
    reporting_period_end   TEXT NOT NULL,
    title           TEXT NOT NULL,

    -- Immutable integrity fields
    sha256_hash     TEXT NOT NULL UNIQUE,                     -- hash of the full report JSON
    report_json     TEXT NOT NULL,                            -- full ISO-structured report payload
    storage_key     TEXT,                                     -- R2 key for PDF/XLSX export

    -- Standards cited in this report
    standards_cited TEXT NOT NULL DEFAULT '[]',               -- JSON array of standard IDs

    -- Status lifecycle
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'under_review', 'approved', 'submitted', 'archived')),
    submitted_at    TEXT,
    submission_ref  TEXT,                                     -- EU CBAM portal reference number

    generated_at    TEXT NOT NULL DEFAULT (datetime('now')),

    -- Linked inventory records (JSON arrays of IDs)
    carbon_record_ids TEXT NOT NULL DEFAULT '[]',
    water_record_ids  TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_reports_facility_year ON generated_reports(facility_id, reporting_year);
CREATE INDEX IF NOT EXISTS idx_reports_hash          ON generated_reports(sha256_hash);
CREATE INDEX IF NOT EXISTS idx_reports_status        ON generated_reports(status);

-- ---------------------------------------------------------------------------
-- 9. REPORT ↔ FILE EVIDENCE  (many-to-many: reports cite uploaded files)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_evidence (
    report_id       TEXT NOT NULL REFERENCES generated_reports(id) ON DELETE CASCADE,
    file_id         TEXT NOT NULL REFERENCES uploaded_files(id) ON DELETE CASCADE,
    evidence_role   TEXT NOT NULL DEFAULT 'supporting_data'
                    CHECK (evidence_role IN (
                        'primary_input',       -- the file that was calculated
                        'supporting_data',     -- additional evidence
                        'third_party_audit',   -- external verifier document
                        'emission_factor_ref'  -- EF source document
                    )),
    linked_at       TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (report_id, file_id)
);

-- ---------------------------------------------------------------------------
-- 10. DUPLICATE DETECTION REGISTRY  (mirrors Python DuplicateRegistry)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS input_hash_registry (
    input_sha256_hash   TEXT PRIMARY KEY,
    engine_type         TEXT NOT NULL CHECK (engine_type IN ('carbon', 'water')),
    facility_id         TEXT NOT NULL REFERENCES facilities(id),
    first_seen_at       TEXT NOT NULL DEFAULT (datetime('now')),
    first_seen_by       TEXT NOT NULL REFERENCES users(id),
    record_id           TEXT NOT NULL                         -- ID in carbon_inventory or water_inventory
);

-- ---------------------------------------------------------------------------
-- 11. VALIDATION LOG  (persists engine validation results per upload)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS validation_log (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    uploaded_file_id TEXT NOT NULL REFERENCES uploaded_files(id) ON DELETE CASCADE,
    engine_type     TEXT NOT NULL CHECK (engine_type IN ('carbon', 'water')),
    is_blocked      INTEGER NOT NULL DEFAULT 0,               -- 0 = false, 1 = true
    errors_json     TEXT NOT NULL DEFAULT '[]',               -- JSON array of ErrorDetail
    warnings_json   TEXT NOT NULL DEFAULT '[]',               -- JSON array of WarningDetail
    overall_quality TEXT NOT NULL DEFAULT 'Medium'
                    CHECK (overall_quality IN ('High', 'Medium', 'Low')),
    validated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
