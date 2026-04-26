import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/factors')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/api/factors"!</div>
}
/**
 * Emission Factors API — /api/v1/factors
 *
 * GET    /api/v1/factors          — list/search factors
 * POST   /api/v1/factors          — create a new factor
 * PUT    /api/v1/factors/:id      — update a factor
 * DELETE /api/v1/factors/:id      — deactivate a factor (soft delete)
 * GET    /api/v1/factors/search   — search with query params
 */
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { resolveTenantContext, withTenant } from "../../db/pg-client";

// ---------------------------------------------------------------------------
// GET /api/v1/factors  — list active factors for the org
// PUT /api/v1/factors  — not used at collection level
// POST /api/v1/factors — create a new factor
// ---------------------------------------------------------------------------
export const APIRoute = createAPIFileRoute("/api/v1/factors")({

  GET: async ({ request }) => {
    const { orgId } = resolveTenantContext(request);
    const url = new URL(request.url);
    const category = url.searchParams.get("category");
    const subcategory = url.searchParams.get("subcategory");
    const geography = url.searchParams.get("geography");
    const isActive = url.searchParams.get("is_active") !== "false";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 500);
    const offset = parseInt(url.searchParams.get("offset") ?? "0");

    return withTenant(orgId, async (db) => {
      const conditions: string[] = [
        "(org_id IS NULL OR org_id = $1)",
        "is_active = $2",
      ];
      const params: unknown[] = [orgId, isActive];
      let idx = 3;

      if (category) {
        conditions.push(`category = $${idx++}`);
        params.push(category);
      }
      if (subcategory) {
        conditions.push(`subcategory = $${idx++}`);
        params.push(subcategory);
      }
      if (geography) {
        conditions.push(`(geography = $${idx++} OR geography = 'Global')`);
        params.push(geography);
      }

      params.push(limit, offset);
      const rows = await db.queryMany<Record<string, unknown>>(
        `SELECT * FROM emission_factors
         WHERE ${conditions.join(" AND ")}
         ORDER BY priority_rank ASC, reporting_year DESC NULLS LAST
         LIMIT $${idx} OFFSET $${idx + 1}`,
        params,
      );

      return Response.json({ factors: rows, count: rows.length });
    });
  },

  POST: async ({ request }) => {
    const { orgId } = resolveTenantContext(request);
    const body = await request.json() as Record<string, unknown>;

    // Validate required fields
    const required = ["factor_code", "category", "subcategory", "unit", "value", "source_name"];
    const missing = required.filter((f) => !(f in body) || body[f] === null);
    if (missing.length > 0) {
      return Response.json({ error: "Missing required fields", missing }, { status: 400 });
    }

    if (typeof body.value !== "number" || body.value < 0) {
      return Response.json({ error: "value must be a non-negative number" }, { status: 400 });
    }

    const priorityRank = (body.priority_rank as number | undefined) ?? 3;
    if (priorityRank < 1 || priorityRank > 4) {
      return Response.json({ error: "priority_rank must be between 1 and 4" }, { status: 400 });
    }

    return withTenant(orgId, async (db) => {
      const row = await db.queryOne<{ id: string }>(
        `INSERT INTO emission_factors (
           org_id, factor_code, category, subcategory, fuel_type, process_type,
           geography, source_name, source_type, source_file, source_sheet,
           reporting_year, unit, value, value_min, value_max,
           confidence_score, priority_rank, is_active, notes
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
         )
         ON CONFLICT ON CONSTRAINT uq_ef_scope DO UPDATE SET
           value = EXCLUDED.value, updated_at = NOW()
         RETURNING id`,
        [
          orgId,
          body.factor_code, body.category, body.subcategory,
          body.fuel_type ?? null, body.process_type ?? null,
          body.geography ?? null,
          body.source_name, body.source_type ?? "operator_supplied",
          body.source_file ?? null, body.source_sheet ?? null,
          body.reporting_year ?? null,
          body.unit, body.value,
          body.value_min ?? null, body.value_max ?? null,
          body.confidence_score ?? null,
          priorityRank, body.is_active ?? true, body.notes ?? null,
        ],
      );
      return Response.json({ id: row!.id }, { status: 201 });
    });
  },
});

