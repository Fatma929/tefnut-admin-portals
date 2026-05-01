/**
 * POST /api/water/upload
 * Proxy: receives multipart file from browser → invokes Python water engine
 * → returns WaterResult JSON.
 */
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { resolveTenantContext } from "../../db/pg-client";

export const APIRoute = createAPIFileRoute("/api/water/upload")({
  POST: async ({ request }) => {
    let tenantCtx: { orgId: string; userId: string; role: string };
    try {
      tenantCtx = resolveTenantContext(request);
    } catch {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") ?? "";
    const lambdaUrl = process.env.LAMBDA_WATER_URL;

    // ── Production: forward to Lambda ──────────────────────────────────
    if (lambdaUrl) {
      const body = await request.arrayBuffer();
      const lambdaRes = await fetch(`${lambdaUrl}/api/water/upload`, {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          "X-Filename": request.headers.get("x-filename") ?? "upload.xlsx",
          "X-User-Id": tenantCtx.userId,
          "X-Org-Id": tenantCtx.orgId,
        },
        body,
      });

      const data = await lambdaRes.json();
      if (!lambdaRes.ok) {
        return Response.json(data, { status: lambdaRes.status });
      }

      // Lambda now emits the full EngineResponse envelope — pass it through directly
      return Response.json({
        result: data.result ?? null,
        validation: data.validation ?? { status: "OK", errors: [], warnings: [] },
      });
    }

    // ── Development: run Python water engine ───────────────────────────
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const { writeFile, unlink } = await import("fs/promises");
      const { tmpdir } = await import("os");
      const { join } = await import("path");
      const execFileAsync = promisify(execFile);

      let fileBytes: Buffer;
      let filename = "upload.xlsx";

      if (contentType.includes("multipart/form-data")) {
        const form = await request.formData();
        const file = form.get("file") as File | null;
        if (!file) return Response.json({ error: "No file field" }, { status: 400 });
        fileBytes = Buffer.from(await file.arrayBuffer());
        filename = file.name;
      } else {
        fileBytes = Buffer.from(await request.arrayBuffer());
        filename = request.headers.get("x-filename") ?? "upload.xlsx";
      }

      const tmpPath = join(tmpdir(), `tefnut_water_${Date.now()}_${filename}`);
      await writeFile(tmpPath, fileBytes);

      try {
        const script = `
import sys, json, datetime
sys.path.insert(0, '.')
from water_engine.water_engine import WaterEngine, WaterInput, AuditContext
import pandas as pd

# Parse Excel/CSV into WaterInput
df = pd.read_excel(sys.argv[1]) if sys.argv[1].endswith(('.xlsx','.xls')) else pd.read_csv(sys.argv[1])
row = df.iloc[0].to_dict()

def g(k, default=0.0):
    return float(row.get(k, default) or default)

from water_engine.water_engine import WaterWithdrawal, WaterDischarge
wi = WaterInput(
    withdrawal=WaterWithdrawal(
        surface_water=g('surface_water'),
        groundwater=g('groundwater'),
        quarry_water_used=g('quarry_water_used'),
        municipal_potable_water=g('municipal_potable_water'),
        external_wastewater=g('external_wastewater'),
        harvested_rainwater=g('harvested_rainwater'),
    ),
    discharge=WaterDischarge(
        ocean=g('ocean'),
        surface_water=g('discharge_surface_water'),
        subsurface_well=g('subsurface_well'),
        offsite_water_treatment=g('offsite_water_treatment'),
        beneficial_other_users=g('beneficial_other_users'),
    ),
    quarry_water_not_used_m3_yr=g('quarry_water_not_used_m3_yr'),
    recycled_water_m3_yr=g('recycled_water_m3_yr'),
    storm_water_collected_discharged_m3_yr=g('storm_water_collected_discharged_m3_yr'),
    cementitious_production_t_yr=g('cementitious_production_t_yr', 1.0),
)
ctx = AuditContext(source_filename=sys.argv[2], upload_timestamp_utc=datetime.datetime.utcnow().isoformat()+'Z', user_id=sys.argv[3])
result = WaterEngine(wi, ctx).calculate()
print(result.model_dump_json())
`;
        const { stdout } = await execFileAsync("python", ["-c", script, tmpPath, filename, tenantCtx.userId]);
        const engineResult = JSON.parse(stdout);

        return Response.json({
          result: engineResult,
          validation: {
            status: "OK",
            errors: [],
            warnings: engineResult.validation_warnings ?? [],
          },
        });
      } finally {
        await unlink(tmpPath).catch(() => {});
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[api/water/upload] Engine error:", msg);
      return Response.json(
        {
          result: null,
          validation: {
            status: "VALIDATION_FAILED",
            errors: [{
              error_code: "ENGINE_UNAVAILABLE",
              field: "file",
              message: "Water engine is not available. Set LAMBDA_WATER_URL to use the production engine.",
              suggested_fix: "Deploy the water_engine Lambda function and set LAMBDA_WATER_URL.",
              meta: { detail: msg },
            }],
            warnings: [],
          },
        },
        { status: 503 },
      );
    }
  },
});
