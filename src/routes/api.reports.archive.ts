/**
 * POST /api/reports/archive
 *
 * Archives a generated ISO report into generated_reports with its SHA-256 hash.
 * Called when the user clicks "Generate Report" in the UI.
 *
 * Body:
 *   { report: IsoReport | IsoWaterReport, reportType, facilityId,
 *     carbonRecordIds?, waterRecordIds?, reportingYear? }
 *
 * GET /api/reports/archive?facilityId=...&year=...
 *
 * Returns all archived reports for a facility (for the History page).
 */
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { getCloudflareContext } from "@cloudflare/vite-plugin/worker";
import type { IsoReport, IsoWaterReport } from "@/lib/engine-types";
import { persistGeneratedReport } from "@/lib/persistence";
import { getReportsByFacility } from "../../db/queries";
import type { NewGeneratedReport } from "../../db/schema";

export const APIRoute = createAPIFileRoute("/api/reports/archive")({
  // ── Archive a new report ──
  POST: async ({ request }) => {
    const body = await request.json() as {
      report: IsoReport | IsoWaterReport;
      reportType: NewGeneratedReport["report_type"];
      facilityId: string;
      userId?: string;
      carbonRecordIds?: string[];
      waterRecordIds?: string[];
      reportingYear?: number;
    };

    const { env } = getCloudflareContext();
    const db: D1Database = env.DB;

    const { reportId, sha256Hash, isDuplicate } = await persistGeneratedReport({
      db,
      report: body.report,
      reportType: body.reportType,
      facilityId: body.facilityId,
      userId: body.userId ?? "anonymous",
      carbonRecordIds: body.carbonRecordIds,
      waterRecordIds: body.waterRecordIds,
      reportingYear: body.reportingYear,
    });

    return Response.json({ reportId, sha256Hash, isDuplicate });
  },

  // ── Fetch history for the History page ──
  GET: async ({ request }) => {
    const url = new URL(request.url);
    const facilityId = url.searchParams.get("facilityId") ?? "default";
    const year = url.searchParams.get("year");

    const { env } = getCloudflareContext();
    const db: D1Database = env.DB;

    const reports = await getReportsByFacility(db, facilityId, year ? Number(year) : undefined);
    return Response.json({ reports });
  },
});
