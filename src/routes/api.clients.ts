import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/clients')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/api/clients"!</div>
}
/**
 * Client Master Data API — /api/v1/clients
 *
 * GET    /api/v1/clients              — list companies (admin view)
 * POST   /api/v1/clients              — create a company manually
 * GET    /api/v1/clients/:id          — get company detail
 * PUT    /api/v1/clients/:id          — update company
 * GET    /api/v1/clients/:id/plants   — list plants for a company
 * POST   /api/v1/clients/:id/plants   — add a plant
 * GET    /api/v1/clients/:id/profile  — get reporting profile
 * PUT    /api/v1/clients/:id/profile  — update reporting profile
 * POST   /api/v1/clients/import       — import from Excel/CSV (multipart)
 * GET    /api/v1/clients/import/:batchId — get import batch status
 */
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { resolveTenantContext, withTenant } from "../../db/pg-client";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
const REQUIRED_COMPANY = ["company_name", "country"] as const;
const VALID_COMPANY_SIZES = ["micro", "small", "medium", "large", "enterprise"];
const VALID_STANDARDS = ["GHG Protocol", "ISO 14064-1", "GCCA", "EU CBAM", "CDP", "GRI"];

function validateCompanyBody(body: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const f of REQUIRED_COMPANY) {
    if (!body[f]) errors.push(`${f} is required`);
  }
  if (body.company_size && !VALID_COMPANY_SIZES.includes(body.company_size as string)) {
    errors.push(`company_size must be one of: ${VALID_COMPANY_SIZES.join(", ")}`);
  }
  if (body.reporting_standard && !VALID_STANDARDS.includes(body.reporting_standard as string)) {
    errors.push(`reporting_standard must be one of: ${VALID_STANDARDS.join(", ")}`);
  }
  if (body.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contact_email as string)) {
    errors.push("contact_email is not a valid email address");
  }
  return errors;
}

