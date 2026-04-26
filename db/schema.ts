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

// ---------------------------------------------------------------------------
// Enterprise Schema types (EU CBAM 2023/956 + Migration 0004)
// Mirrors db/migrations/0004_enterprise_schema.sql
// ---------------------------------------------------------------------------

export type KilnType = "dry_kiln" | "wet_kiln" | "semi_dry_kiln" | "dry_kiln_ph_pc" | "vertical_shaft_kiln" | "other";
export type PeriodType = "annual" | "quarterly" | "monthly";
export type PeriodStatus = "open" | "locked" | "archived";
export type RunStatus = "draft" | "submitted" | "under_review" | "approved" | "superseded";
export type TransportMode = "road" | "rail" | "sea" | "air" | "pipeline" | "other";
export type ScenarioType = "baseline" | "reduction_target" | "what_if" | "ai_recommendation";
export type ProjectStatus = "proposed" | "approved" | "in_progress" | "completed" | "cancelled";
export type ReportingStandard = "GHG Protocol" | "ISO 14064-1" | "GCCA" | "EU CBAM" | "CDP" | "GRI";

/** Structured period registry — replaces scattered reporting_year integers */
export interface ReportingPeriod {
  id: string;
  org_id: string;
  facility_id: string;
  period_label: string;       // e.g. '2026-Annual', '2026-Q1'
  period_type: PeriodType;
  year: number;
  quarter: number | null;
  start_date: string;
  end_date: string;
  status: PeriodStatus;
  locked_at: string | null;
  locked_by: string | null;
  created_at: string;
}

/** Structured, queryable input snapshot per period + version */
export interface PlantInputRecord {
  id: string;
  org_id: string;
  facility_id: string;
  period_id: string;
  version_no: number;
  status: RunStatus;
  clinker_production_t: number | null;
  cement_production_t: number;
  raw_meal_t: number | null;
  clinker_ratio: number | null;
  operating_days: number | null;
  calcination_method: string;
  calcination_ef_kg_per_t: number | null;
  data_completeness_pct: number;
  data_quality_score: DataQualityScore;
  input_sha256_hash: string;
  created_by: string;
  approved_by: string | null;
  created_at: string;
  approved_at: string | null;
  notes: string | null;
}

/** Normalised fuel row linked to a PlantInputRecord */
export interface FuelEntry {
  id: string;
  org_id: string;
  plant_input_id: string;
  fuel_type: string;
  is_kiln_fuel: boolean;
  consumption_t: number;
  lhv_gj_per_t: number;
  ef_kg_co2_per_gj: number | null;
  ef_source: string | null;
  biogenic_fraction: number;
  supplier_name: string | null;
  created_at: string;
}

/** Normalised electricity row */
export interface ElectricityEntry {
  id: string;
  org_id: string;
  plant_input_id: string;
  purchased_mwh: number;
  on_site_generated_mwh: number;
  renewable_mwh: number;
  grid_ef_kg_co2_per_mwh: number;
  grid_ef_source: string;
  created_at: string;
}

/** Normalised logistics row */
export interface LogisticsEntry {
  id: string;
  org_id: string;
  plant_input_id: string;
  description: string;
  direction: "inbound" | "outbound";
  transport_mode: TransportMode;
  freight_t_km: number;
  ef_kg_co2_per_t_km: number;
  created_at: string;
}

/** Normalised water row */
export interface WaterEntry {
  id: string;
  org_id: string;
  plant_input_id: string;
  withdrawal_m3: number;
  discharge_m3: number;
  recycled_m3: number;
  harvested_rain_m3: number;
  water_source: string | null;
  discharge_dest: string | null;
  water_stress_index: number | null;
  created_at: string;
}

/** Versioned calculation run registry */
export interface CalculationRun {
  id: string;
  org_id: string;
  facility_id: string;
  period_id: string;
  plant_input_id: string;
  version_no: number;
  status: RunStatus;
  engine_version: string;
  run_sha256: string;
  created_by: string;
  approved_by: string | null;
  created_at: string;
  approved_at: string | null;
  notes: string | null;
}

