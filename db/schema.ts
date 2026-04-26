/**
 * Tefnut Database Schema — TypeScript types
 *
 * Mirrors db/migrations/0001_iso_compliance_schema.sql
 * Used by Cloudflare D1 query helpers and API route handlers.
 *
 * Standards:
 *   ISO 14064-1:2018 — GHG Inventory
 *   ISO 14046:2014   — Water Footprint
 *   EU CBAM 2023/956
 */

// ---------------------------------------------------------------------------
// Enums (match CHECK constraints in SQL)
// ---------------------------------------------------------------------------
export type ReportingBoundaryType = "operational" | "financial" | "equity_share";
export type FacilityType = "cement_plant" | "grinding_mill" | "quarry" | "logistics_hub" | "other";
export type UserRole = "admin" | "sustainability_lead" | "analyst" | "auditor" | "viewer";
export type EngineType = "carbon" | "water";
export type GwpReference = "IPCC AR4" | "IPCC AR5" | "IPCC AR6";
export type DataQualityScore = "High" | "Medium" | "Low";
export type WaterStressLevel = "Extremely High" | "High" | "Medium-High" | "Low-Medium" | "Low";
export type ReportStatus = "draft" | "under_review" | "approved" | "submitted" | "archived";
export type EvidenceRole = "primary_input" | "supporting_data" | "third_party_audit" | "emission_factor_ref";

/** ISO 14064-1 §5.3 — six GHG categories */
export type IsoCarbonCategory = 1 | 2 | 3 | 4 | 5 | 6;

/** ISO 14046 §6.4 — water flow types */
export type WaterFlowType = "withdrawal" | "consumption" | "discharge" | "recycled" | "special";

export type CarbonSourceType =
  | "calcination"
  | "fuel_combustion_kiln"
  | "fuel_combustion_non_kiln"
  | "purchased_electricity"
  | "purchased_heat"
  | "transport_inbound"
  | "transport_outbound"
  | "raw_materials"
  | "waste_disposal"
  | "employee_commuting"
  | "other";

export type WaterSource =
  | "surface_water"
  | "groundwater"
  | "quarry_water_used"
  | "municipal_potable_water"
  | "external_wastewater"
  | "harvested_rainwater"
  | "recycled_internal"
  | "storm_water";

export type DischargeDestination =
  | "ocean"
  | "surface_water"
  | "subsurface_well"
  | "offsite_water_treatment"
  | "beneficial_other_users";

export type ReportType =
  | "iso_14064_ghg_inventory"
  | "iso_14046_water_footprint"
  | "cbam_quarterly"
  | "cbam_annual"
  | "esg_disclosure"
  | "combined_sustainability";

// ---------------------------------------------------------------------------
// Table row types (match SELECT * results from D1)
// ---------------------------------------------------------------------------

export interface RiverBasin {
  id: string;
  name: string;
  hydrosheds_level: number | null;
  country: string;
  wri_aqueduct_stress: WaterStressLevel | null;
}

