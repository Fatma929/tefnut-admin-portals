/**
 * Tefnut PostgreSQL Client — Tenant-Aware Connection Pool
 *
 * Every query runs inside a transaction that first sets:
 *   SET LOCAL app.current_org_id = '<orgId>';
 *
 * This activates all RLS policies. No query can touch another tenant's data.
 *
 * Usage:
 *   import { withTenant } from "@/db/pg-client";
 *
 *   // In a TanStack Start server function:
 *   const records = await withTenant(orgId, async (db) => {
 *     return db.query<CarbonInventoryRecord>(
 *       "SELECT * FROM carbon_inventory WHERE reporting_year = $1",
 *       [2026]
 *     );
 *   });
 *
 * Environment variables required:
 *   DATABASE_URL  — postgres://tefnut_app:<password>@<rds-host>:5432/tefnut
 */

import { Pool, type PoolClient, type QueryResult } from "pg";

// ---------------------------------------------------------------------------
// Connection pool — shared across all requests in the same Worker instance
// ---------------------------------------------------------------------------
let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL environment variable is not set");
    _pool = new Pool({
      connectionString: url,
      max: 10,                  // max connections per Worker instance
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: { rejectUnauthorized: true }, // RDS requires SSL
    });
    _pool.on("error", (err: Error) => {
      console.error("[pg-pool] Unexpected error on idle client:", err);
    });
  }
  return _pool;
}

// ---------------------------------------------------------------------------
// Typed query helper
// ---------------------------------------------------------------------------
export interface TenantDb {
  query<T extends object>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
  queryOne<T extends object>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null>;
  queryMany<T extends object>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
}

