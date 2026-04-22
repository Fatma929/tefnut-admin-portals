/**
 * ISO 14046:2014 Water Footprint Report Builder
 *
 * Maps WaterResult engine output to the ISO 14046 report structure.
 * ISO 14046 organises water flows into:
 *   Withdrawal  — water taken from any source
 *   Consumption — net water not returned (Withdrawal − Discharge)
 *   Discharge   — water returned to the environment
 *   Recycled    — water reused within the facility boundary
 *   Special     — harvested rainwater, storm water, quarry water
 *
 * References:
 *   ISO 14046:2014 — Water footprint — Principles, requirements and guidelines
 *   GCCA Water Management Guidelines for the Cement Industry (2021)
 *   WBCSD Global Water Tool — characterisation factors
 */
import type {
  DataQuality,
  IsoWaterFlowCategory,
  IsoWaterReport,
  WaterResult,
  WaterStressLevel,
} from "./engine-types";

function deriveDataQuality(warnings: { error_code: string }[]): DataQuality {
  const codes = new Set(warnings.map((w) => w.error_code));
  if (codes.has("MISSING_COLUMN") || codes.has("NEGATIVE_VALUE_ERROR")) return "Low";
  if (codes.has("NEGATIVE_CONSUMPTION_ERROR") || codes.has("INCONSISTENT_PROCESS_DATA")) return "Medium";
  if (codes.has("UNIT_MISMATCH_SUSPECTED")) return "Medium";
  return "High";
}

export interface IsoWaterReportOptions {
  facilityName?: string;
  reportingPeriod?: string;
  organizationalBoundaries?: string;
  riverBasin?: string;
  waterStressLevel?: WaterStressLevel;
  waterStressSource?: string;
}

