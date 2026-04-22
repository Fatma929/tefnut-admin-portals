/**
 * Tefnut Persistence Layer
 *
 * Server-side functions that save engine results into D1 after calculation.
 * Called from TanStack Start API routes — never imported by client code.
 *
 * Flow:
 *   1. Engine calculates → returns CarbonResult | WaterResult
 *   2. persistCarbonResult() / persistWaterResult() maps engine output → DB rows
 *   3. persistGeneratedReport() archives the full ISO report JSON with its hash
 */
import type { CarbonResult, WaterResult } from "./engine-types";
import type { IsoReport } from "./engine-types";
import type { IsoWaterReport } from "./engine-types";
import type { DataQualityScore, NewCarbonRecord, NewGeneratedReport, NewWaterRecord } from "../../db/schema";
import {
  checkDuplicate,
  insertCarbonRecord,
  insertGeneratedReport,
  insertUploadedFile,
  insertValidationLog,
  insertWaterRecord,
  registerHash,
} from "../../db/queries";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveQuality(warnings: { error_code: string }[]): DataQualityScore {
  const codes = new Set(warnings.map((w) => w.error_code));
  if (codes.has("CRITICAL_DATA_ERROR") || codes.has("MISSING_COLUMN")) return "Low";
  if (codes.has("INCONSISTENT_FUEL_DATA") || codes.has("UNIT_MISMATCH_SUSPECTED")) return "Medium";
  return "High";
}

