/**
 * Tefnut S3 Storage — Multi-Tenant Isolation Layer
 *
 * Bucket layout:
 *   tefnut-data/{org_id}/uploads/   — raw Excel / CSV files uploaded by users
 *   tefnut-data/{org_id}/processed/ — engine output JSON (carbon / water results)
 *   tefnut-data/{org_id}/reports/   — generated ISO 14064 / 14046 PDF + JSON reports
 *
 * Security model:
 *   • No public access — all objects are private
 *   • SSE-KMS encryption at rest on every PUT
 *   • sha256_hash stored as S3 object metadata for integrity verification
 *   • All access via short-lived presigned URLs (15–30 min)
 *   • org_id prefix is verified server-side before any URL is issued
 *   • The application IAM role is scoped to tefnut-data/{org_id}/* via
 *     session-policy conditions (see iam-policy.json)
 *
 * Environment variables required:
 *   AWS_REGION          — e.g. eu-west-1
 *   S3_BUCKET_NAME      — e.g. tefnut-data
 *   KMS_KEY_ID          — ARN or alias of the KMS key for SSE-KMS
 *   AWS_ACCESS_KEY_ID   — IAM role credentials (use instance profile in prod)
 *   AWS_SECRET_ACCESS_KEY
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ---------------------------------------------------------------------------
// Client — singleton, reused across requests
// ---------------------------------------------------------------------------
let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: process.env.AWS_REGION ?? "eu-west-1",
      // In production on EC2/ECS/Lambda, omit credentials — use instance profile
      ...(process.env.AWS_ACCESS_KEY_ID
        ? {
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
            },
          }
        : {}),
    });
  }
  return _s3;
}

const BUCKET = () => {
  const b = process.env.S3_BUCKET_NAME;
  if (!b) throw new Error("S3_BUCKET_NAME environment variable is not set");
  return b;
};

const KMS_KEY = () => {
  const k = process.env.KMS_KEY_ID;
  if (!k) throw new Error("KMS_KEY_ID environment variable is not set");
  return k;
};

// ---------------------------------------------------------------------------
// Key builder — enforces the org_id prefix on every path
// ---------------------------------------------------------------------------
export type FileType = "uploads" | "processed" | "reports";

export interface S3Key {
  orgId: string;
  fileType: FileType;
  filename: string;
}

/**
 * Builds the canonical S3 key: {org_id}/{file_type}/{filename}
 * The bucket itself is the top-level prefix (tefnut-data).
 */
export function buildS3Key({ orgId, fileType, filename }: S3Key): string {
  if (!orgId || orgId.trim() === "") throw new Error("orgId is required to build an S3 key");
  // Sanitise filename — strip path traversal attempts
  const safe = filename.replace(/\.\./g, "").replace(/^\/+/, "");
  return `${orgId}/${fileType}/${safe}`;
}

/**
 * Parses an S3 key and returns its components.
 * Throws if the key does not start with the expected orgId prefix.
 */
export function parseS3Key(key: string, expectedOrgId: string): S3Key {
  const parts = key.split("/");
  if (parts.length < 3) throw new Error(`Invalid S3 key format: ${key}`);
  const [orgId, fileType, ...rest] = parts;
  if (orgId !== expectedOrgId) {
    throw new Error(
      `S3_TENANT_VIOLATION: key org prefix "${orgId}" does not match session org "${expectedOrgId}"`,
    );
  }
  if (!["uploads", "processed", "reports"].includes(fileType)) {
    throw new Error(`Invalid file_type in S3 key: ${fileType}`);
  }
  return { orgId, fileType: fileType as FileType, filename: rest.join("/") };
}

// ---------------------------------------------------------------------------
// Upload — PUT with SSE-KMS + sha256 metadata
// ---------------------------------------------------------------------------
export interface UploadToS3Options {
  orgId: string;
  fileType: FileType;
  filename: string;
  body: Buffer | Uint8Array | ReadableStream | string;
  contentType?: string;
  sha256Hash: string;
  /** Additional metadata stored on the S3 object */
  metadata?: Record<string, string>;
}

export interface UploadResult {
  key: string;
  bucket: string;
  etag: string | undefined;
  versionId: string | undefined;
}

export async function uploadToS3(opts: UploadToS3Options): Promise<UploadResult> {
  const key = buildS3Key({ orgId: opts.orgId, fileType: opts.fileType, filename: opts.filename });

  const cmd = new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    Body: opts.body as Buffer,
    ContentType: opts.contentType ?? "application/octet-stream",
    // SSE-KMS encryption at rest
    ServerSideEncryption: "aws:kms",
    SSEKMSKeyId: KMS_KEY(),
    // Integrity metadata — stored alongside the object
    Metadata: {
      "x-tefnut-org-id": opts.orgId,
      "x-tefnut-sha256": opts.sha256Hash,
      "x-tefnut-file-type": opts.fileType,
      "x-tefnut-uploaded-at": new Date().toISOString(),
      ...opts.metadata,
    },
    // Prevent public access at the object level
    ACL: "private",
    // Checksum for in-transit integrity (SHA-256)
    ChecksumAlgorithm: "SHA256",
    ChecksumSHA256: opts.sha256Hash,
  });

  const res = await getS3().send(cmd);
  return { key, bucket: BUCKET(), etag: res.ETag, versionId: res.VersionId };
}