export function buildIsoWaterReport(
  result: WaterResult,
  opts?: IsoWaterReportOptions,
): IsoWaterReport {
  const warnings = result.validation_warnings ?? [];
  const quality = deriveDataQuality(warnings);

  // ── Derive values from engine result ──
  const withdrawal = result.total_water_withdrawal_m3;
  const discharge = result.total_water_discharge_m3;
  const consumption = result.total_water_consumption_m3;
  const freshwater = result.total_freshwater_consumption_m3;
  const recycled = result.recycled_water_m3;
  const rainwater = result.harvested_rainwater_withdrawal_m3;
  const quarryUnused = result.quarry_water_not_used_m3;
  const stormwater = result.storm_water_collected_discharged_m3;

  // Derive withdrawal breakdown from steps_breakdown when available
  const withdrawalStep = result.steps_breakdown.find((s) => s.step_id === "total_withdrawal");
  const dischargeStep = result.steps_breakdown.find((s) => s.step_id === "total_discharge");

  const withdrawalSources = withdrawalStep
    ? Object.entries(withdrawalStep.inputs).map(([key, val]) => ({
        name: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        volume_m3: val.value,
        characterisation_factor: "WBCSD Water Scarcity Factor",
        cf_value: 1.0,
        cf_unit: "m³ world-eq / m³",
      }))
    : [
        { name: "Surface water", volume_m3: 0, characterisation_factor: "WBCSD", cf_value: 1.0, cf_unit: "m³ world-eq / m³" },
        { name: "Groundwater", volume_m3: 0, characterisation_factor: "WBCSD", cf_value: 1.0, cf_unit: "m³ world-eq / m³" },
        { name: "Municipal potable water", volume_m3: 0, characterisation_factor: "WBCSD", cf_value: 1.0, cf_unit: "m³ world-eq / m³" },
      ];

  const dischargeSources = dischargeStep
    ? Object.entries(dischargeStep.inputs).map(([key, val]) => ({
        name: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        volume_m3: val.value,
        characterisation_factor: "ISO 14046 §6.4.3",
        cf_value: 1.0,
        cf_unit: "m³ / m³",
      }))
    : [{ name: "Total discharge to environment", volume_m3: discharge }];

  // ── Flow Category: Withdrawal ──
  const flowWithdrawal: IsoWaterFlowCategory = {
    flow_type: "Withdrawal",
    label: "Total Water Withdrawal",
    description:
      "All water taken from surface water, groundwater, municipal supply, or other sources within the facility boundary. Corresponds to GCCA KPI — Total Withdrawal.",
    volume_m3: withdrawal,
    has_data: withdrawal > 0,
    data_quality: quality,
    sources: withdrawalSources,
  };

  // ── Flow Category: Consumption (KPI 1) ──
  const flowConsumption: IsoWaterFlowCategory = {
    flow_type: "Consumption",
    label: "Net Water Consumption (KPI 1)",
    description:
      "Water consumed and not returned to the source watershed. Calculated as Total Withdrawal − Total Discharge. This is the primary ISO 14046 water footprint indicator.",
    volume_m3: consumption,
    has_data: consumption >= 0,
    data_quality: quality,
    sources: [
      {
        name: "Net consumption (Withdrawal − Discharge)",
        volume_m3: consumption,
        characterisation_factor: "ISO 14046 §6.4.2 — Freshwater consumption",
        cf_value: 1.0,
        cf_unit: "m³ world-eq / m³",
      },
      {
        name: "Freshwater consumption (excl. harvested rainwater)",
        volume_m3: freshwater,
        characterisation_factor: "ISO 14046 §6.4.2",
        cf_value: 1.0,
        cf_unit: "m³ world-eq / m³",
      },
    ],
  };

  // ── Flow Category: Discharge ──
  const flowDischarge: IsoWaterFlowCategory = {
    flow_type: "Discharge",
    label: "Total Water Discharge",
    description:
      "Water returned to the environment via surface water bodies, subsurface injection, offsite treatment, or beneficial reuse by third parties.",
    volume_m3: discharge,
    has_data: discharge > 0,
    data_quality: quality,
    sources: dischargeSources,
  };

  // ── Flow Category: Recycled ──
  const flowRecycled: IsoWaterFlowCategory = {
    flow_type: "Recycled",
    label: "Recycled & Recirculated Water",
    description:
      "Water reused within the facility boundary before discharge. Reduces net withdrawal demand. Reported as a memo item per GCCA Water Management Guidelines §4.3.",
    volume_m3: recycled,
    has_data: recycled > 0,
    data_quality: recycled > 0 ? quality : "Low",
    sources: [
      {
        name: "Process water recirculation",
        volume_m3: recycled,
        characterisation_factor: "GCCA Water Guidelines §4.3 — Recycled water memo",
      },
    ],
  };

  // ── Flow Category: Special ──
  const specialTotal = rainwater + quarryUnused + stormwater;
  const flowSpecial: IsoWaterFlowCategory = {
    flow_type: "Special",
    label: "Special Category Water Flows",
    description:
      "Water flows reported separately per GCCA guidelines: harvested rainwater, quarry water not used in process, and storm water collected and discharged.",
    volume_m3: specialTotal,
    has_data: specialTotal > 0,
    data_quality: specialTotal > 0 ? quality : "Low",
    sources: [
      {
        name: "Harvested rainwater withdrawal",
        volume_m3: rainwater,
        characterisation_factor: "GCCA Water Guidelines §4.4 — Rainwater",
      },
      {
        name: "Quarry water not used in process",
        volume_m3: quarryUnused,
        characterisation_factor: "GCCA Water Guidelines §4.5 — Quarry water",
      },
      {
        name: "Storm water collected and discharged",
        volume_m3: stormwater,
        characterisation_factor: "GCCA Water Guidelines §4.6 — Storm water",
      },
    ],
  };

  const facilityName = opts?.facilityName ?? "Cement Plant";
  const year = new Date(
    result.audit_trail.source_reference.upload_timestamp_utc,
  ).getFullYear() || new Date().getFullYear();
  const period = opts?.reportingPeriod ?? `1 January ${year} – 31 December ${year}`;

  return {
    title: `Water Footprint Report — ${facilityName} — ${year}`,
    generated_at: new Date().toISOString(),
    audit_hash: result.audit_trail.source_reference.input_hash,
    organizational_description: {
      reporting_period: period,
      organizational_boundaries:
        opts?.organizationalBoundaries ??
        "Operational control — all water-consuming processes within the facility boundary",
      facility_description: `${facilityName} — integrated cement manufacturing facility`,
      river_basin: opts?.riverBasin ?? "Nile Basin — Lower Egypt (HydroSHEDS Level 6)",
      water_stress_level: opts?.waterStressLevel ?? "High",
      water_stress_source:
        opts?.waterStressSource ??
        "WRI Aqueduct Water Risk Atlas (2023) — Baseline Water Stress indicator",
    },
    methodology: {
      quantification_basis:
        "Quantification is based on the GCCA Water Management Guidelines for the Cement Industry (2021), consistent with ISO 14046:2014 principles and requirements for water footprint assessment.",
      characterisation_method:
        "Freshwater consumption characterised using WBCSD Global Water Tool scarcity factors. Discharge quality assessment follows ISO 14046 §6.4.3.",
      standards_reference: "ISO 14046:2014 — Water footprint — Principles, requirements and guidelines",
      gcca_reference: "GCCA Water Management Guidelines for the Cement Industry, 2021 Edition",
    },
    flow_categories: [flowWithdrawal, flowConsumption, flowDischarge, flowRecycled, flowSpecial],
    total_consumption_m3: consumption,
    water_intensity_l_per_t: result.water_consumption_per_tonne_litres,
    freshwater_consumption_m3: freshwater,
    uncertainty: {
      overall_quality: quality,
      notes:
        quality === "High"
          ? "All water flow data passed validation checks. No anomalies detected."
          : quality === "Medium"
          ? "One or more validation warnings were raised. Review flagged fields before submission."
          : "Critical validation errors or missing data detected. Report should not be submitted until resolved.",
      validation_flags: warnings.map((w) => `${w.error_code}: ${w.field}`),
    },
  };
}

/** Serialise an IsoWaterReport to a downloadable JSON blob URL */
export function isoWaterReportToJsonUrl(report: IsoWaterReport): string {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  return URL.createObjectURL(blob);
}
