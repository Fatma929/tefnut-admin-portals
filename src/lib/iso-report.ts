/**
 * ISO 14064-1:2018 Report Builder
 *
 * Maps CarbonResult engine output to the ISO 14064-1 Clause 9.3 report structure.
 * The six GHG categories follow the standard's classification:
 *   Cat 1 — Direct GHG emissions (Scope 1: calcination + fuel combustion)
 *   Cat 2 — Indirect from imported energy (Scope 2: purchased electricity)
 *   Cat 3 — Indirect from transportation (Scope 3: logistics)
 *   Cat 4 — Indirect from products used by the org (raw materials — placeholder)
 *   Cat 5 — Indirect from use of org's products (downstream — placeholder)
 *   Cat 6 — Indirect from other sources (placeholder)
 */
import type {
  CarbonResult,
  DataQuality,
  IsoEmissionCategory,
  IsoReport,
} from "./engine-types";

// GCCA default emission factors (kg CO₂/GJ) — Table 4, GCCA Protocol v3.1
const GCCA_EF_NOTES: Record<string, { ef: number; unit: string }> = {
  calcination: { ef: 525.0, unit: "kg CO₂/t clinker" },
  coal_anthracite: { ef: 96.0, unit: "kg CO₂/GJ" },
  petrol_coke: { ef: 92.8, unit: "kg CO₂/GJ" },
  natural_gas: { ef: 56.1, unit: "kg CO₂/GJ" },
  heavy_fuel_oil: { ef: 77.4, unit: "kg CO₂/GJ" },
  electricity_grid: { ef: 0.4, unit: "kg CO₂/kWh (grid average)" },
  transport_road: { ef: 0.062, unit: "kg CO₂/tonne·km" },
};

function deriveDataQuality(warnings: { error_code: string }[]): DataQuality {
  const codes = new Set(warnings.map((w) => w.error_code));
  if (codes.has("CRITICAL_DATA_ERROR") || codes.has("MISSING_COLUMN")) return "Low";
  if (codes.has("INCONSISTENT_FUEL_DATA") || codes.has("INCONSISTENT_PROCESS_DATA")) return "Medium";
  if (codes.has("UNIT_MISMATCH_SUSPECTED") || codes.has("OUT_OF_INDUSTRY_RANGE")) return "Medium";
  return "High";
}