/** Structured KPI outputs — queryable, not JSON blobs */
export interface CalculationResult {
  id: string;
  org_id: string;
  run_id: string;
  scope1_total_t: number;
  scope2_total_t: number;
  scope3_total_t: number;
  total_co2e_t: number;
  biomass_co2_memo_t: number;
  calcination_co2_t: number;
  kiln_fuel_co2_t: number;
  non_kiln_fuel_co2_t: number;
  electricity_co2_t: number;
  transport_co2_t: number;
  kg_co2_per_t_cement: number | null;
  kg_co2_per_t_clinker: number | null;
  gj_per_t_clinker: number | null;
  m3_water_per_t_product: number | null;
  water_withdrawal_m3: number | null;
  water_consumption_m3: number | null;
  water_recycled_m3: number | null;
  water_intensity_l_per_t: number | null;
  kiln_energy_tj: number | null;
  non_kiln_energy_tj: number | null;
  cbam_see_t_per_t: number | null;
  cbam_certificate_obligation: number | null;
  cbam_net_payable_eur: number | null;
  data_quality_score: DataQualityScore;
  data_completeness_pct: number;
  validation_warnings_json: string;   // JSON array
  source_mix_json: string;            // JSON array
  calculated_at: string;
}

/** Portfolio + reference benchmarks */
export interface Benchmark {
  id: string;
  org_id: string;
  facility_id: string | null;
  period_id: string | null;
  benchmark_type: "portfolio_avg" | "reference_factor" | "prior_year" | "industry_best" | "target";
  metric: string;
  value: number;
  unit: string;
  source: string | null;
  valid_from: string | null;
  valid_to: string | null;
  created_at: string;
}

/** AI / what-if scenario run */
export interface ScenarioRun {
  id: string;
  org_id: string;
  facility_id: string;
  base_run_id: string | null;
  scenario_type: ScenarioType;
  name: string;
  description: string | null;
  assumptions_json: string;
  result_delta_json: string | null;
  ai_model_version: string | null;
  created_by: string;
  created_at: string;
}

