/**
 * Tefnut D1 Query Helpers
 *
 * Thin wrappers around Cloudflare D1's prepared statement API.
 * Import `db` from the Cloudflare Workers env binding.
 *
 * Usage in a TanStack Start server function:
 *   import { getCloudflareContext } from "@cloudflare/vite-plugin/worker";
 *   const { env } = getCloudflareContext();
 *   const records = await getCarbonRecords(env.DB, facilityId, 2026);
 */
import type {
  CarbonInventoryRecord,
  GeneratedReport,
  InputHashRegistry,
  NewCarbonRecord,
  NewGeneratedReport,
  NewUploadedFile,
  NewWaterRecord,
  UploadedFile,
  ValidationLogEntry,
  WaterInventoryRecord,
} from "./schema";

// D1Database type — available in the Cloudflare Workers runtime
type D1 = D1Database;

// ---------------------------------------------------------------------------
// Uploaded Files
// ---------------------------------------------------------------------------
export async function insertUploadedFile(db: D1, file: NewUploadedFile): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await db
    .prepare(
      `INSERT INTO uploaded_files
         (id, facility_id, uploaded_by, original_name, storage_key, mime_type,
          size_bytes, sha256_hash, upload_timestamp, reporting_year, engine_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, file.facility_id, file.uploaded_by, file.original_name,
      file.storage_key, file.mime_type, file.size_bytes, file.sha256_hash,
      file.upload_timestamp, file.reporting_year, file.engine_type,
    )
    .run();
  return id;
}

export async function getUploadedFile(db: D1, id: string): Promise<UploadedFile | null> {
  return db.prepare("SELECT * FROM uploaded_files WHERE id = ?").bind(id).first<UploadedFile>();
}

// ---------------------------------------------------------------------------
// Duplicate Detection Registry
// ---------------------------------------------------------------------------
export async function checkDuplicate(
  db: D1,
  hash: string,
  engineType: "carbon" | "water",
): Promise<InputHashRegistry | null> {
  return db
    .prepare("SELECT * FROM input_hash_registry WHERE input_sha256_hash = ? AND engine_type = ?")
    .bind(hash, engineType)
    .first<InputHashRegistry>();
}

export async function registerHash(
  db: D1,
  entry: Omit<InputHashRegistry, "first_seen_at">,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO input_hash_registry
         (input_sha256_hash, engine_type, facility_id, first_seen_by, record_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.input_sha256_hash, entry.engine_type,
      entry.facility_id, entry.first_seen_by, entry.record_id,
    )
    .run();
}

// ---------------------------------------------------------------------------
// Carbon Inventory
// ---------------------------------------------------------------------------
export async function insertCarbonRecord(db: D1, record: NewCarbonRecord): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await db
    .prepare(
      `INSERT INTO carbon_inventory
         (id, facility_id, uploaded_file_id, reporting_year, reporting_period_start,
          reporting_period_end, iso_category, iso_category_label, source_name, source_type,
          co2e_t, co2_t, ch4_t, n2o_t, biomass_co2_memo_t,
          emission_factor_value, emission_factor_unit, emission_factor_source,
          gwp_reference, gwp_co2, gwp_ch4, gwp_n2o,
          data_quality_score, data_quality_notes,
          input_sha256_hash, calculated_by, methodology_tag)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, record.facility_id, record.uploaded_file_id ?? null,
      record.reporting_year, record.reporting_period_start, record.reporting_period_end,
      record.iso_category, record.iso_category_label, record.source_name, record.source_type,
      record.co2e_t, record.co2_t, record.ch4_t, record.n2o_t, record.biomass_co2_memo_t,
      record.emission_factor_value ?? null, record.emission_factor_unit ?? null,
      record.emission_factor_source ?? null,
      record.gwp_reference, record.gwp_co2, record.gwp_ch4, record.gwp_n2o,
      record.data_quality_score, record.data_quality_notes ?? null,
      record.input_sha256_hash, record.calculated_by, record.methodology_tag,
    )
    .run();
  return id;
}

export async function getCarbonRecords(
  db: D1,
  facilityId: string,
  year: number,
): Promise<CarbonInventoryRecord[]> {
  const result = await db
    .prepare("SELECT * FROM carbon_inventory WHERE facility_id = ? AND reporting_year = ? ORDER BY iso_category")
    .bind(facilityId, year)
    .all<CarbonInventoryRecord>();
  return result.results;
}