export function buildIsoReport(
  result: CarbonResult,
  opts?: {
    facilityName?: string;
    reportingPeriod?: string;
    organizationalBoundaries?: string;
  },
): IsoReport {
  const warnings = result.validation_warnings ?? [];
  const quality = deriveDataQuality(warnings);

  // ── Pull scope values from engine result (full engine) or steps_breakdown (lite) ──
  const scope1 = result.scope1;
  const scope2 = result.scope2;
  const scope3 = result.scope3;

  // Fallback: derive from steps_breakdown when full scope objects are absent
  const calcinationStep = result.steps_breakdown.find((s) => s.step_id === "calcination_co2");
  const fuelStep = result.steps_breakdown.find((s) => s.step_id === "fuel_co2");
  const electricityStep = result.steps_breakdown.find((s) => s.step_id === "electricity_co2");

  const calcination_co2_t = scope1?.calcination_co2_t ?? calcinationStep?.output_value ?? 0;
  const fuel_co2_t = scope1?.fuel_combustion_co2_t ?? fuelStep?.output_value ?? 0;
  const electricity_co2_t = scope2?.electricity_co2_t ?? electricityStep?.output_value ?? 0;
  const transport_co2_t = scope3?.transport_co2_t ?? 0;
  const total_scope1 = scope1?.total_scope1_co2_t ?? (calcination_co2_t + fuel_co2_t);

  // ── Category 1: Direct GHG (Scope 1) ──
  const cat1: IsoEmissionCategory = {
    category: 1,
    label: "Direct GHG Emissions",
    description: "Emissions from sources owned or controlled by the organization (Scope 1). Includes process calcination and on-site fuel combustion.",
    co2e_t: total_scope1,
    has_data: total_scope1 > 0,
    data_quality: quality,
    sources: [
      {
        name: "Calcination of raw materials (CaCO₃ → CaO + CO₂)",
        co2e_t: calcination_co2_t,
        emission_factor: "GCCA Method B1 / A1",
        ef_value: GCCA_EF_NOTES.calcination.ef,
        ef_unit: GCCA_EF_NOTES.calcination.unit,
      },
      {
        name: "Fuel combustion in kilns and auxiliary equipment",
        co2e_t: fuel_co2_t,
        emission_factor: "GCCA Table 4 default EFs",
        ef_value: GCCA_EF_NOTES.coal_anthracite.ef,
        ef_unit: GCCA_EF_NOTES.coal_anthracite.unit,
      },
    ],
  };

  // ── Category 2: Indirect from imported energy (Scope 2) ──
  const cat2: IsoEmissionCategory = {
    category: 2,
    label: "Indirect GHG Emissions from Imported Energy",
    description: "Emissions from the generation of imported electricity, heat, or steam consumed by the organization.",
    co2e_t: electricity_co2_t,
    has_data: electricity_co2_t > 0,
    data_quality: quality,
    sources: [
      {
        name: "Purchased electricity from national grid",
        co2e_t: electricity_co2_t,
        emission_factor: "National grid emission factor",
        ef_value: GCCA_EF_NOTES.electricity_grid.ef,
        ef_unit: GCCA_EF_NOTES.electricity_grid.unit,
      },
    ],
  };

  // ── Category 3: Indirect from transportation ──
  const cat3: IsoEmissionCategory = {
    category: 3,
    label: "Indirect GHG Emissions from Transportation",
    description: "Emissions from transportation of goods, materials, or people in vehicles not owned or controlled by the organization.",
    co2e_t: transport_co2_t,
    has_data: transport_co2_t > 0,
    data_quality: transport_co2_t > 0 ? quality : "Low",
    sources: [
      {
        name: "Inbound raw material logistics (road/rail)",
        co2e_t: transport_co2_t,
        emission_factor: "IPCC Tier 1 road transport",
        ef_value: GCCA_EF_NOTES.transport_road.ef,
        ef_unit: GCCA_EF_NOTES.transport_road.unit,
      },
    ],
  };

  // ── Category 4: Indirect from products used by the org ──
  const cat4: IsoEmissionCategory = {
    category: 4,
    label: "Indirect GHG Emissions from Products Used by the Organization",
    description: "Emissions embodied in raw materials, consumables, and services purchased by the organization (e.g., limestone, gypsum, additives).",
    co2e_t: 0,
    has_data: false,
    data_quality: "Low",
    sources: [
      {
        name: "Embodied emissions in purchased raw materials",
        co2e_t: 0,
        emission_factor: "Pending — supplier data required",
      },
    ],
  };

  // ── Category 5: Indirect from use of org's products ──
  const cat5: IsoEmissionCategory = {
    category: 5,
    label: "Indirect GHG Emissions from Use of Organization's Products",
    description: "Emissions arising from the use of cement and clinker products by customers (e.g., concrete carbonation over lifetime).",
    co2e_t: 0,
    has_data: false,
    data_quality: "Low",
    sources: [
      {
        name: "Downstream use-phase emissions (concrete carbonation)",
        co2e_t: 0,
        emission_factor: "Pending — lifecycle assessment required",
      },
    ],
  };

  // ── Category 6: Indirect from other sources ──
  const cat6: IsoEmissionCategory = {
    category: 6,
    label: "Indirect GHG Emissions from Other Sources",
    description: "All other indirect GHG emissions not covered in Categories 2–5, including waste disposal, employee commuting, and capital goods.",
    co2e_t: 0,
    has_data: false,
    data_quality: "Low",
    sources: [
      {
        name: "Waste disposal and employee commuting",
        co2e_t: 0,
        emission_factor: "Pending — activity data required",
      },
    ],
  };

  const facilityName = opts?.facilityName ?? result.plant_name ?? "Cement Plant";
  const year = result.reporting_year ?? new Date().getFullYear();
  const period = opts?.reportingPeriod ?? `1 January ${year} – 31 December ${year}`;

  return {
    title: `GHG Inventory Report — ${facilityName} — ${year}`,
    generated_at: new Date().toISOString(),
    audit_hash: result.audit_trail.source_reference.input_hash,
    organizational_description: {
      reporting_period: period,
      organizational_boundaries: opts?.organizationalBoundaries ?? "Operational control — all processes within the facility boundary",
      facility_description: `${facilityName} — integrated cement manufacturing facility`,
      consolidation_approach: "Operational control (ISO 14064-1:2018 §5.2)",
    },
    methodology: {
      quantification_basis:
        "Quantification is based on the GCCA Cement CO₂ and Energy Protocol (v3.1), consistent with ISO 14064-1:2018 requirements for cement manufacturing.",
      gwp_source: "IPCC Sixth Assessment Report (AR6), 2021",
      gwp_ar: "AR6",
      standards_reference: "ISO 14064-1:2018 — Clause 9.3 (Report Content)",
    },
    categories: [cat1, cat2, cat3, cat4, cat5, cat6],
    total_co2e_t: result.total_co2_t,
    specific_co2_kg_per_t: result.specific_co2_kg_per_t_cement,
    uncertainty: {
      overall_quality: quality,
      notes:
        quality === "High"
          ? "All input data passed validation checks. No anomalies detected."
          : quality === "Medium"
          ? "One or more validation warnings were raised. Review flagged fields before submission."
          : "Critical validation errors or missing data detected. Report should not be submitted until resolved.",
      validation_flags: warnings.map((w) => `${w.error_code}: ${w.field}`),
    },
  };
}

/** Serialise an IsoReport to a downloadable JSON blob URL */
export function isoReportToJsonUrl(report: IsoReport): string {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  return URL.createObjectURL(blob);
}
