/**
 * GET /api/dashboard/summary
 * Returns the latest carbon + water results for the authenticated org.
 * Used by the dashboard to replace hardcoded mock data.
 */
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { resolveTenantContext, withTenant } from "../../db/pg-client";

export const APIRoute = createAPIFileRoute("/api/dashboard")({
  GET: async ({ request }) => {
    let tenantCtx: { orgId: string; userId: string; role: string };
    try {
      tenantCtx = resolveTenantContext(request);
    } catch {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    try {
      const data = await withTenant(tenantCtx.orgId, async (db) => {
        // Latest carbon inventory summary
        const carbonSummary = await db.queryOne<{
          total_co2e_t: number;
          reporting_year: number;
          input_sha256_hash: string;
          calculated_at: string;
          methodology_tag: string;
        }>(
          `SELECT
             SUM(co2e_t) AS total_co2e_t,
             reporting_year,
             MAX(input_sha256_hash) AS input_sha256_hash,
             MAX(calculated_at) AS calculated_at,
             MAX(methodology_tag) AS methodology_tag
           FROM carbon_inventory
           WHERE org_id = $1
           GROUP BY reporting_year
           ORDER BY reporting_year DESC
           LIMIT 1`,
          [tenantCtx.orgId],
        );

        // Scope breakdown for latest year
        const scopeBreakdown = carbonSummary
          ? await db.queryMany<{ iso_category: number; source_type: string; co2e_t: number }>(
              `SELECT iso_category, source_type, SUM(co2e_t) AS co2e_t
               FROM carbon_inventory
               WHERE org_id = $1 AND reporting_year = $2
               GROUP BY iso_category, source_type`,
              [tenantCtx.orgId, carbonSummary.reporting_year],
            )
          : [];

        // Latest water summary
        const waterSummary = await db.queryOne<{
          total_withdrawal_m3: number;
          total_consumption_m3: number;
          reporting_year: number;
          calculated_at: string;
        }>(
          `SELECT
             SUM(CASE WHEN flow_type = 'withdrawal' THEN volume_m3 ELSE 0 END) AS total_withdrawal_m3,
             SUM(CASE WHEN flow_type = 'consumption' THEN volume_m3 ELSE 0 END) AS total_consumption_m3,
             reporting_year,
             MAX(calculated_at) AS calculated_at
           FROM water_inventory
           WHERE org_id = $1
           GROUP BY reporting_year
           ORDER BY reporting_year DESC
           LIMIT 1`,
          [tenantCtx.orgId],
        );

        // Recent reports
        const recentReports = await db.queryMany<{
          id: string;
          report_type: string;
          reporting_year: number;
          status: string;
          generated_at: string;
          sha256_hash: string;
        }>(
          `SELECT id, report_type, reporting_year, status, generated_at, sha256_hash
           FROM generated_reports
           WHERE org_id = $1
           ORDER BY generated_at DESC
           LIMIT 5`,
          [tenantCtx.orgId],
        );

        // CBAM ETS price
        const etsPrice = await db.queryOne<{
          price_eur_per_t_co2e: string;
          week_start_date: string;
        }>(
          "SELECT price_eur_per_t_co2e, week_start_date FROM cbam_ets_price_history ORDER BY week_start_date DESC LIMIT 1",
        );

        return { carbonSummary, scopeBreakdown, waterSummary, recentReports, etsPrice };
      });

      return Response.json(data);
    } catch (err) {
      // DB not connected — return empty state so dashboard renders gracefully
      console.warn("[api/dashboard] DB unavailable:", err instanceof Error ? err.message : err);
      return Response.json({
        carbonSummary: null,
        scopeBreakdown: [],
        waterSummary: null,
        recentReports: [],
        etsPrice: null,
        _source: "empty_state",
      });
    }
  },
});