export interface Organization {
  id: string;
  legal_name: string;
  eori_number: string | null;
  country: string;
  reporting_boundary_type: ReportingBoundaryType;
  base_year: number;
  river_basin_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Facility {
  id: string;
  organization_id: string;
  name: string;
  facility_type: FacilityType;
  country: string;
  latitude: number | null;
  longitude: number | null;
  capacity_t_yr: number | null;
  river_basin_id: string | null;
  created_at: string;
}

export interface User {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  created_at: string;
}

export interface UploadedFile {
  id: string;
  facility_id: string;
  uploaded_by: string;
  original_name: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  sha256_hash: string;
  upload_timestamp: string;
  reporting_year: number;
  engine_type: EngineType;
}

/** ISO 14064-1 §5.3 — one row per emission source per category */
export interface CarbonInventoryRecord {
  id: string;
  facility_id: string;
  uploaded_file_id: string | null;
  reporting_year: number;
  reporting_period_start: string;
  reporting_period_end: string;
  iso_category: IsoCarbonCategory;
  iso_category_label: string;
  source_name: string;
  source_type: CarbonSourceType;
  co2e_t: number;
  co2_t: number;
  ch4_t: number;
  n2o_t: number;
  biomass_co2_memo_t: number;
  emission_factor_value: number | null;
  emission_factor_unit: string | null;
  emission_factor_source: string | null;
  gwp_reference: GwpReference;
  gwp_co2: number;
  gwp_ch4: number;
  gwp_n2o: number;
  data_quality_score: DataQualityScore;
  data_quality_notes: string | null;
  input_sha256_hash: string;
  calculated_by: string;
  calculated_at: string;
  methodology_tag: string;
}

/** ISO 14046 §6.4 — one row per water flow */
export interface WaterInventoryRecord {
  id: string;
  facility_id: string;
  uploaded_file_id: string | null;
  reporting_year: number;
  reporting_period_start: string;
  reporting_period_end: string;
  flow_type: WaterFlowType;
  flow_subtype: string | null;
  source_name: string;
  water_source: WaterSource | null;
  discharge_destination: DischargeDestination | null;
  volume_m3: number;
  kpi_1_consumption_m3: number | null;
  kpi_2_intensity_l_per_t: number | null;
  freshwater_consumption_m3: number | null;
  water_stress_index: number | null;
  characterisation_factor: number;
  characterisation_method: string;
  /** JSON string — parse to WaterQualityParameters */
  quality_parameters: string | null;
  data_quality_score: DataQualityScore;
  data_quality_notes: string | null;
  input_sha256_hash: string;
  calculated_by: string;
  calculated_at: string;
  methodology_tag: string;
}

/** Parsed quality_parameters JSON */
export interface WaterQualityParameters {
  tds_mg_l?: number;        // Total Dissolved Solids
  ph?: number;
  temperature_c?: number;
  bod_mg_l?: number;        // Biological Oxygen Demand
  cod_mg_l?: number;        // Chemical Oxygen Demand
  tss_mg_l?: number;        // Total Suspended Solids
  conductivity_us_cm?: number;
  notes?: string;
}

/** Immutable audit trail — one row per generated report */
export interface GeneratedReport {
  id: string;
  facility_id: string;
  generated_by: string;
  report_type: ReportType;
  reporting_year: number;
  reporting_period_start: string;
  reporting_period_end: string;
  title: string;
  sha256_hash: string;
  /** Full ISO-structured report JSON (IsoReport | IsoWaterReport) */
  report_json: string;
  storage_key: string | null;
  /** JSON array of standard IDs */
  standards_cited: string;
  status: ReportStatus;
  submitted_at: string | null;
  submission_ref: string | null;
  generated_at: string;
  /** JSON array of carbon_inventory IDs */
  carbon_record_ids: string;
  /** JSON array of water_inventory IDs */
  water_record_ids: string;
}

export interface ReportEvidence {
  report_id: string;
  file_id: string;
  evidence_role: EvidenceRole;
  linked_at: string;
}

export interface InputHashRegistry {
  input_sha256_hash: string;
  engine_type: EngineType;
  facility_id: string;
  first_seen_at: string;
  first_seen_by: string;
  record_id: string;
}

export interface ValidationLogEntry {
  id: string;
  uploaded_file_id: string;
  engine_type: EngineType;
  is_blocked: 0 | 1;
  errors_json: string;
  warnings_json: string;
  overall_quality: DataQualityScore;
  validated_at: string;
}

// ---------------------------------------------------------------------------
// Insert helpers (omit auto-generated fields)
// ---------------------------------------------------------------------------
export type NewOrganization = Omit<Organization, "id" | "created_at" | "updated_at">;
export type NewFacility = Omit<Facility, "id" | "created_at">;
export type NewUploadedFile = Omit<UploadedFile, "id">;
export type NewCarbonRecord = Omit<CarbonInventoryRecord, "id" | "calculated_at">;
export type NewWaterRecord = Omit<WaterInventoryRecord, "id" | "calculated_at">;
export type NewGeneratedReport = Omit<GeneratedReport, "id" | "generated_at">;

// ---------------------------------------------------------------------------
// CBAM support types (EU CBAM 2023/956)
// Mirrors db/migrations/0003_cbam_tables.sql
// ---------------------------------------------------------------------------

/** Weekly EU ETS carbon price snapshot — cbam_ets_price_history */
export interface CBAMEtsPriceHistory {
  id: string;
  week_start_date: string;        // ISO-8601 date
  price_eur_per_t_co2e: string;   // NUMERIC returned as string by pg driver
  source_url: string;
  fetched_at_utc: string;         // ISO-8601 timestamptz
}

/** Daily FX rate to EUR — cbam_fx_rates */
export interface CBAMFxRate {
  id: string;
  currency_code: string;          // CHAR(3), e.g. 'EGP', 'USD'
  rate_date: string;              // ISO-8601 date
  rate_to_eur: string;            // NUMERIC returned as string by pg driver
  fetched_at_utc: string;         // ISO-8601 timestamptz
}