// ---------------------------------------------------------------------------
// Presigned GET URL — download with org_id prefix enforcement
// ---------------------------------------------------------------------------
export interface PresignedDownloadOptions {
  /** The org_id from the authenticated session */
  sessionOrgId: string;
  /** The S3 key stored in the database */
  s3Key: string;
  /** URL validity in seconds — default 900 (15 min), max 1800 (30 min) */
  expiresInSeconds?: number;
  /** Optional: verify the sha256 stored in S3 metadata matches this value */
  expectedSha256?: string;
}

export interface PresignedUrlResult {
  url: string;
  key: string;
  expiresAt: Date;
}

/**
 * Generates a presigned GET URL for a file.
 *
 * Security checks performed before issuing the URL:
 *   1. The S3 key's org_id prefix must match sessionOrgId (tenant isolation)
 *   2. If expectedSha256 is provided, the object's metadata hash is verified
 *
 * Throws if either check fails — no URL is issued.
 */
export async function getPresignedDownloadUrl(
  opts: PresignedDownloadOptions,
): Promise<PresignedUrlResult> {
  const expiresIn = Math.min(opts.expiresInSeconds ?? 900, 1800); // cap at 30 min

  // ── 1. Enforce org_id prefix ──
  parseS3Key(opts.s3Key, opts.sessionOrgId); // throws on mismatch

  // ── 2. Optional: verify sha256 from S3 metadata ──
  if (opts.expectedSha256) {
    const head = await getS3().send(
      new HeadObjectCommand({ Bucket: BUCKET(), Key: opts.s3Key }),
    );
    const storedHash = head.Metadata?.["x-tefnut-sha256"];
    if (storedHash && storedHash !== opts.expectedSha256) {
      throw new Error(
        `S3_INTEGRITY_VIOLATION: stored hash "${storedHash}" does not match expected "${opts.expectedSha256}"`,
      );
    }
  }

  // ── 3. Issue presigned URL ──
  const cmd = new GetObjectCommand({ Bucket: BUCKET(), Key: opts.s3Key });
  const url = await getSignedUrl(getS3(), cmd, { expiresIn });
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  return { url, key: opts.s3Key, expiresAt };
}

// ---------------------------------------------------------------------------
// Presigned PUT URL — upload directly from browser (multipart bypass)
// ---------------------------------------------------------------------------
export interface PresignedUploadOptions {
  sessionOrgId: string;
  fileType: FileType;
  filename: string;
  contentType: string;
  sha256Hash: string;
  expiresInSeconds?: number;
}

/**
 * Generates a presigned PUT URL so the browser can upload directly to S3.
 * The org_id prefix is baked into the key server-side — the client never
 * chooses the path.
 */
export async function getPresignedUploadUrl(
  opts: PresignedUploadOptions,
): Promise<PresignedUrlResult & { key: string }> {
  const expiresIn = Math.min(opts.expiresInSeconds ?? 900, 1800);
  const key = buildS3Key({
    orgId: opts.sessionOrgId,
    fileType: opts.fileType,
    filename: opts.filename,
  });

  const cmd = new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    ContentType: opts.contentType,
    ServerSideEncryption: "aws:kms",
    SSEKMSKeyId: KMS_KEY(),
    Metadata: {
      "x-tefnut-org-id": opts.sessionOrgId,
      "x-tefnut-sha256": opts.sha256Hash,
      "x-tefnut-file-type": opts.fileType,
    },
    ACL: "private",
    ChecksumAlgorithm: "SHA256",
    ChecksumSHA256: opts.sha256Hash,
  });

  const url = await getSignedUrl(getS3(), cmd, { expiresIn });
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  return { url, key, expiresAt };
}

// ---------------------------------------------------------------------------
// Verify object integrity — compare stored metadata hash vs expected
// ---------------------------------------------------------------------------
export async function verifyObjectIntegrity(
  sessionOrgId: string,
  s3Key: string,
  expectedSha256: string,
): Promise<{ verified: boolean; storedHash: string | null }> {
  parseS3Key(s3Key, sessionOrgId); // tenant check first

  const head = await getS3().send(
    new HeadObjectCommand({ Bucket: BUCKET(), Key: s3Key }),
  );
  const storedHash = head.Metadata?.["x-tefnut-sha256"] ?? null;
  return { verified: storedHash === expectedSha256, storedHash };
}

// ---------------------------------------------------------------------------
// Delete — only allowed for the owning org, only uploads/ and processed/
// Reports are immutable — deletion is blocked
// ---------------------------------------------------------------------------
export async function deleteObject(sessionOrgId: string, s3Key: string): Promise<void> {
  const parsed = parseS3Key(s3Key, sessionOrgId);
  if (parsed.fileType === "reports") {
    throw new Error("S3_DELETE_BLOCKED: ISO reports are immutable and cannot be deleted");
  }
  await getS3().send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: s3Key }));
}