/** Decarbonisation project tracking */
export interface ReductionProject {
  id: string;
  org_id: string;
  facility_id: string | null;
  name: string;
  description: string | null;
  status: ProjectStatus;
  target_metric: string;
  baseline_value: number | null;
  target_value: number | null;
  target_year: number | null;
  estimated_reduction_t_co2e: number | null;
  capex_estimate_usd: number | null;
  linked_scenario_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Insert helpers
export type NewReportingPeriod = Omit<ReportingPeriod, "id" | "created_at">;
export type NewPlantInputRecord = Omit<PlantInputRecord, "id" | "created_at">;
export type NewFuelEntry = Omit<FuelEntry, "id" | "created_at">;
export type NewElectricityEntry = Omit<ElectricityEntry, "id" | "created_at">;
export type NewLogisticsEntry = Omit<LogisticsEntry, "id" | "created_at">;
export type NewWaterEntry = Omit<WaterEntry, "id" | "created_at">;
export type NewCalculationRun = Omit<CalculationRun, "id" | "created_at">;
export type NewCalculationResult = Omit<CalculationResult, "id" | "calculated_at">;
export type NewBenchmark = Omit<Benchmark, "id" | "created_at">;
export type NewScenarioRun = Omit<ScenarioRun, "id" | "created_at">;
export type NewReductionProject = Omit<ReductionProject, "id" | "created_at" | "updated_at">;

// ---------------------------------------------------------------------------
// Emission Factors (Migration 0005)
// ---------------------------------------------------------------------------

export type EFSourceType =
  | "gcca_default"
  | "ipcc_efdb"
  | "national_inventory"
  | "peer_reviewed"
  | "plant_specific"
  | "operator_supplied"
  | "regulatory"
  | "other";

/** Master emission factor record */
export interface EmissionFactor {
  id: string;
  org_id: string | null;          // null = global default
  facility_id: string | null;
  factor_code: string;
  category: string;               // fuel | electricity | cement_process | transport | water
  subcategory: string;
  fuel_type: string | null;
  process_type: string | null;
  geography: string | null;       // ISO country code or 'Global'
  source_name: string;
  source_type: EFSourceType;
  source_file: string | null;
  source_sheet: string | null;
  reporting_year: number | null;
  applicable_from: string | null;
  applicable_to: string | null;
  unit: string;
  value: number;
  value_min: number | null;
  value_max: number | null;
  confidence_score: number | null;
  priority_rank: 1 | 2 | 3 | 4;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Factor usage traceability — one row per metric per calculation run */
export interface CalculationFactorUsage {
  id: string;
  org_id: string;
  calculation_run_id: string;
  factor_id: string | null;       // null if plant-supplied inline
  metric_name: string;            // e.g. 'calcination_ef', 'coal_anthracite_ef'
  selected_value: number;
  selected_unit: string;
  source_name: string;
  priority_rank_used: number;
  reason_selected: string;
  created_at: string;
}

export type NewEmissionFactor = Omit<EmissionFactor, "id" | "created_at" | "updated_at">;
export type NewCalculationFactorUsage = Omit<CalculationFactorUsage, "id" | "created_at">;

// ---------------------------------------------------------------------------
// Client Master Data (Migration 0006)
// ---------------------------------------------------------------------------

export type CompanySize = "micro" | "small" | "medium" | "large" | "enterprise";
export type ImportStatus = "pending" | "processing" | "completed" | "failed" | "partial";
export type PlantTypeDetail = "integrated" | "grinding_only" | "clinker_only" | "white_cement" | "other";

/** Enriched company profile — 1:1 with organizations */
export interface Company {
  id: string;
  org_id: string;
  company_name: string;
  company_size: CompanySize | null;
  industry: string;
  sub_industry: string | null;
  country: string;
  city: string | null;
  website: string | null;
  currency: string;
  fiscal_year_start: number;
  export_to_eu: boolean;
  eori_number: string | null;
  reporting_standard: ReportingStandard;
  employee_count: number | null;
  source_file: string | null;
  source_row: number | null;
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Enriched plant profile — 1:1 with facilities */
export interface Plant {
  id: string;
  facility_id: string;
  org_id: string;
  plant_name: string;
  plant_type: PlantTypeDetail;
  country: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  plant_capacity_t_yr: number | null;
  clinker_capacity_t_yr: number | null;
  production_lines: number | null;
  kiln_type: KilnType | null;
  commissioning_year: number | null;
  source_file: string | null;
  source_row: number | null;
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Per-company per-year reporting configuration */
export interface ReportingProfile {
  id: string;
  org_id: string;
  company_id: string;
  reporting_year: number;
  includes_carbon: boolean;
  includes_water: boolean;
  includes_cbam: boolean;
  reporting_standard: string;
  gwp_reference: GwpReference;
  base_year: number | null;
  status: "active" | "locked" | "archived";
  locked_at: string | null;
  locked_by: string | null;
  carbon_report_id: string | null;
  water_report_id: string | null;
  cbam_report_id: string | null;
  source_file: string | null;
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Contact person for a company */
export interface ClientContact {
  id: string;
  org_id: string;
  company_id: string;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  role: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

/** Audit trail for every Excel/CSV import batch */
export interface ClientImportLog {
  id: string;
  org_id: string | null;
  filename: string;
  file_sha256: string;
  status: ImportStatus;
  total_rows: number;
  imported_companies: number;
  imported_plants: number;
  updated_companies: number;
  updated_plants: number;
  skipped_rows: number;
  failed_rows: number;
  errors_json: string;
  warnings_json: string;
  imported_by: string | null;
  started_at: string;
  completed_at: string | null;
}

export type NewCompany = Omit<Company, "id" | "created_at" | "updated_at">;
export type NewPlant = Omit<Plant, "id" | "created_at" | "updated_at">;
export type NewReportingProfile = Omit<ReportingProfile, "id" | "created_at" | "updated_at">;
export type NewClientContact = Omit<ClientContact, "id" | "created_at" | "updated_at">;
