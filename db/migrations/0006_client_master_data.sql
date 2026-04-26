
-- =============================================================================
-- Tefnut Client Master Data — Migration 0006
-- Target: Amazon RDS PostgreSQL 16+
--
-- Extends existing organizations + facilities with full client master fields.
-- Adds:
--   companies          — enriched company profile (extends organizations)
--   plants             — enriched plant profile (extends facilities)
--   reporting_profiles — per-company per-year reporting configuration
--   client_contacts    — contact persons per company
--   client_import_log  — audit trail for every Excel/CSV import
--
-- Backward compatibility:
--   organizations and facilities are UNCHANGED.
--   companies.org_id → organizations.id  (1:1, extends via FK)
--   plants.facility_id → facilities.id   (1:1, extends via FK)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- NEW ENUM TYPES
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE company_size AS ENUM ('micro', 'small', 'medium', 'large', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE import_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'partial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 1. COMPANIES  (enriched company profile — 1:1 with organizations)
--    org_id is both FK and natural key — one company per organization.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,

    -- Company identity
    company_name        TEXT NOT NULL,
    company_size        company_size,
    industry            TEXT NOT NULL DEFAULT 'cement',
    sub_industry        TEXT,                   -- e.g. 'white cement', 'ready-mix'
    country             TEXT NOT NULL,
    city                TEXT,
    website             TEXT,

    -- Financial
    currency            CHAR(3) NOT NULL DEFAULT 'USD',
    fiscal_year_start   SMALLINT NOT NULL DEFAULT 1 CHECK (fiscal_year_start BETWEEN 1 AND 12),

    -- Compliance
    export_to_eu        BOOLEAN NOT NULL DEFAULT FALSE,
    eori_number         TEXT,                   -- EU CBAM identifier
    reporting_standard  TEXT NOT NULL DEFAULT 'GCCA'
                        CHECK (reporting_standard IN ('GHG Protocol','ISO 14064-1','GCCA','EU CBAM','CDP','GRI')),

    -- Workforce
    employee_count      INTEGER CHECK (employee_count >= 0),

    -- Import metadata
    source_file         TEXT,                   -- original Excel/CSV filename
    source_row          INTEGER,                -- row number in source file
    import_batch_id     UUID,                   -- links to client_import_log

    -- Audit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_companies_org      ON companies(org_id);
CREATE INDEX IF NOT EXISTS idx_companies_name     ON companies(company_name);
CREATE INDEX IF NOT EXISTS idx_companies_country  ON companies(country);
CREATE INDEX IF NOT EXISTS idx_companies_industry ON companies(industry);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION fn_companies_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION fn_companies_updated_at();

-- RLS: admin role can see all; regular tenants see only their own
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_tenant ON companies
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE ON companies TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 2. PLANTS  (enriched plant profile — 1:1 with facilities)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id         UUID NOT NULL UNIQUE REFERENCES facilities(id) ON DELETE CASCADE,
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Plant identity
    plant_name          TEXT NOT NULL,
    plant_type          TEXT NOT NULL DEFAULT 'integrated'
                        CHECK (plant_type IN ('integrated','grinding_only','clinker_only','white_cement','other')),
    country             TEXT NOT NULL,
    city                TEXT,
    latitude            DOUBLE PRECISION,
    longitude           DOUBLE PRECISION,

    -- Capacity
    plant_capacity_t_yr DOUBLE PRECISION,       -- annual cement capacity (tonnes)
    clinker_capacity_t_yr DOUBLE PRECISION,
    production_lines    SMALLINT CHECK (production_lines >= 1),
    kiln_type           TEXT
                        CHECK (kiln_type IN ('dry_kiln','wet_kiln','semi_dry_kiln','dry_kiln_ph_pc','vertical_shaft_kiln','other')),
    commissioning_year  SMALLINT CHECK (commissioning_year BETWEEN 1900 AND 2100),

    -- Import metadata
    source_file         TEXT,
    source_row          INTEGER,
    import_batch_id     UUID,

    -- Audit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plants_facility ON plants(facility_id);
CREATE INDEX IF NOT EXISTS idx_plants_org      ON plants(org_id);
CREATE INDEX IF NOT EXISTS idx_plants_name     ON plants(plant_name);

CREATE OR REPLACE FUNCTION fn_plants_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_plants_updated_at ON plants;
CREATE TRIGGER trg_plants_updated_at
  BEFORE UPDATE ON plants
  FOR EACH ROW EXECUTE FUNCTION fn_plants_updated_at();

ALTER TABLE plants ENABLE ROW LEVEL SECURITY;

CREATE POLICY plants_tenant ON plants
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE ON plants TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 3. REPORTING PROFILES  (per-company per-year configuration)
--    Connects companies to carbon/water/CBAM reports for a given year.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reporting_profiles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    reporting_year      SMALLINT NOT NULL,

    -- Scope configuration
    includes_carbon     BOOLEAN NOT NULL DEFAULT TRUE,
    includes_water      BOOLEAN NOT NULL DEFAULT FALSE,
    includes_cbam       BOOLEAN NOT NULL DEFAULT FALSE,

    -- Standards for this year
    reporting_standard  TEXT NOT NULL DEFAULT 'GCCA',
    gwp_reference       TEXT NOT NULL DEFAULT 'IPCC AR6'
                        CHECK (gwp_reference IN ('IPCC AR4','IPCC AR5','IPCC AR6')),
    base_year           SMALLINT,

    -- Status
    status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','locked','archived')),
    locked_at           TIMESTAMPTZ,
    locked_by           UUID REFERENCES users(id),

    -- Linked report IDs (populated as reports are generated)
    carbon_report_id    UUID REFERENCES generated_reports(id),
    water_report_id     UUID REFERENCES generated_reports(id),
    cbam_report_id      UUID REFERENCES generated_reports(id),

    -- Import metadata
    source_file         TEXT,
    import_batch_id     UUID,

    -- Audit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (org_id, reporting_year)
);

