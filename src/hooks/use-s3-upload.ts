/**
 * useS3Upload
 *
 * Client-side hook for the presigned URL upload flow:
 *   1. Compute SHA-256 of the file in the browser
 *   2. Request a presigned PUT URL from /api/storage (org_id baked in server-side)
 *   3. PUT the file directly to S3 with the presigned URL
 *   4. Return the S3 key for storage in the database
 *
 * The org_id is never sent by the client — it is resolved from the session
 * on the server and baked into the S3 key automatically.
 */
import { useState } from "react";

export type S3UploadStatus = "idle" | "hashing" | "requesting_url" | "uploading" | "success" | "error";
export type S3FileType = "uploads" | "processed" | "reports";

export interface S3UploadState {
  status: S3UploadStatus;
  s3Key: string | null;
  sha256Hash: string | null;
  error: string | null;
  progress: number; // 0–100
}

/** Compute SHA-256 of a File using the Web Crypto API */
async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Base64-encode a hex SHA-256 string for the S3 ChecksumSHA256 header */
function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  return btoa(String.fromCharCode(...bytes));
}

export function useS3Upload() {
  const [state, setState] = useState<S3UploadState>({
    status: "idle",
    s3Key: null,
    sha256Hash: null,
    error: null,
    progress: 0,
  });

  const upload = async (file: File, fileType: S3FileType = "uploads"): Promise<string | null> => {
    setState({ status: "hashing", s3Key: null, sha256Hash: null, error: null, progress: 0 });

    // ── Step 1: hash the file client-side ──
    let sha256Hash: string;
    try {
      sha256Hash = await hashFile(file);
    } catch {
      setState((s) => ({ ...s, status: "error", error: "Failed to compute file hash" }));
      return null;
    }

    setState((s) => ({ ...s, status: "requesting_url", sha256Hash, progress: 10 }));

    // ── Step 2: request presigned PUT URL from backend ──
    let presignedUrl: string;
    let s3Key: string;
    try {
      const res = await fetch("/api/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upload-url",
          filename: file.name,
          fileType,
          contentType: file.type || "application/octet-stream",
          sha256Hash,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { url: string; key: string; expiresAt: string };
      presignedUrl = data.url;
      s3Key = data.key;
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: `Failed to get upload URL: ${err instanceof Error ? err.message : String(err)}`,
      }));
      return null;
    }

    setState((s) => ({ ...s, status: "uploading", progress: 30 }));

    // ── Step 3: PUT directly to S3 with the presigned URL ──
    try {
      const putRes = await fetch(presignedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          // S3 requires the checksum header to match what was signed
          "x-amz-checksum-sha256": hexToBase64(sha256Hash),
          "x-amz-server-side-encryption": "aws:kms",
        },
        body: file,
      });

      if (!putRes.ok) {
        throw new Error(`S3 PUT failed: ${putRes.status} ${putRes.statusText}`);
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: `Upload to S3 failed: ${err instanceof Error ? err.message : String(err)}`,
      }));
      return null;
    }

    setState({ status: "success", s3Key, sha256Hash, error: null, progress: 100 });
    return s3Key;
  };

  const reset = () =>
    setState({ status: "idle", s3Key: null, sha256Hash: null, error: null, progress: 0 });

  return { ...state, upload, reset };
}

// ---------------------------------------------------------------------------
// Standalone helper — request a presigned download URL for a known S3 key
// ---------------------------------------------------------------------------
export async function requestDownloadUrl(
  s3Key: string,
  expectedSha256?: string,
  expiresInSeconds = 900,
): Promise<string> {
  const res = await fetch("/api/storage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "download-url",
      s3Key,
      sha256Hash: expectedSha256,
      expiresInSeconds,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }

  const data = await res.json() as { url: string; expiresAt: string };
  return data.url;
}