// ---------------------------------------------------------------------------
// Core: withTenant — sets tenant context, runs callback, releases connection
// ---------------------------------------------------------------------------
export async function withTenant<T>(
  orgId: string,
  callback: (db: TenantDb) => Promise<T>,
): Promise<T> {
  if (!orgId || orgId.trim() === "") {
    throw new Error("TENANT_CONTEXT_MISSING: orgId must be provided to withTenant()");
  }

  const pool = getPool();
  const client: PoolClient = await pool.connect();

  try {
    // Open transaction and set tenant context atomically
    await client.query("BEGIN");
    // SET LOCAL scopes the GUC to this transaction only — safe for connection pooling
    await client.query("SET LOCAL app.current_org_id = $1", [orgId]);

    const db: TenantDb = {
      async query<T extends object>(sql: string, params?: unknown[]) {
        return client.query<T>(sql, params);
      },
      async queryOne<T extends object>(sql: string, params?: unknown[]) {
        const result = await client.query<T>(sql, params);
        return (result.rows[0] ?? null) as T | null;
      },
      async queryMany<T extends object>(sql: string, params?: unknown[]) {
        const result = await client.query<T>(sql, params);
        return result.rows;
      },
    };

    const result = await callback(db);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Middleware helper — extracts orgId from request and injects into context
// ---------------------------------------------------------------------------
export interface TenantContext {
  orgId: string;
  userId: string;
  role: string;
}

/**
 * Resolves the tenant context from a request.
 * In production, decode a JWT or session cookie.
 * The orgId is used to set app.current_org_id for every DB transaction.
 */
export function resolveTenantContext(request: Request): TenantContext {
  // Production: verify JWT, extract org_id claim
  // const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  // const payload = verifyJwt(token);
  // return { orgId: payload.org_id, userId: payload.sub, role: payload.role };

  // Development fallback — replace with real auth
  const orgId = request.headers.get("X-Org-Id") ?? process.env.DEV_ORG_ID ?? "";
  const userId = request.headers.get("X-User-Id") ?? "anonymous";
  const role = request.headers.get("X-User-Role") ?? "analyst";

  if (!orgId) {
    throw new Error("TENANT_CONTEXT_MISSING: X-Org-Id header is required");
  }

  return { orgId, userId, role };
}

// ---------------------------------------------------------------------------
// Typed query builders for the main tables
// ---------------------------------------------------------------------------
import type {
  CarbonInventoryRecord,
  GeneratedReport,
  NewCarbonRecord,
  NewGeneratedReport,
  NewWaterRecord,
  WaterInventoryRecord,
} from "./schema";

export async function pgInsertCarbonRecord(
  orgId: string,
  record: NewCarbonRecord & { org_id: string },
): Promise<string> {
  return withTenant(orgId, async (db) => {
    const row = await db.queryOne<{ id: string }>(
      `INSERT INTO carbon_inventory (
         org_id, facility_id, uploaded_file_id, reporting_year,
         reporting_period_start, reporting_period_end,
         iso_category, iso_category_label, source_name, source_type,
         co2e_t, co2_t, ch4_t, n2o_t, biomass_co2_memo_t,
         emission_factor_value, emission_factor_unit, emission_factor_source,
         gwp_reference, gwp_co2, gwp_ch4, gwp_n2o,
         data_quality_score, data_quality_notes,
         input_sha256_hash, calculated_by, methodology_tag
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         $11,$12,$13,$14,$15,$16,$17,$18,
         $19,$20,$21,$22,$23,$24,$25,$26,$27
       ) RETURNING id`,
      [
        orgId, record.facility_id, record.uploaded_file_id ?? null,
        record.reporting_year, record.reporting_period_start, record.reporting_period_end,
        record.iso_category, record.iso_category_label, record.source_name, record.source_type,
        record.co2e_t, record.co2_t, record.ch4_t, record.n2o_t, record.biomass_co2_memo_t,
        record.emission_factor_value ?? null, record.emission_factor_unit ?? null,
        record.emission_factor_source ?? null,
        record.gwp_reference, record.gwp_co2, record.gwp_ch4, record.gwp_n2o,
        record.data_quality_score, record.data_quality_notes ?? null,
        record.input_sha256_hash, record.calculated_by, record.methodology_tag,
      ],
    );
    return row!.id;
  });
}

export async function pgInsertWaterRecord(
  orgId: string,
  record: NewWaterRecord & { org_id: string },
): Promise<string> {
  return withTenant(orgId, async (db) => {
    const row = await db.queryOne<{ id: string }>(
      `INSERT INTO water_inventory (
         org_id, facility_id, uploaded_file_id, reporting_year,
         reporting_period_start, reporting_period_end,
         flow_type, flow_subtype, source_name,
         water_source, discharge_destination, volume_m3,
         kpi_1_consumption_m3, kpi_2_intensity_l_per_t, freshwater_consumption_m3,
         water_stress_index, characterisation_factor, characterisation_method,
         quality_parameters, data_quality_score, data_quality_notes,
         input_sha256_hash, calculated_by, methodology_tag
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         $11,$12,$13,$14,$15,$16,$17,$18,
         $19,$20,$21,$22,$23,$24
       ) RETURNING id`,
      [
        orgId, record.facility_id, record.uploaded_file_id ?? null,
        record.reporting_year, record.reporting_period_start, record.reporting_period_end,
        record.flow_type, record.flow_subtype ?? null, record.source_name,
        record.water_source ?? null, record.discharge_destination ?? null, record.volume_m3,
        record.kpi_1_consumption_m3 ?? null, record.kpi_2_intensity_l_per_t ?? null,
        record.freshwater_consumption_m3 ?? null,
        record.water_stress_index ?? null, record.characterisation_factor,
        record.characterisation_method,
        record.quality_parameters ? JSON.parse(record.quality_parameters) : null,
        record.data_quality_score, record.data_quality_notes ?? null,
        record.input_sha256_hash, record.calculated_by, record.methodology_tag,
      ],
    );
    return row!.id;
  });
}

export async function pgGetCarbonRecords(
  orgId: string,
  facilityId: string,
  year: number,
): Promise<CarbonInventoryRecord[]> {
  return withTenant(orgId, (db) =>
    db.queryMany<CarbonInventoryRecord>(
      "SELECT * FROM carbon_inventory WHERE facility_id = $1 AND reporting_year = $2 ORDER BY iso_category",
      [facilityId, year],
    ),
  );
}

export async function pgGetWaterRecords(
  orgId: string,
  facilityId: string,
  year: number,
): Promise<WaterInventoryRecord[]> {
  return withTenant(orgId, (db) =>
    db.queryMany<WaterInventoryRecord>(
      "SELECT * FROM water_inventory WHERE facility_id = $1 AND reporting_year = $2 ORDER BY flow_type",
      [facilityId, year],
    ),
  );
}

export async function pgInsertGeneratedReport(
  orgId: string,
  report: NewGeneratedReport & { org_id: string },
): Promise<string> {
  return withTenant(orgId, async (db) => {
    const row = await db.queryOne<{ id: string }>(
      `INSERT INTO generated_reports (
         org_id, facility_id, generated_by, report_type, reporting_year,
         reporting_period_start, reporting_period_end, title,
         sha256_hash, report_json, storage_key, standards_cited,
         status, carbon_record_ids, water_record_ids
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
       ) RETURNING id`,
      [
        orgId, report.facility_id, report.generated_by, report.report_type,
        report.reporting_year, report.reporting_period_start, report.reporting_period_end,
        report.title, report.sha256_hash,
        typeof report.report_json === "string" ? JSON.parse(report.report_json) : report.report_json,
        report.storage_key ?? null,
        typeof report.standards_cited === "string" ? JSON.parse(report.standards_cited) : report.standards_cited,
        report.status,
        typeof report.carbon_record_ids === "string" ? JSON.parse(report.carbon_record_ids) : report.carbon_record_ids,
        typeof report.water_record_ids === "string" ? JSON.parse(report.water_record_ids) : report.water_record_ids,
      ],
    );
    return row!.id;
  });
}

export async function pgGetReportsByOrg(
  orgId: string,
  year?: number,
): Promise<GeneratedReport[]> {
  return withTenant(orgId, (db) =>
    year
      ? db.queryMany<GeneratedReport>(
          "SELECT * FROM generated_reports WHERE reporting_year = $1 ORDER BY generated_at DESC",
          [year],
        )
      : db.queryMany<GeneratedReport>(
          "SELECT * FROM generated_reports ORDER BY generated_at DESC",
        ),
  );
}

export async function pgCheckDuplicate(
  orgId: string,
  hash: string,
  engineType: "carbon" | "water",
): Promise<{ first_seen_at: string } | null> {
  return withTenant(orgId, (db) =>
    db.queryOne<{ first_seen_at: string }>(
      "SELECT first_seen_at FROM input_hash_registry WHERE input_sha256_hash = $1 AND engine_type = $2",
      [hash, engineType],
    ),
  );
}