CREATE INDEX IF NOT EXISTS idx_rp_org_year    ON reporting_profiles(org_id, reporting_year);
CREATE INDEX IF NOT EXISTS idx_rp_company     ON reporting_profiles(company_id);

CREATE OR REPLACE FUNCTION fn_rp_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_rp_updated_at ON reporting_profiles;
CREATE TRIGGER trg_rp_updated_at
  BEFORE UPDATE ON reporting_profiles
  FOR EACH ROW EXECUTE FUNCTION fn_rp_updated_at();

ALTER TABLE reporting_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY rp_tenant ON reporting_profiles
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE ON reporting_profiles TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 4. CLIENT CONTACTS  (contact persons per company)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_contacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    contact_name    TEXT NOT NULL,
    contact_email   TEXT,
    contact_phone   TEXT,
    role            TEXT DEFAULT 'sustainability_lead',
    is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, contact_email)
);

CREATE INDEX IF NOT EXISTS idx_contacts_company ON client_contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email   ON client_contacts(contact_email);

ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY contacts_tenant ON client_contacts
  USING (org_id = current_setting('app.current_org_id', TRUE)::UUID)
  WITH CHECK (org_id = current_setting('app.current_org_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE ON client_contacts TO tefnut_app;

-- ---------------------------------------------------------------------------
-- 5. CLIENT IMPORT LOG  (audit trail for every Excel/CSV import batch)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_import_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID REFERENCES organizations(id),   -- NULL = system/admin import
    filename            TEXT NOT NULL,
    file_sha256         TEXT NOT NULL,
    status              import_status NOT NULL DEFAULT 'pending',
    total_rows          INTEGER NOT NULL DEFAULT 0,
    imported_companies  INTEGER NOT NULL DEFAULT 0,
    imported_plants     INTEGER NOT NULL DEFAULT 0,
    updated_companies   INTEGER NOT NULL DEFAULT 0,
    updated_plants      INTEGER NOT NULL DEFAULT 0,
    skipped_rows        INTEGER NOT NULL DEFAULT 0,
    failed_rows         INTEGER NOT NULL DEFAULT 0,
    errors_json         JSONB NOT NULL DEFAULT '[]',
    warnings_json       JSONB NOT NULL DEFAULT '[]',
    imported_by         UUID REFERENCES users(id),
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_log_org    ON client_import_log(org_id);
CREATE INDEX IF NOT EXISTS idx_import_log_status ON client_import_log(status);

GRANT SELECT, INSERT, UPDATE ON client_import_log TO tefnut_app;

-- ---------------------------------------------------------------------------
-- CONVENIENCE VIEW: v_client_summary
-- Joins companies + plants + reporting_profiles for admin dashboard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_client_summary AS
SELECT
    c.id                    AS company_id,
    c.org_id,
    c.company_name,
    c.company_size,
    c.industry,
    c.sub_industry,
    c.country,
    c.city,
    c.currency,
    c.export_to_eu,
    c.employee_count,
    c.reporting_standard,
    COUNT(DISTINCT p.id)    AS plant_count,
    COUNT(DISTINCT rp.id)   AS reporting_profile_count,
    MAX(rp.reporting_year)  AS latest_reporting_year,
    cc.contact_name         AS primary_contact_name,
    cc.contact_email        AS primary_contact_email,
    c.created_at,
    c.updated_at
FROM companies c
LEFT JOIN plants p           ON p.org_id = c.org_id
LEFT JOIN reporting_profiles rp ON rp.company_id = c.id
LEFT JOIN client_contacts cc ON cc.company_id = c.id AND cc.is_primary = TRUE
GROUP BY c.id, c.org_id, c.company_name, c.company_size, c.industry,
         c.sub_industry, c.country, c.city, c.currency, c.export_to_eu,
         c.employee_count, c.reporting_standard, cc.contact_name,
         cc.contact_email, c.created_at, c.updated_at;

GRANT SELECT ON v_client_summary TO tefnut_app;
