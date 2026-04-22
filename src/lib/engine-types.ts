/**
 * TypeScript types mirroring the Python engine output contracts.
 * Keep in sync with carbon_engine/validation.py and water_engine/water_engine.py.
 */

// ---------------------------------------------------------------------------
// Validation layer
// ---------------------------------------------------------------------------
export interface ValidationDetail {
  error_code: string;
  field: string;
  message: string;
  suggested_fix: string;
  meta: Record<string, unknown>;
}

export interface ValidationResult {
  status: "OK" | "VALIDATION_FAILED" | "DUPLICATE_INPUT_DETECTED";
  errors: ValidationDetail[];
  warnings: ValidationDetail[];
}

// ---------------------------------------------------------------------------
// Shared audit
// ---------------------------------------------------------------------------
export interface AuditTrail {
  source_reference: {
    source_filename: string;
    upload_timestamp_utc: string;
    input_hash: string;
  };
  user_id: string;
}

export interface MethodologyTag {
  protocol_name: string;   // "GCCA Water" | "GCCA Carbon"
  protocol_version: string; // "0.1"
}

export interface CalculationStep {
  step_id: string;
  label: string;
  formula: string;
  inputs: Record<string, { value: number; unit: string }>;
  output_value: number;
  output_unit: string;
}

// ---------------------------------------------------------------------------
// Water engine output
// ---------------------------------------------------------------------------
export interface WaterResult {
  total_water_withdrawal_m3: number;
  total_water_discharge_m3: number;
  total_water_consumption_m3: number;
  total_freshwater_consumption_m3: number;
  water_consumption_per_tonne_litres: number;
  quarry_water_not_used_m3: number;
  recycled_water_m3: number;
  storm_water_collected_discharged_m3: number;
  harvested_rainwater_withdrawal_m3: number;
  warnings: string[];
  validation_warnings: ValidationDetail[];
  audit_trail: AuditTrail;
  methodology: MethodologyTag;
  steps_breakdown: CalculationStep[];
}

// ---------------------------------------------------------------------------
// Carbon engine output
// ---------------------------------------------------------------------------
export interface CarbonResult {
  specific_co2_kg_per_t_cement: number;
  total_co2_t: number;
  validation_warnings: ValidationDetail[];
  audit_trail: AuditTrail;
  methodology: MethodologyTag;
  steps_breakdown: CalculationStep[];
  // Extended fields returned by the full engine (used for ISO mapping)
  plant_name?: string;
  reporting_year?: number;
  scope1?: {
    calcination_co2_t: number;
    fuel_combustion_co2_t: number;
    biomass_co2_memo_t: number;
    total_scope1_co2_t: number;
  };
  scope2?: { electricity_co2_t: number };
  scope3?: { transport_co2_t: number };
  energy?: {
    total_kiln_energy_tj: number;
    total_non_kiln_energy_tj: number;
    energy_intensity_gj_per_t_clinker: number;
  };
}

// ---------------------------------------------------------------------------
// Engine response envelope (both engines)
// ---------------------------------------------------------------------------
export interface EngineResponse<T> {
  result: T | null;
  validation: ValidationResult;
}

// ---------------------------------------------------------------------------
// ISO 14064-1:2018 Report Structure (Clause 9.3)
// ---------------------------------------------------------------------------
export type DataQuality = "High" | "Medium" | "Low";

export interface IsoEmissionCategory {
  /** ISO 14064-1 category number (1–6) */
  category: number;
  /** ISO label */
  label: string;
  /** Short description of what this category covers */
  description: string;
  /** tCO₂e for this category */
  co2e_t: number;
  /** Emission sources mapped from engine steps */
  sources: Array<{
    name: string;
    co2e_t: number;
    emission_factor?: string;
    ef_value?: number;
    ef_unit?: string;
  }>;
  /** Whether this category has real engine data or is a placeholder */
  has_data: boolean;
  data_quality: DataQuality;
}

export interface IsoOrganizationalDescription {
  reporting_period: string;
  organizational_boundaries: string;
  facility_description: string;
  consolidation_approach: string;
}

export interface IsoMethodologyStatement {
  quantification_basis: string;
  gwp_source: string;
  gwp_ar: string;
  standards_reference: string;
}

export interface IsoUncertaintyAssessment {
  overall_quality: DataQuality;
  notes: string;
  validation_flags: string[];
}

export interface IsoReport {
  title: string;
  generated_at: string;
  audit_hash: string;
  organizational_description: IsoOrganizationalDescription;
  methodology: IsoMethodologyStatement;
  categories: IsoEmissionCategory[];
  total_co2e_t: number;
  specific_co2_kg_per_t: number;
  uncertainty: IsoUncertaintyAssessment;
}

// ---------------------------------------------------------------------------
// ISO 14046:2014 Water Footprint Report Structure
// ---------------------------------------------------------------------------
export type WaterStressLevel = "Extremely High" | "High" | "Medium-High" | "Low-Medium" | "Low";

export interface IsoWaterFlowCategory {
  /** ISO 14046 flow type */
  flow_type: "Withdrawal" | "Consumption" | "Discharge" | "Recycled" | "Special";
  label: string;
  description: string;
  volume_m3: number;
  sources: Array<{
    name: string;
    volume_m3: number;
    characterisation_factor?: string;
    cf_value?: number;
    cf_unit?: string;
  }>;
  has_data: boolean;
  data_quality: DataQuality;
}

export interface IsoWaterOrganizationalDescription {
  reporting_period: string;
  organizational_boundaries: string;
  facility_description: string;
  river_basin: string;
  water_stress_level: WaterStressLevel;
  water_stress_source: string;
}

export interface IsoWaterMethodologyStatement {
  quantification_basis: string;
  characterisation_method: string;
  standards_reference: string;
  gcca_reference: string;
}

export interface IsoWaterReport {
  title: string;
  generated_at: string;
  audit_hash: string;
  organizational_description: IsoWaterOrganizationalDescription;
  methodology: IsoWaterMethodologyStatement;
  flow_categories: IsoWaterFlowCategory[];
  /** KPI 1: Net consumption m³/yr */
  total_consumption_m3: number;
  /** KPI 2: Intensity L/t cementitious */
  water_intensity_l_per_t: number;
  freshwater_consumption_m3: number;
  uncertainty: IsoUncertaintyAssessment;
}

