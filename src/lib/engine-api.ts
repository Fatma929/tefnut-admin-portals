/**
 * API client for the Carbon and Water engines.
 * Wraps fetch calls and normalises the response envelope.
 */
import type { CarbonResult, EngineResponse, WaterResult } from "./engine-types";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function post<T>(path: string, body: unknown): Promise<EngineResponse<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    return {
      result: null,
      validation: {
        status: "VALIDATION_FAILED",
        errors: detail.errors ?? [],
        warnings: detail.warnings ?? [],
      },
    };
  }

  return res.json() as Promise<EngineResponse<T>>;
}

/**
 * Upload a raw file (Excel / CSV) to an engine endpoint.
 * The server parses the file, runs validation, and returns the engine response.
 */
async function uploadFile<T>(path: string, file: File, timestampUtc: string): Promise<EngineResponse<T>> {
  const form = new FormData();
  form.append("file", file);
  form.append("timestamp_utc", timestampUtc);

  const res = await fetch(`${BASE}${path}`, { method: "POST", body: form, credentials: "include" });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    return {
      result: null,
      validation: {
        status: "VALIDATION_FAILED",
        errors: detail.errors ?? [],
        warnings: detail.warnings ?? [],
      },
    };
  }

  return res.json() as Promise<EngineResponse<T>>;
}

export const engineApi = {
  calculateCarbon: (payload: unknown) =>
    post<CarbonResult>("/api/carbon/calculate", payload),

  calculateWater: (payload: unknown) =>
    post<WaterResult>("/api/water/calculate", payload),

  uploadCarbon: (file: File, timestampUtc: string) =>
    uploadFile<CarbonResult>("/api/carbon/upload", file, timestampUtc),

  uploadWater: (file: File, timestampUtc: string) =>
    uploadFile<WaterResult>("/api/water/upload", file, timestampUtc),
};
// ---------------------------------------------------------------------------
// Persistence API — save results to D1 after calculation
// ---------------------------------------------------------------------------
export interface PersistPayload {
  type: "carbon" | "water";
  result: CarbonResult | WaterResult;
  fileHash: string;
  fileName: string;
  fileSize?: number;
  facilityId: string;
  userId?: string;
  reportingYear?: number;
}

export interface PersistResponse {
  recordIds: string[];
  isDuplicate: boolean;
  firstSeenAt?: string;
  uploadedFileId: string;
}

export async function persistResult(payload: PersistPayload): Promise<PersistResponse> {
  const res = await fetch(`${BASE}/api/persist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Persist failed: ${res.status}`);
  return res.json() as Promise<PersistResponse>;
}

export interface ArchiveReportPayload {
  report: unknown;
  reportType: string;
  facilityId: string;
  userId?: string;
  carbonRecordIds?: string[];
  waterRecordIds?: string[];
  reportingYear?: number;
}

export async function archiveReport(payload: ArchiveReportPayload): Promise<{
  reportId: string;
  sha256Hash: string;
  isDuplicate: boolean;
}> {
  const res = await fetch(`${BASE}/api/reports/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Archive failed: ${res.status}`);
  return res.json();
}

export async function fetchReportHistory(facilityId: string, year?: number): Promise<{
  reports: import("../../db/schema").GeneratedReport[];
}> {
  const params = new URLSearchParams({ facilityId });
  if (year) params.set("year", String(year));
  const res = await fetch(`${BASE}/api/reports/archive?${params}`);
  if (!res.ok) throw new Error(`History fetch failed: ${res.status}`);
  return res.json();
}
