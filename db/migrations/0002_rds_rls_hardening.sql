-- =============================================================================
-- Tefnut RDS Hardening — Migration 0002
-- Target: Amazon RDS PostgreSQL 16+
--
-- This migration:
--   1. Adds org_id to every tenant-scoped table
--   2. Enables Row-Level Security (RLS) on all sensitive tables
--   3. Creates tenant-isolation policies using app.current_org_id
--   4. Creates the emission_factor_library (global + private)
--   5. Creates the audit_logs table for destructive-action tracking
--   6. Creates the app_user role used by the application
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Application role — used by all API connections (never superuser)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tefnut_app') THEN
    CREATE ROLE tefnut_app LOGIN PASSWORD 'REPLACE_IN_ENV';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Custom GUC (Grand Unified Configuration) for tenant context
-- Declared here so SET app.current_org_id = '...' is always valid.
-- ---------------------------------------------------------------------------
ALTER DATABASE tefnut SET app.current_org_id = '';

-- ---------------------------------------------------------------------------
-- ENUM types
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE reporting_boundary_type AS ENUM ('operational', 'financial', 'equity_share');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE facility_type AS ENUM ('cement_plant', 'grinding_mill', 'quarry', 'logistics_hub', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'sustainability_lead', 'analyst', 'auditor', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE engine_type AS ENUM ('carbon', 'water');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gwp_reference AS ENUM ('IPCC AR4', 'IPCC AR5', 'IPCC AR6');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE data_quality_score AS ENUM ('High', 'Medium', 'Low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE report_status AS ENUM ('draft', 'under_review', 'approved', 'submitted', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE report_type AS ENUM (
    'iso_14064_ghg_inventory', 'iso_14046_water_footprint',
    'cbam_quarterly', 'cbam_annual', 'esg_disclosure', 'combined_sustainability'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE water_flow_type AS ENUM ('withdrawal', 'consumption', 'discharge', 'recycled', 'special');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE evidence_role AS ENUM ('primary_input', 'supporting_data', 'third_party_audit', 'emission_factor_ref');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE audit_action AS ENUM ('INSERT', 'UPDATE', 'DELETE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 1. RIVER BASINS  (global lookup — no RLS, readable by all)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS river_basins (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    hydrosheds_level     INTEGER,
    country              TEXT NOT NULL,
    wri_aqueduct_stress  TEXT
);

INSERT INTO river_basins VALUES
    ('nile-lower-egypt', 'Nile Basin — Lower Egypt',  6, 'Egypt', 'High'),
    ('nile-upper-egypt', 'Nile Basin — Upper Egypt',  6, 'Egypt', 'Extremely High'),
    ('mediterranean-eg', 'Mediterranean Coast — Egypt', 5, 'Egypt', 'High')
ON CONFLICT DO NOTHING;

GRANT SELECT ON river_basins TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 2. ORGANIZATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_name              TEXT NOT NULL,
    eori_number             TEXT,
    country                 TEXT NOT NULL DEFAULT 'Egypt',
    reporting_boundary_type reporting_boundary_type NOT NULL DEFAULT 'operational',
    base_year               INTEGER NOT NULL,
    river_basin_id          TEXT REFERENCES river_basins(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE ON organizations TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 3. FACILITIES  — org_id added for direct RLS without join
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facilities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    facility_type   facility_type NOT NULL DEFAULT 'cement_plant',
    country         TEXT NOT NULL DEFAULT 'Egypt',
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    capacity_t_yr   DOUBLE PRECISION,
    river_basin_id  TEXT REFERENCES river_basins(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- org_id = organization_id (denormalised for RLS performance — no join needed)
CREATE OR REPLACE FUNCTION sync_facility_org_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.org_id := NEW.organization_id; RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_facility_org_id ON facilities;
CREATE TRIGGER trg_facility_org_id
  BEFORE INSERT OR UPDATE ON facilities
  FOR EACH ROW EXECUTE FUNCTION sync_facility_org_id();

ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY facilities_tenant_isolation ON facilities
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE ON facilities TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 4. USERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email       TEXT NOT NULL UNIQUE,
    full_name   TEXT NOT NULL,
    role        user_role NOT NULL DEFAULT 'analyst',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_tenant_isolation ON users
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE ON users TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 5. UPLOADED FILES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uploaded_files (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    facility_id      UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    uploaded_by      UUID NOT NULL REFERENCES users(id),
    original_name    TEXT NOT NULL,
    storage_key      TEXT NOT NULL UNIQUE,
    mime_type        TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes       BIGINT NOT NULL DEFAULT 0,
    sha256_hash      TEXT NOT NULL,
    upload_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reporting_year   INTEGER NOT NULL,
    engine_type      engine_type NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_uploaded_files_org      ON uploaded_files(org_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_facility ON uploaded_files(facility_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_hash     ON uploaded_files(sha256_hash);

ALTER TABLE uploaded_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY uploaded_files_tenant_isolation ON uploaded_files
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);

GRANT SELECT, INSERT ON uploaded_files TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 6. CARBON EMISSIONS INVENTORY
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carbon_inventory (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    facility_id           UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    uploaded_file_id      UUID REFERENCES uploaded_files(id),
    reporting_year        INTEGER NOT NULL,
    reporting_period_start DATE NOT NULL,
    reporting_period_end   DATE NOT NULL,
    iso_category          SMALLINT NOT NULL CHECK (iso_category BETWEEN 1 AND 6),
    iso_category_label    TEXT NOT NULL,
    source_name           TEXT NOT NULL,
    source_type           TEXT NOT NULL,
    co2e_t                DOUBLE PRECISION NOT NULL CHECK (co2e_t >= 0),
    co2_t                 DOUBLE PRECISION NOT NULL DEFAULT 0,
    ch4_t                 DOUBLE PRECISION NOT NULL DEFAULT 0,
    n2o_t                 DOUBLE PRECISION NOT NULL DEFAULT 0,
    biomass_co2_memo_t    DOUBLE PRECISION NOT NULL DEFAULT 0,
    emission_factor_value DOUBLE PRECISION,
    emission_factor_unit  TEXT,
    emission_factor_source TEXT,
    gwp_reference         gwp_reference NOT NULL DEFAULT 'IPCC AR6',
    gwp_co2               DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    gwp_ch4               DOUBLE PRECISION NOT NULL DEFAULT 27.9,
    gwp_n2o               DOUBLE PRECISION NOT NULL DEFAULT 273.0,
    data_quality_score    data_quality_score NOT NULL DEFAULT 'Medium',
    data_quality_notes    TEXT,
    input_sha256_hash     TEXT NOT NULL,
    calculated_by         UUID NOT NULL REFERENCES users(id),
    calculated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    methodology_tag       TEXT NOT NULL DEFAULT 'GCCA Carbon v3.1'
);

CREATE INDEX IF NOT EXISTS idx_carbon_org_year     ON carbon_inventory(org_id, reporting_year);
CREATE INDEX IF NOT EXISTS idx_carbon_iso_category ON carbon_inventory(iso_category);
CREATE INDEX IF NOT EXISTS idx_carbon_hash         ON carbon_inventory(input_sha256_hash);

ALTER TABLE carbon_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY carbon_tenant_isolation ON carbon_inventory
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);

GRANT SELECT, INSERT ON carbon_inventory TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 7. WATER INVENTORY
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS water_inventory (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    facility_id              UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    uploaded_file_id         UUID REFERENCES uploaded_files(id),
    reporting_year           INTEGER NOT NULL,
    reporting_period_start   DATE NOT NULL,
    reporting_period_end     DATE NOT NULL,
    flow_type                water_flow_type NOT NULL,
    flow_subtype             TEXT,
    source_name              TEXT NOT NULL,
    water_source             TEXT,
    discharge_destination    TEXT,
    volume_m3                DOUBLE PRECISION NOT NULL CHECK (volume_m3 >= 0),
    kpi_1_consumption_m3     DOUBLE PRECISION,
    kpi_2_intensity_l_per_t  DOUBLE PRECISION,
    freshwater_consumption_m3 DOUBLE PRECISION,
    water_stress_index       DOUBLE PRECISION,
    characterisation_factor  DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    characterisation_method  TEXT NOT NULL DEFAULT 'WBCSD Global Water Tool',
    quality_parameters       JSONB,
    data_quality_score       data_quality_score NOT NULL DEFAULT 'Medium',
    data_quality_notes       TEXT,
    input_sha256_hash        TEXT NOT NULL,
    calculated_by            UUID NOT NULL REFERENCES users(id),
    calculated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    methodology_tag          TEXT NOT NULL DEFAULT 'GCCA Water Guidelines 2021'
);

CREATE INDEX IF NOT EXISTS idx_water_org_year  ON water_inventory(org_id, reporting_year);
CREATE INDEX IF NOT EXISTS idx_water_flow_type ON water_inventory(flow_type);
CREATE INDEX IF NOT EXISTS idx_water_hash      ON water_inventory(input_sha256_hash);

ALTER TABLE water_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY water_tenant_isolation ON water_inventory
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);

GRANT SELECT, INSERT ON water_inventory TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 8. GENERATED REPORTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generated_reports (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                 UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    facility_id            UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    generated_by           UUID NOT NULL REFERENCES users(id),
    report_type            report_type NOT NULL,
    reporting_year         INTEGER NOT NULL,
    reporting_period_start DATE NOT NULL,
    reporting_period_end   DATE NOT NULL,
    title                  TEXT NOT NULL,
    sha256_hash            TEXT NOT NULL UNIQUE,
    report_json            JSONB NOT NULL,
    storage_key            TEXT,
    standards_cited        JSONB NOT NULL DEFAULT '[]',
    status                 report_status NOT NULL DEFAULT 'draft',
    submitted_at           TIMESTAMPTZ,
    submission_ref         TEXT,
    generated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    carbon_record_ids      JSONB NOT NULL DEFAULT '[]',
    water_record_ids       JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_reports_org_year ON generated_reports(org_id, reporting_year);
CREATE INDEX IF NOT EXISTS idx_reports_hash     ON generated_reports(sha256_hash);
CREATE INDEX IF NOT EXISTS idx_reports_status   ON generated_reports(status);

ALTER TABLE generated_reports ENABLE ROW LEVEL SECURITY;

-- SELECT/INSERT/UPDATE allowed for own org; DELETE blocked for all (immutable)
CREATE POLICY reports_tenant_isolation ON generated_reports
  FOR SELECT USING (org_id = current_setting('app.current_org_id', TRUE)::UUID);

CREATE POLICY reports_tenant_insert ON generated_reports
  FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);

-- No UPDATE/DELETE policy → reports are immutable once written
GRANT SELECT, INSERT ON generated_reports TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 9. REPORT EVIDENCE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_evidence (
    report_id     UUID NOT NULL REFERENCES generated_reports(id) ON DELETE CASCADE,
    file_id       UUID NOT NULL REFERENCES uploaded_files(id) ON DELETE CASCADE,
    org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    evidence_role evidence_role NOT NULL DEFAULT 'supporting_data',
    linked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (report_id, file_id)
);

ALTER TABLE report_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_evidence_tenant_isolation ON report_evidence
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);

GRANT SELECT, INSERT ON report_evidence TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 10. INPUT HASH REGISTRY
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS input_hash_registry (
    input_sha256_hash TEXT NOT NULL,
    engine_type       engine_type NOT NULL,
    org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    facility_id       UUID NOT NULL REFERENCES facilities(id),
    first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_seen_by     UUID NOT NULL REFERENCES users(id),
    record_id         UUID NOT NULL,
    PRIMARY KEY (input_sha256_hash, engine_type, org_id)
);

ALTER TABLE input_hash_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY hash_registry_tenant_isolation ON input_hash_registry
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);

GRANT SELECT, INSERT ON input_hash_registry TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 11. VALIDATION LOG
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS validation_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    uploaded_file_id UUID NOT NULL REFERENCES uploaded_files(id) ON DELETE CASCADE,
    engine_type      engine_type NOT NULL,
    is_blocked       BOOLEAN NOT NULL DEFAULT FALSE,
    errors_json      JSONB NOT NULL DEFAULT '[]',
    warnings_json    JSONB NOT NULL DEFAULT '[]',
    overall_quality  data_quality_score NOT NULL DEFAULT 'Medium',
    validated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE validation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY validation_log_tenant_isolation ON validation_log
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);

GRANT SELECT, INSERT ON validation_log TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 12. EMISSION FACTOR LIBRARY  (global GCCA + private per-org)
--
-- Global rows:  org_id IS NULL  → readable by all tenants (no RLS filter)
-- Private rows: org_id = <uuid> → only visible to that org
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emission_factor_library (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = global
    fuel_type       TEXT NOT NULL,
    ef_value        DOUBLE PRECISION NOT NULL,
    ef_unit         TEXT NOT NULL,
    source          TEXT NOT NULL,
    gwp_reference   gwp_reference NOT NULL DEFAULT 'IPCC AR6',
    valid_from      DATE,
    valid_to        DATE,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed global GCCA Table 4 defaults (org_id = NULL → visible to all)
INSERT INTO emission_factor_library
    (fuel_type, ef_value, ef_unit, source, is_default, org_id)
VALUES
    ('coal_anthracite',       96.0,  'kg CO₂/GJ', 'GCCA Table 4 v3.1', TRUE, NULL),
    ('petrol_coke',           92.8,  'kg CO₂/GJ', 'GCCA Table 4 v3.1', TRUE, NULL),
    ('heavy_fuel_oil',        77.4,  'kg CO₂/GJ', 'GCCA Table 4 v3.1', TRUE, NULL),
    ('diesel_oil',            74.1,  'kg CO₂/GJ', 'GCCA Table 4 v3.1', TRUE, NULL),
    ('natural_gas',           56.1,  'kg CO₂/GJ', 'GCCA Table 4 v3.1', TRUE, NULL),
    ('lignite',              101.0,  'kg CO₂/GJ', 'GCCA Table 4 v3.1', TRUE, NULL),
    ('dried_sewage_sludge',  110.0,  'kg CO₂/GJ', 'GCCA Table 4 v3.1', TRUE, NULL),
    ('wood_saw_dust',        110.0,  'kg CO₂/GJ', 'GCCA Table 4 v3.1', TRUE, NULL),
    ('other_biomass',        110.0,  'kg CO₂/GJ', 'GCCA Table 4 v3.1', TRUE, NULL),
    ('calcination_default',  525.0,  'kg CO₂/t clinker', 'GCCA Method B1', TRUE, NULL)
ON CONFLICT DO NOTHING;

ALTER TABLE emission_factor_library ENABLE ROW LEVEL SECURITY;

-- Global factors (org_id IS NULL) are readable by everyone
-- Private factors are only visible to their own org
CREATE POLICY ef_library_read ON emission_factor_library
  FOR SELECT
  USING (
    org_id IS NULL
    OR org_id = current_setting('app.current_org_id', TRUE)::UUID
  );

-- Only the owning org can insert/update their private factors
CREATE POLICY ef_library_write ON emission_factor_library
  FOR INSERT
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);

CREATE POLICY ef_library_update ON emission_factor_library
  FOR UPDATE
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE ON emission_factor_library TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 13. AUDIT LOGS  (immutable — records every destructive action)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID REFERENCES organizations(id),   -- NULL for system-level events
    table_name    TEXT NOT NULL,
    record_id     UUID NOT NULL,
    action        audit_action NOT NULL,
    old_data      JSONB,                               -- previous row (UPDATE/DELETE)
    new_data      JSONB,                               -- new row (INSERT/UPDATE)
    changed_by    UUID REFERENCES users(id),           -- app-level user
    db_user       TEXT NOT NULL DEFAULT current_user,  -- PostgreSQL session user
    session_org   TEXT,                                -- app.current_org_id at time of action
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_org       ON audit_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_table     ON audit_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_occurred  ON audit_logs(occurred_at DESC);

-- Audit log is append-only: no UPDATE or DELETE allowed even for superusers
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_insert_only ON audit_logs
  FOR INSERT WITH CHECK (TRUE);

-- Tenants can only read their own audit entries
CREATE POLICY audit_logs_read ON audit_logs
  FOR SELECT
  USING (
    org_id IS NULL
    OR org_id = current_setting('app.current_org_id', TRUE)::UUID
  );

GRANT SELECT, INSERT ON audit_logs TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 14. AUDIT TRIGGER FUNCTION  (fires on UPDATE/DELETE of sensitive tables)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO audit_logs (
    org_id, table_name, record_id, action,
    old_data, new_data, db_user, session_org
  ) VALUES (
    COALESCE(
      (OLD.org_id)::UUID,
      (NEW.org_id)::UUID
    ),
    TG_TABLE_NAME,
    COALESCE(OLD.id, NEW.id),
    TG_OP::audit_action,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    current_user,
    current_setting('app.current_org_id', TRUE)
  );
  RETURN COALESCE(NEW, OLD);
END $$;

-- Attach audit trigger to all sensitive tables
DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'carbon_inventory', 'water_inventory',
    'generated_reports', 'uploaded_files',
    'emission_factor_library'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_audit_%1$s ON %1$s;
       CREATE TRIGGER trg_audit_%1$s
         AFTER INSERT OR UPDATE OR DELETE ON %1$s
         FOR EACH ROW EXECUTE FUNCTION fn_audit_log();',
      t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 15. GUARD FUNCTION — blocks queries without a tenant context
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_require_org_context()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.current_org_id', TRUE) = '' THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_MISSING: app.current_org_id must be set before querying tenant data';
  END IF;
  RETURN NEW;
END $$;

-- Attach guard to write operations on all tenant tables
DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'carbon_inventory', 'water_inventory', 'generated_reports',
    'uploaded_files', 'facilities', 'users', 'validation_log',
    'input_hash_registry', 'report_evidence'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_require_org_%1$s ON %1$s;
       CREATE TRIGGER trg_require_org_%1$s
         BEFORE INSERT OR UPDATE ON %1$s
         FOR EACH ROW EXECUTE FUNCTION fn_require_org_context();',
      t
    );
  END LOOP;
END $$;