// ---------------------------------------------------------------------------
// GET/POST /api/v1/clients
// ---------------------------------------------------------------------------
export const APIRoute = createAPIFileRoute("/api/v1/clients")({

  GET: async ({ request }) => {
    const { orgId } = resolveTenantContext(request);
    const url = new URL(request.url);
    const country = url.searchParams.get("country");
    const industry = url.searchParams.get("industry");
    const search = url.searchParams.get("q");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
    const offset = parseInt(url.searchParams.get("offset") ?? "0");

    return withTenant(orgId, async (db) => {
      const conditions = ["c.org_id = $1"];
      const params: unknown[] = [orgId];
      let idx = 2;

      if (country) { conditions.push(`c.country = $${idx++}`); params.push(country); }
      if (industry) { conditions.push(`c.industry = $${idx++}`); params.push(industry); }
      if (search) {
        conditions.push(`(c.company_name ILIKE $${idx++} OR c.city ILIKE $${idx - 1})`);
        params.push(`%${search}%`);
      }

      params.push(limit, offset);
      const rows = await db.queryMany<Record<string, unknown>>(
        `SELECT c.*, COUNT(DISTINCT p.id) AS plant_count
         FROM companies c
         LEFT JOIN plants p ON p.org_id = c.org_id
         WHERE ${conditions.join(" AND ")}
         GROUP BY c.id
         ORDER BY c.company_name ASC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        params,
      );
      return Response.json({ companies: rows, count: rows.length });
    });
  },

  POST: async ({ request }) => {
    const { orgId } = resolveTenantContext(request);
    const body = await request.json() as Record<string, unknown>;

    const errors = validateCompanyBody(body);
    if (errors.length > 0) {
      return Response.json({ error: "Validation failed", errors }, { status: 400 });
    }

    return withTenant(orgId, async (db) => {
      // Duplicate check
      const existing = await db.queryOne<{ id: string }>(
        "SELECT id FROM companies WHERE org_id = $1 AND LOWER(company_name) = LOWER($2) AND LOWER(country) = LOWER($3)",
        [orgId, body.company_name, body.country],
      );
      if (existing) {
        return Response.json(
          { error: "DUPLICATE_COMPANY", message: "A company with this name and country already exists", existing_id: existing.id },
          { status: 409 },
        );
      }

      const row = await db.queryOne<{ id: string }>(
        `INSERT INTO companies (
           org_id, company_name, company_size, industry, sub_industry,
           country, city, website, currency, fiscal_year_start,
           export_to_eu, eori_number, reporting_standard, employee_count
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        [
          orgId,
          body.company_name, body.company_size ?? null, body.industry ?? "cement",
          body.sub_industry ?? null, body.country, body.city ?? null,
          body.website ?? null, body.currency ?? "USD",
          body.fiscal_year_start ?? 1, body.export_to_eu ?? false,
          body.eori_number ?? null, body.reporting_standard ?? "GCCA",
          body.employee_count ?? null,
        ],
      );

      // Create primary contact if provided
      if (body.contact_name || body.contact_email) {
        await db.query(
          `INSERT INTO client_contacts (org_id, company_id, contact_name, contact_email, is_primary)
           VALUES ($1,$2,$3,$4,TRUE)
           ON CONFLICT (company_id, contact_email) DO NOTHING`,
          [orgId, row!.id, body.contact_name ?? "", body.contact_email ?? null],
        );
      }

      return Response.json({ id: row!.id }, { status: 201 });
    });
  },
});

// ---------------------------------------------------------------------------
// GET/PUT /api/v1/clients/:id
// ---------------------------------------------------------------------------
export const ClientByIdRoute = createAPIFileRoute("/api/v1/clients/$id")({

  GET: async ({ request, params }) => {
    const { orgId } = resolveTenantContext(request);
    return withTenant(orgId, async (db) => {
      const company = await db.queryOne<Record<string, unknown>>(
        "SELECT * FROM companies WHERE id = $1 AND org_id = $2",
        [params.id, orgId],
      );
      if (!company) return Response.json({ error: "Company not found" }, { status: 404 });

      const contacts = await db.queryMany<Record<string, unknown>>(
        "SELECT * FROM client_contacts WHERE company_id = $1 ORDER BY is_primary DESC",
        [params.id],
      );
      const plants = await db.queryMany<Record<string, unknown>>(
        "SELECT * FROM plants WHERE org_id = $1 ORDER BY plant_name",
        [orgId],
      );
      const profiles = await db.queryMany<Record<string, unknown>>(
        "SELECT * FROM reporting_profiles WHERE company_id = $1 ORDER BY reporting_year DESC",
        [params.id],
      );

      return Response.json({ company, contacts, plants, reporting_profiles: profiles });
    });
  },

  PUT: async ({ request, params }) => {
    const { orgId } = resolveTenantContext(request);
    const body = await request.json() as Record<string, unknown>;

    const allowed = [
      "company_name", "company_size", "industry", "sub_industry", "country", "city",
      "website", "currency", "fiscal_year_start", "export_to_eu", "eori_number",
      "reporting_standard", "employee_count",
    ];
    const updates = Object.entries(body).filter(([k]) => allowed.includes(k));
    if (updates.length === 0) {
      return Response.json({ error: "No updatable fields provided" }, { status: 400 });
    }

    const errors = validateCompanyBody({ ...body, company_name: body.company_name ?? "x", country: body.country ?? "x" });
    const fieldErrors = errors.filter(e => !e.includes("required"));
    if (fieldErrors.length > 0) {
      return Response.json({ error: "Validation failed", errors: fieldErrors }, { status: 400 });
    }

    return withTenant(orgId, async (db) => {
      const setClauses = updates.map(([k], i) => `${k} = $${i + 1}`).join(", ");
      const values = [...updates.map(([, v]) => v), params.id, orgId];
      await db.query(
        `UPDATE companies SET ${setClauses}, updated_at = NOW()
         WHERE id = $${updates.length + 1} AND org_id = $${updates.length + 2}`,
        values,
      );
      return Response.json({ updated: true });
    });
  },
});

// ---------------------------------------------------------------------------
// GET/POST /api/v1/clients/:id/plants
// ---------------------------------------------------------------------------
export const ClientPlantsRoute = createAPIFileRoute("/api/v1/clients/$id/plants")({

  GET: async ({ request, params }) => {
    const { orgId } = resolveTenantContext(request);
    return withTenant(orgId, async (db) => {
      const rows = await db.queryMany<Record<string, unknown>>(
        "SELECT * FROM plants WHERE org_id = $1 ORDER BY plant_name",
        [orgId],
      );
      return Response.json({ plants: rows });
    });
  },

  POST: async ({ request, params }) => {
    const { orgId } = resolveTenantContext(request);
    const body = await request.json() as Record<string, unknown>;

    if (!body.plant_name || !body.country) {
      return Response.json({ error: "plant_name and country are required" }, { status: 400 });
    }

    return withTenant(orgId, async (db) => {
      // Create a facilities entry first (backward compat)
      const facilityRow = await db.queryOne<{ id: string }>(
        `INSERT INTO facilities (org_id, organization_id, name, facility_type, country, capacity_t_yr)
         VALUES ($1,$1,$2,$3,$4,$5) RETURNING id`,
        [orgId, body.plant_name, body.plant_type ?? "cement_plant", body.country, body.plant_capacity_t_yr ?? null],
      );

      const plantRow = await db.queryOne<{ id: string }>(
        `INSERT INTO plants (
           facility_id, org_id, plant_name, plant_type, country, city,
           plant_capacity_t_yr, kiln_type, production_lines
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          facilityRow!.id, orgId,
          body.plant_name, body.plant_type ?? "integrated",
          body.country, body.city ?? null,
          body.plant_capacity_t_yr ?? null,
          body.kiln_type ?? null, body.production_lines ?? null,
        ],
      );
      return Response.json({ id: plantRow!.id, facility_id: facilityRow!.id }, { status: 201 });
    });
  },
});

// ---------------------------------------------------------------------------
// GET/PUT /api/v1/clients/:id/profile
// ---------------------------------------------------------------------------
export const ClientProfileRoute = createAPIFileRoute("/api/v1/clients/$id/profile")({

  GET: async ({ request, params }) => {
    const { orgId } = resolveTenantContext(request);
    return withTenant(orgId, async (db) => {
      const rows = await db.queryMany<Record<string, unknown>>(
        `SELECT rp.*, gr_c.sha256_hash AS carbon_report_hash, gr_w.sha256_hash AS water_report_hash
         FROM reporting_profiles rp
         LEFT JOIN generated_reports gr_c ON gr_c.id = rp.carbon_report_id
         LEFT JOIN generated_reports gr_w ON gr_w.id = rp.water_report_id
         WHERE rp.company_id = $1 AND rp.org_id = $2
         ORDER BY rp.reporting_year DESC`,
        [params.id, orgId],
      );
      return Response.json({ profiles: rows });
    });
  },

  PUT: async ({ request, params }) => {
    const { orgId } = resolveTenantContext(request);
    const body = await request.json() as Record<string, unknown>;
    const year = body.reporting_year as number | undefined;
    if (!year) return Response.json({ error: "reporting_year is required" }, { status: 400 });

    return withTenant(orgId, async (db) => {
      await db.query(
        `INSERT INTO reporting_profiles (org_id, company_id, reporting_year, includes_carbon, includes_water, includes_cbam, reporting_standard, gwp_reference, base_year)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (org_id, reporting_year) DO UPDATE SET
           includes_carbon = EXCLUDED.includes_carbon,
           includes_water = EXCLUDED.includes_water,
           includes_cbam = EXCLUDED.includes_cbam,
           reporting_standard = EXCLUDED.reporting_standard,
           updated_at = NOW()`,
        [
          orgId, params.id, year,
          body.includes_carbon ?? true,
          body.includes_water ?? false,
          body.includes_cbam ?? false,
          body.reporting_standard ?? "GCCA",
          body.gwp_reference ?? "IPCC AR6",
          body.base_year ?? null,
        ],
      );
      return Response.json({ upserted: true });
    });
  },
});

// ---------------------------------------------------------------------------
// POST /api/v1/clients/import — multipart file upload
// ---------------------------------------------------------------------------
export const ClientImportRoute = createAPIFileRoute("/api/v1/clients/import")({
  POST: async ({ request }) => {
    const { orgId } = resolveTenantContext(request);
    const contentType = request.headers.get("content-type") ?? "";

    let fileBytes: Uint8Array;
    let filename: string;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file") as File | null;
      if (!file) return Response.json({ error: "No file provided. Use field name 'file'." }, { status: 400 });
      fileBytes = new Uint8Array(await file.arrayBuffer());
      filename = file.name;
    } else {
      // Raw binary upload with X-Filename header
      filename = request.headers.get("x-filename") ?? "import.xlsx";
      fileBytes = new Uint8Array(await request.arrayBuffer());
    }

    if (!fileBytes.length) {
      return Response.json({ error: "Uploaded file is empty" }, { status: 400 });
    }

    const ext = filename.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext ?? "")) {
      return Response.json({ error: "Unsupported file type. Use .xlsx, .xls, or .csv" }, { status: 400 });
    }

    // TODO: Call Python client_importer via Lambda/subprocess
    // For now return a structured mock response showing the expected shape
    return Response.json({
      message: "Import accepted",
      batch_id: crypto.randomUUID(),
      filename,
      file_size_bytes: fileBytes.length,
      status: "processing",
      note: "TODO: wire to Python ClientImporter via Lambda",
    }, { status: 202 });
  },
});

// ---------------------------------------------------------------------------
// GET /api/v1/clients/import/:batchId — import batch status
// ---------------------------------------------------------------------------
export const ImportStatusRoute = createAPIFileRoute("/api/v1/clients/import/$batchId")({
  GET: async ({ request, params }) => {
    const { orgId } = resolveTenantContext(request);
    return withTenant(orgId, async (db) => {
      const row = await db.queryOne<Record<string, unknown>>(
        "SELECT * FROM client_import_log WHERE id = $1 AND (org_id = $2 OR org_id IS NULL)",
        [params.batchId, orgId],
      );
      if (!row) return Response.json({ error: "Import batch not found" }, { status: 404 });
      return Response.json(row);
    });
  },
});
