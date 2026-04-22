/**
 * Storage API Routes
 *
 * POST /api/storage/upload-url   — get a presigned PUT URL for direct browser upload
 * POST /api/storage/download-url — get a presigned GET URL for a specific file
 * GET  /api/storage/verify       — verify a file's sha256 integrity
 *
 * All routes enforce org_id isolation — a user can only access files
 * under their own org_id prefix.
 */
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { resolveTenantContext } from "../../db/pg-client";
import {
  getPresignedDownloadUrl,
  getPresignedUploadUrl,
  verifyObjectIntegrity,
  type FileType,
} from "@/lib/s3-storage";

// ---------------------------------------------------------------------------
// POST /api/storage/upload-url
// Body: { filename, fileType, contentType, sha256Hash }
// Returns: { url, key, expiresAt }
// ---------------------------------------------------------------------------
export const APIRoute = createAPIFileRoute("/api/storage")({
  POST: async ({ request }) => {
    const { orgId } = resolveTenantContext(request);

    const body = await request.json() as {
      action: "upload-url" | "download-url" | "verify";
      filename?: string;
      fileType?: FileType;
      contentType?: string;
      sha256Hash?: string;
      s3Key?: string;
      expiresInSeconds?: number;
    };

    // ── Upload URL ──
    if (body.action === "upload-url") {
      if (!body.filename || !body.fileType || !body.contentType || !body.sha256Hash) {
        return Response.json(
          { error: "filename, fileType, contentType, and sha256Hash are required" },
          { status: 400 },
        );
      }

      const result = await getPresignedUploadUrl({
        sessionOrgId: orgId,
        fileType: body.fileType,
        filename: body.filename,
        contentType: body.contentType,
        sha256Hash: body.sha256Hash,
        expiresInSeconds: body.expiresInSeconds,
      });

      return Response.json(result);
    }

    // ── Download URL ──
    if (body.action === "download-url") {
      if (!body.s3Key) {
        return Response.json({ error: "s3Key is required" }, { status: 400 });
      }

      try {
        const result = await getPresignedDownloadUrl({
          sessionOrgId: orgId,
          s3Key: body.s3Key,
          sha256Hash: body.sha256Hash,
          expiresInSeconds: body.expiresInSeconds,
        });
        return Response.json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        const status = msg.includes("TENANT_VIOLATION") ? 403 : 500;
        return Response.json({ error: msg }, { status });
      }
    }

    // ── Verify integrity ──
    if (body.action === "verify") {
      if (!body.s3Key || !body.sha256Hash) {
        return Response.json({ error: "s3Key and sha256Hash are required" }, { status: 400 });
      }

      try {
        const result = await verifyObjectIntegrity(orgId, body.s3Key, body.sha256Hash);
        return Response.json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return Response.json({ error: msg }, { status: 403 });
      }
    }

    return Response.json({ error: "Invalid action" }, { status: 400 });
  },
});