// ---------------------------------------------------------------------------
// Water Inventory
// ---------------------------------------------------------------------------
export async function insertWaterRecord(db: D1, record: NewWaterRecord): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await db
    .prepare(
      `INSERT INTO water_inventory
         (id, facility_id, uploaded_file_id, reporting_year, reporting_period_start,
          reporting_period_end, flow_type, flow_subtype, source_name,
          water_source, discharge_destination, volume_m3,
          kpi_1_consumption_m3, kpi_2_intensity_l_per_t, freshwater_consumption_m3,
          water_stress_index, characterisation_factor, characterisation_method,
          quality_parameters, data_quality_score, data_quality_notes,
          input_sha256_hash, calculated_by, methodology_tag)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, record.facility_id, record.uploaded_file_id ?? null,
      record.reporting_year, record.reporting_period_start, record.reporting_period_end,
      record.flow_type, record.flow_subtype ?? null, record.source_name,
      record.water_source ?? null, record.discharge_destination ?? null, record.volume_m3,
      record.kpi_1_consumption_m3 ?? null, record.kpi_2_intensity_l_per_t ?? null,
      record.freshwater_consumption_m3 ?? null,
      record.water_stress_index ?? null, record.characterisation_factor,
      record.characterisation_method, record.quality_parameters ?? null,
      record.data_quality_score, record.data_quality_notes ?? null,
      record.input_sha256_hash, record.calculated_by, record.methodology_tag,
    )
    .run();
  return id;
}

export async function getWaterRecords(
  db: D1,
  facilityId: string,
  year: number,
): Promise<WaterInventoryRecord[]> {
  const result = await db
    .prepare("SELECT * FROM water_inventory WHERE facility_id = ? AND reporting_year = ? ORDER BY flow_type")
    .bind(facilityId, year)
    .all<WaterInventoryRecord>();
  return result.results;
}

// ---------------------------------------------------------------------------
// Generated Reports (immutable audit trail)
// ---------------------------------------------------------------------------
export async function insertGeneratedReport(db: D1, report: NewGeneratedReport): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await db
    .prepare(
      `INSERT INTO generated_reports
         (id, facility_id, generated_by, report_type, reporting_year,
          reporting_period_start, reporting_period_end, title,
          sha256_hash, report_json, storage_key, standards_cited,
          status, carbon_record_ids, water_record_ids)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, report.facility_id, report.generated_by, report.report_type,
      report.reporting_year, report.reporting_period_start, report.reporting_period_end,
      report.title, report.sha256_hash, report.report_json,
      report.storage_key ?? null, report.standards_cited, report.status,
      report.carbon_record_ids, report.water_record_ids,
    )
    .run();
  return id;
}

export async function getReportByHash(db: D1, hash: string): Promise<GeneratedReport | null> {
  return db
    .prepare("SELECT * FROM generated_reports WHERE sha256_hash = ?")
    .bind(hash)
    .first<GeneratedReport>();
}

export async function getReportsByFacility(
  db: D1,
  facilityId: string,
  year?: number,
): Promise<GeneratedReport[]> {
  const query = year
    ? "SELECT * FROM generated_reports WHERE facility_id = ? AND reporting_year = ? ORDER BY generated_at DESC"
    : "SELECT * FROM generated_reports WHERE facility_id = ? ORDER BY generated_at DESC";
  const stmt = year
    ? db.prepare(query).bind(facilityId, year)
    : db.prepare(query).bind(facilityId);
  const result = await stmt.all<GeneratedReport>();
  return result.results;
}

// ---------------------------------------------------------------------------
// Validation Log
// ---------------------------------------------------------------------------
export async function insertValidationLog(
  db: D1,
  entry: Omit<ValidationLogEntry, "id" | "validated_at">,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO validation_log
         (id, uploaded_file_id, engine_type, is_blocked, errors_json, warnings_json, overall_quality)
       VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.uploaded_file_id, entry.engine_type, entry.is_blocked ? 1 : 0,
      entry.errors_json, entry.warnings_json, entry.overall_quality,
    )
    .run();
}
