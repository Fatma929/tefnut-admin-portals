/**
 * POST /api/carbon/upload
 * Proxy: receives multipart file from browser → invokes Python carbon engine
 * → returns CarbonResult JSON.
 *
 * In production: forwards to AWS Lambda via LAMBDA_CARBON_URL env var.
 * In development: runs the Python engine directly via subprocess.
 */
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { resolveTenantContext } from "../../db/pg-client";

export const APIRoute = createAPIFileRoute("/api/carbon/upload")({
  POST: async ({ request }) => {
    // Auth check — will throw if no valid token
    let tenantCtx: { orgId: string; userId: string; role: string };
    try {
      tenantCtx = resolveTenantContext(request);
    } catch {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") ?? "";
    const lambdaUrl = process.env.LAMBDA_CARBON_URL;

    // ── Production: forward to Lambda ──────────────────────────────────
    if (lambdaUrl) {
      const body = await request.arrayBuffer();
      const lambdaRes = await fetch(`${lambdaUrl}/api/calculate/upload`, {
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

    // ── Development: run Python engine in-process via child_process ────
    // This requires Python + carbon_engine installed in the same environment.
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const { writeFile, unlink } = await import("fs/promises");
      const { tmpdir } = await import("os");
      const { join } = await import("path");
      const execFileAsync = promisify(execFile);

      // Extract file from multipart or raw body
      let fileBytes: Buffer;
      let filename = "upload.xlsx";

      if (contentType.includes("multipart/form-data")) {
        const form = await request.formData();
        const file = form.get("file") as File | null;
        if (!file) {
          return Response.json({ error: "No file field in form data" }, { status: 400 });
        }
        fileBytes = Buffer.from(await file.arrayBuffer());
        filename = file.name;
      } else {
        fileBytes = Buffer.from(await request.arrayBuffer());
        filename = request.headers.get("x-filename") ?? "upload.xlsx";
      }

      // Write to temp file
      const tmpPath = join(tmpdir(), `tefnut_carbon_${Date.now()}_${filename}`);
      await writeFile(tmpPath, fileBytes);

      try {
        const script = `
import sys, json, datetime
sys.path.insert(0, '.')
from carbon_engine.parser import parse_file
from carbon_engine import CarbonEngine
from carbon_engine.validators import compute_input_hash

with open(sys.argv[1], 'rb') as f:
    data = f.read()

plant_input = parse_file(data, sys.argv[2])
raw_dict = json.loads(plant_input.model_dump_json())
result = CarbonEngine(plant_input).calculate()
output = result.model_dump()
output['audit_trail'] = {
    'source_reference': {
        'source_filename': sys.argv[2],
        'upload_timestamp_utc': datetime.datetime.utcnow().isoformat() + 'Z',
        'input_hash': compute_input_hash(raw_dict)
    },
    'user_id': sys.argv[3]
}
output['methodology'] = {'protocol_name': 'GCCA Carbon', 'protocol_version': '0.1'}
print(json.dumps(output))
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
      console.error("[api/carbon/upload] Engine error:", msg);

      // Return a structured error so the frontend can display it
      return Response.json(
        {
          result: null,
          validation: {
            status: "VALIDATION_FAILED",
            errors: [{
              error_code: "ENGINE_UNAVAILABLE",
              field: "file",
              message: "Carbon engine is not available. Set LAMBDA_CARBON_URL to use the production engine.",
              suggested_fix: "Deploy the carbon_engine Lambda function and set LAMBDA_CARBON_URL in your environment.",
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