// ---------------------------------------------------------------------------
// GET /api/v1/factors/search — search with richer query params
// ---------------------------------------------------------------------------
export const SearchRoute = createAPIFileRoute("/api/v1/factors/search")({
  GET: async ({ request }) => {
    const { orgId } = resolveTenantContext(request);
    const url = new URL(request.url);

    const q = url.searchParams.get("q");           // free-text search on factor_code/source_name
    const category = url.searchParams.get("category");
    const geography = url.searchParams.get("geography");
    const year = url.searchParams.get("year");
    const sourceType = url.searchParams.get("source_type");

    return withTenant(orgId, async (db) => {
      const conditions = ["(org_id IS NULL OR org_id = $1)", "is_active = TRUE"];
      const params: unknown[] = [orgId];
      let idx = 2;

      if (q) {
        conditions.push(`(factor_code ILIKE $${idx} OR source_name ILIKE $${idx})`);
        params.push(`%${q}%`);
        idx++;
      }
      if (category) { conditions.push(`category = $${idx++}`); params.push(category); }
      if (geography) {
        conditions.push(`(geography = $${idx++} OR geography = 'Global')`);
        params.push(geography);
      }
      if (year) {
        conditions.push(`(reporting_year IS NULL OR reporting_year <= $${idx++})`);
        params.push(parseInt(year));
      }
      if (sourceType) { conditions.push(`source_type = $${idx++}`); params.push(sourceType); }

      const rows = await db.queryMany<Record<string, unknown>>(
        `SELECT * FROM emission_factors
         WHERE ${conditions.join(" AND ")}
         ORDER BY priority_rank ASC, reporting_year DESC NULLS LAST
         LIMIT 100`,
        params,
      );
      return Response.json({ factors: rows, count: rows.length });
    });
  },
});

// ---------------------------------------------------------------------------
// GET/PUT/DELETE /api/v1/factors/:id
// ---------------------------------------------------------------------------
export const FactorByIdRoute = createAPIFileRoute("/api/v1/factors/$id")({

  GET: async ({ request, params }) => {
    const { orgId } = resolveTenantContext(request);
    return withTenant(orgId, async (db) => {
      const row = await db.queryOne<Record<string, unknown>>(
        "SELECT * FROM emission_factors WHERE id = $1 AND (org_id IS NULL OR org_id = $2)",
        [params.id, orgId],
      );
      if (!row) return Response.json({ error: "Factor not found" }, { status: 404 });
      return Response.json(row);
    });
  },

  PUT: async ({ request, params }) => {
    const { orgId } = resolveTenantContext(request);
    const body = await request.json() as Record<string, unknown>;

    const allowed = [
      "value", "value_min", "value_max", "unit", "source_name",
      "reporting_year", "applicable_from", "applicable_to",
      "confidence_score", "priority_rank", "is_active", "notes",
    ];
    const updates = Object.entries(body)
      .filter(([k]) => allowed.includes(k) && body[k] !== undefined);

    if (updates.length === 0) {
      return Response.json({ error: "No updatable fields provided" }, { status: 400 });
    }

    return withTenant(orgId, async (db) => {
      const setClauses = updates.map(([k], i) => `${k} = $${i + 1}`).join(", ");
      const values = updates.map(([, v]) => v);
      values.push(params.id, orgId);

      await db.query(
        `UPDATE emission_factors
         SET ${setClauses}, updated_at = NOW()
         WHERE id = $${updates.length + 1}
           AND (org_id IS NULL OR org_id = $${updates.length + 2})`,
        values,
      );
      return Response.json({ updated: true });
    });
  },

  DELETE: async ({ request, params }) => {
    const { orgId } = resolveTenantContext(request);
    return withTenant(orgId, async (db) => {
      await db.query(
        "UPDATE emission_factors SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND org_id = $2",
        [params.id, orgId],
      );
      return Response.json({ deactivated: true });
    });
  },
});
