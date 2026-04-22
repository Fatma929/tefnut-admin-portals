/**
 * POST /api/persist
 *
 * TanStack Start API route — saves engine results to D1 after calculation.
 * Called by the client immediately after a successful engine upload.
 *
 * Body:
 *   { type: "carbon" | "water", result: CarbonResult | WaterResult,
 *     fileHash: string, fileName: string, facilityId: string }
 *
 * Returns:
 *   { recordIds: string[], reportId?: string, isDuplicate: boolean }
 */
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { getCloudflareContext } from "@cloudflare/vite-plugin/worker";
import type { CarbonResult, WaterResult } from "@/lib/engine-types";
import {
  persistCarbonResult,
  persistWaterResult,
  registerUploadedFile,
} from "@/lib/persistence";

export const APIRoute = createAPIFileRoute("/api/persist")({
  POST: async ({ request }) => {
    const body = await request.json() as {
      type: "carbon" | "water";
      result: CarbonResult | WaterResult;
      fileHash: string;
      fileName: string;
      fileSize?: number;
      facilityId: string;
      userId?: string;
      reportingYear?: number;
    };

    const { env } = getCloudflareContext();
    const db: D1Database = env.DB;

    const userId = body.userId ?? "anonymous";
    const facilityId = body.facilityId;
    const year = body.reportingYear ?? new Date().getFullYear();

    // 1. Register the uploaded file as audit evidence
    const uploadedFileId = await registerUploadedFile({
      db,
      file: { name: body.fileName, type: "application/octet-stream", size: body.fileSize ?? 0 } as File,
      fileHash: body.fileHash,
      facilityId,
      userId,
      engineType: body.type,
      reportingYear: year,
    });

    // 2. Persist engine result to inventory table
    if (body.type === "carbon") {
      const { recordIds, isDuplicate, firstSeenAt } = await persistCarbonResult({
        db,
        result: body.result as CarbonResult,
        facilityId,
        userId,
        uploadedFileId,
        reportingYear: year,
      });
      return Response.json({ recordIds, isDuplicate, firstSeenAt, uploadedFileId });
    }

    const { recordIds, isDuplicate, firstSeenAt } = await persistWaterResult({
      db,
      result: body.result as WaterResult,
      facilityId,
      userId,
      uploadedFileId,
      reportingYear: year,
    });
    return Response.json({ recordIds, isDuplicate, firstSeenAt, uploadedFileId });
  },
});