function periodBounds(year: number) {
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

/** SHA-256 of a JSON-serialisable value — runs in the Workers runtime */
async function hashJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// ISO 14064-1 category labels
// ---------------------------------------------------------------------------
const ISO_CATEGORY_LABELS: Record<number, string> = {
  1: "Direct GHG Emissions",
  2: "Indirect GHG Emissions from Imported Energy",
  3: "Indirect GHG Emissions from Transportation",
  4: "Indirect GHG Emissions from Products Used by the Organization",
  5: "Indirect GHG Emissions from Use of Organization's Products",
  6: "Indirect GHG Emissions from Other Sources",
};

// ---------------------------------------------------------------------------
// 1. Persist Carbon Result → carbon_inventory (one row per ISO category source)
// ---------------------------------------------------------------------------
export interface PersistCarbonOptions {
  db: D1Database;
  result: CarbonResult;
  facilityId: string;
  userId: string;
  uploadedFileId?: string;
  /** Defaults to current year */
  reportingYear?: number;
}

export async function persistCarbonResult(opts: PersistCarbonOptions): Promise<{
  recordIds: string[];
  isDuplicate: boolean;
  firstSeenAt?: string;
}> {
  const { db, result, facilityId, userId, uploadedFileId } = opts;
  const year = opts.reportingYear ?? new Date().getFullYear();
  const { start, end } = periodBounds(year);
  const inputHash = result.audit_trail.source_reference.input_hash;
  const quality = deriveQuality(result.validation_warnings ?? []);

  // Check for duplicate
  const existing = await checkDuplicate(db, inputHash, "carbon");
  if (existing) {
    return { recordIds: [], isDuplicate: true, firstSeenAt: existing.first_seen_at };
  }

  const recordIds: string[] = [];
  const scope1 = result.scope1;
  const scope2 = result.scope2;
  const scope3 = result.scope3;

  // Derive values from steps_breakdown when full scope objects are absent
  const calcinationStep = result.steps_breakdown.find((s) => s.step_id === "calcination_co2");
  const fuelStep = result.steps_breakdown.find((s) => s.step_id === "fuel_co2");
  const electricityStep = result.steps_breakdown.find((s) => s.step_id === "electricity_co2");

  const calcination_co2 = scope1?.calcination_co2_t ?? calcinationStep?.output_value ?? 0;
  const fuel_co2 = scope1?.fuel_combustion_co2_t ?? fuelStep?.output_value ?? 0;
  const electricity_co2 = scope2?.electricity_co2_t ?? electricityStep?.output_value ?? 0;
  const transport_co2 = scope3?.transport_co2_t ?? 0;

  const baseRecord: Omit<NewCarbonRecord, "iso_category" | "iso_category_label" | "source_name" | "source_type" | "co2e_t" | "emission_factor_value" | "emission_factor_unit" | "emission_factor_source"> = {
    facility_id: facilityId,
    uploaded_file_id: uploadedFileId ?? null,
    reporting_year: year,
    reporting_period_start: start,
    reporting_period_end: end,
    co2_t: 0,
    ch4_t: 0,
    n2o_t: 0,
    biomass_co2_memo_t: scope1?.biomass_co2_memo_t ?? 0,
    gwp_reference: "IPCC AR6",
    gwp_co2: 1.0,
    gwp_ch4: 27.9,
    gwp_n2o: 273.0,
    data_quality_score: quality,
    data_quality_notes: null,
    input_sha256_hash: inputHash,
    calculated_by: userId,
    methodology_tag: `${result.methodology.protocol_name} v${result.methodology.protocol_version}`,
  };

  // Category 1a — Calcination (direct process emissions)
  if (calcination_co2 > 0) {
    const id = await insertCarbonRecord(db, {
      ...baseRecord,
      iso_category: 1,
      iso_category_label: ISO_CATEGORY_LABELS[1],
      source_name: "Calcination of raw materials (CaCO₃ → CaO + CO₂)",
      source_type: "calcination",
      co2e_t: calcination_co2,
      co2_t: calcination_co2,
      emission_factor_value: 525.0,
      emission_factor_unit: "kg CO₂/t clinker",
      emission_factor_source: "GCCA Table 4 — Method B1/A1",
    });
    recordIds.push(id);
  }

  // Category 1b — Fuel combustion (direct)
  if (fuel_co2 > 0) {
    const id = await insertCarbonRecord(db, {
      ...baseRecord,
      iso_category: 1,
      iso_category_label: ISO_CATEGORY_LABELS[1],
      source_name: "Fuel combustion in kilns and auxiliary equipment",
      source_type: "fuel_combustion_kiln",
      co2e_t: fuel_co2,
      co2_t: fuel_co2,
      emission_factor_value: 96.0,
      emission_factor_unit: "kg CO₂/GJ",
      emission_factor_source: "GCCA Table 4 — default EFs",
    });
    recordIds.push(id);
  }

  // Category 2 — Purchased electricity (indirect)
  if (electricity_co2 > 0) {
    const id = await insertCarbonRecord(db, {
      ...baseRecord,
      iso_category: 2,
      iso_category_label: ISO_CATEGORY_LABELS[2],
      source_name: "Purchased electricity from national grid",
      source_type: "purchased_electricity",
      co2e_t: electricity_co2,
      co2_t: electricity_co2,
      emission_factor_value: 0.4,
      emission_factor_unit: "kg CO₂/kWh",
      emission_factor_source: "National grid average",
    });
    recordIds.push(id);
  }

  // Category 3 — Transport (indirect)
  if (transport_co2 > 0) {
    const id = await insertCarbonRecord(db, {
      ...baseRecord,
      iso_category: 3,
      iso_category_label: ISO_CATEGORY_LABELS[3],
      source_name: "Inbound raw material logistics",
      source_type: "transport_inbound",
      co2e_t: transport_co2,
      co2_t: transport_co2,
      emission_factor_value: 0.062,
      emission_factor_unit: "kg CO₂/tonne·km",
      emission_factor_source: "IPCC Tier 1 road transport",
    });
    recordIds.push(id);
  }

  // Register hash to prevent future duplicates
  if (recordIds.length > 0) {
    await registerHash(db, {
      input_sha256_hash: inputHash,
      engine_type: "carbon",
      facility_id: facilityId,
      first_seen_by: userId,
      record_id: recordIds[0],
    });
  }

  // Persist validation log
  if (uploadedFileId) {
    await insertValidationLog(db, {
      uploaded_file_id: uploadedFileId,
      engine_type: "carbon",
      is_blocked: 0,
      errors_json: "[]",
      warnings_json: JSON.stringify(result.validation_warnings ?? []),
      overall_quality: quality,
    });
  }

  return { recordIds, isDuplicate: false };
}

// ---------------------------------------------------------------------------
// 2. Persist Water Result → water_inventory (one row per flow type)
// ---------------------------------------------------------------------------
export interface PersistWaterOptions {
  db: D1Database;
  result: WaterResult;
  facilityId: string;
  userId: string;
  uploadedFileId?: string;
  reportingYear?: number;
}

export async function persistWaterResult(opts: PersistWaterOptions): Promise<{
  recordIds: string[];
  isDuplicate: boolean;
  firstSeenAt?: string;
}> {
  const { db, result, facilityId, userId, uploadedFileId } = opts;
  const year = opts.reportingYear ?? new Date().getFullYear();
  const { start, end } = periodBounds(year);
  const inputHash = result.audit_trail.source_reference.input_hash;
  const quality = deriveQuality(result.validation_warnings ?? []);

  const existing = await checkDuplicate(db, inputHash, "water");
  if (existing) {
    return { recordIds: [], isDuplicate: true, firstSeenAt: existing.first_seen_at };
  }

  const recordIds: string[] = [];

  const baseRecord: Omit<NewWaterRecord, "flow_type" | "source_name" | "volume_m3"> = {
    facility_id: facilityId,
    uploaded_file_id: uploadedFileId ?? null,
    reporting_year: year,
    reporting_period_start: start,
    reporting_period_end: end,
    flow_subtype: null,
    water_source: null,
    discharge_destination: null,
    kpi_1_consumption_m3: result.total_water_consumption_m3,
    kpi_2_intensity_l_per_t: result.water_consumption_per_tonne_litres,
    freshwater_consumption_m3: result.total_freshwater_consumption_m3,
    water_stress_index: null,
    characterisation_factor: 1.0,
    characterisation_method: "WBCSD Global Water Tool",
    quality_parameters: null,
    data_quality_score: quality,
    data_quality_notes: null,
    input_sha256_hash: inputHash,
    calculated_by: userId,
    methodology_tag: `${result.methodology.protocol_name} v${result.methodology.protocol_version}`,
  };

  // Withdrawal
  const wId = await insertWaterRecord(db, {
    ...baseRecord,
    flow_type: "withdrawal",
    source_name: "Total water withdrawal — all sources",
    volume_m3: result.total_water_withdrawal_m3,
  });
  recordIds.push(wId);

  // Consumption (KPI 1)
  const cId = await insertWaterRecord(db, {
    ...baseRecord,
    flow_type: "consumption",
    source_name: "Net water consumption (KPI 1)",
    volume_m3: result.total_water_consumption_m3,
  });
  recordIds.push(cId);

  // Discharge
  const dId = await insertWaterRecord(db, {
    ...baseRecord,
    flow_type: "discharge",
    source_name: "Total water discharge — all destinations",
    volume_m3: result.total_water_discharge_m3,
  });
  recordIds.push(dId);

  // Recycled (memo item)
  if (result.recycled_water_m3 > 0) {
    const rId = await insertWaterRecord(db, {
      ...baseRecord,
      flow_type: "recycled",
      source_name: "Recycled / recirculated water",
      volume_m3: result.recycled_water_m3,
    });
    recordIds.push(rId);
  }

  // Special — harvested rainwater
  if (result.harvested_rainwater_withdrawal_m3 > 0) {
    const sId = await insertWaterRecord(db, {
      ...baseRecord,
      flow_type: "special",
      flow_subtype: "harvested_rainwater",
      source_name: "Harvested rainwater withdrawal",
      volume_m3: result.harvested_rainwater_withdrawal_m3,
    });
    recordIds.push(sId);
  }

  await registerHash(db, {
    input_sha256_hash: inputHash,
    engine_type: "water",
    facility_id: facilityId,
    first_seen_by: userId,
    record_id: recordIds[0],
  });

  if (uploadedFileId) {
    await insertValidationLog(db, {
      uploaded_file_id: uploadedFileId,
      engine_type: "water",
      is_blocked: 0,
      errors_json: "[]",
      warnings_json: JSON.stringify(result.validation_warnings ?? []),
      overall_quality: quality,
    });
  }

  return { recordIds, isDuplicate: false };
}

// ---------------------------------------------------------------------------
// 3. Persist Generated Report → generated_reports (immutable audit trail)
// ---------------------------------------------------------------------------
export interface PersistReportOptions {
  db: D1Database;
  report: IsoReport | IsoWaterReport;
  reportType: NewGeneratedReport["report_type"];
  facilityId: string;
  userId: string;
  carbonRecordIds?: string[];
  waterRecordIds?: string[];
  reportingYear?: number;
}

export async function persistGeneratedReport(opts: PersistReportOptions): Promise<{
  reportId: string;
  sha256Hash: string;
  isDuplicate: boolean;
}> {
  const { db, report, reportType, facilityId, userId } = opts;
  const year = opts.reportingYear ?? new Date().getFullYear();
  const { start, end } = periodBounds(year);

  const reportJson = JSON.stringify(report);
  const sha256Hash = await hashJson(report);

  // Check if this exact report was already archived
  const existing = await db
    .prepare("SELECT id FROM generated_reports WHERE sha256_hash = ?")
    .bind(sha256Hash)
    .first<{ id: string }>();

  if (existing) {
    return { reportId: existing.id, sha256Hash, isDuplicate: true };
  }

  const reportId = await insertGeneratedReport(db, {
    facility_id: facilityId,
    generated_by: userId,
    report_type: reportType,
    reporting_year: year,
    reporting_period_start: start,
    reporting_period_end: end,
    title: report.title,
    sha256_hash: sha256Hash,
    report_json: reportJson,
    storage_key: null,
    standards_cited: JSON.stringify(
      reportType === "iso_14064_ghg_inventory"
        ? ["iso-14064", "gcca-carbon", "ipcc-ar6"]
        : ["iso-14046", "gcca-water"],
    ),
    status: "draft",
    submitted_at: null,
    submission_ref: null,
    carbon_record_ids: JSON.stringify(opts.carbonRecordIds ?? []),
    water_record_ids: JSON.stringify(opts.waterRecordIds ?? []),
  });

  return { reportId, sha256Hash, isDuplicate: false };
}

// ---------------------------------------------------------------------------
// 4. Register uploaded file in D1 (called before engine calculation)
// ---------------------------------------------------------------------------
export interface RegisterFileOptions {
  db: D1Database;
  file: File;
  fileHash: string;
  facilityId: string;
  userId: string;
  engineType: "carbon" | "water";
  reportingYear?: number;
  storageKey?: string;
}

export async function registerUploadedFile(opts: RegisterFileOptions): Promise<string> {
  return insertUploadedFile(opts.db, {
    facility_id: opts.facilityId,
    uploaded_by: opts.userId,
    original_name: opts.file.name,
    storage_key: opts.storageKey ?? `uploads/${opts.engineType}/${opts.fileHash}/${opts.file.name}`,
    mime_type: opts.file.type || "application/octet-stream",
    size_bytes: opts.file.size,
    sha256_hash: opts.fileHash,
    upload_timestamp: new Date().toISOString(),
    reporting_year: opts.reportingYear ?? new Date().getFullYear(),
    engine_type: opts.engineType,
  });
}
