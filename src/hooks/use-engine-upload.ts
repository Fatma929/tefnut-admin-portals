/**
 * useEngineUpload
 *
 * Manages the full file-to-engine flow:
 *   1. User picks a file via hidden <input type="file">
 *   2. SHA-256 hash computed client-side for instant duplicate pre-check
 *   3. File POSTed to the engine upload endpoint
 *   4. Validation errors surfaced; success state updates dashboard data
 *
 * Usage:
 *   const { inputRef, trigger, status, errors, warnings, result } = useEngineUpload("carbon")
 *   <input ref={inputRef} ... />
 *   <Button onClick={trigger}>Upload</Button>
 */
import { useRef, useState } from "react";
import { engineApi, persistResult } from "@/lib/engine-api";
import { useAuth } from "@/lib/auth-context";
import type { CarbonResult, ValidationDetail, WaterResult } from "@/lib/engine-types";

export type EngineType = "carbon" | "water";
export type UploadStatus = "idle" | "hashing" | "uploading" | "success" | "error";

export interface UploadState<T> {
  status: UploadStatus;
  result: T | null;
  errors: ValidationDetail[];
  warnings: ValidationDetail[];
  /** The client-side SHA-256 hash of the raw file bytes */
  fileHash: string | null;
  fileName: string | null;
}

type UploadResult = CarbonResult | WaterResult;

/** Compute SHA-256 of a File using the Web Crypto API */
async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function useEngineUpload<T extends UploadResult>(engine: EngineType) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  const [state, setState] = useState<UploadState<T>>({
    status: "idle",
    result: null,
    errors: [],
    warnings: [],
    fileHash: null,
    fileName: null,
  });

  /** Programmatically open the file picker */
  const trigger = () => {
    // Reset value so the same file can be re-selected after a correction
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();
    }
  };

  /** Called by the hidden <input onChange> */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const timestampUtc = new Date().toISOString();

    // ── Step 1: client-side SHA-256 hash (instant duplicate pre-check) ──
    setState((s) => ({ ...s, status: "hashing", fileName: file.name, errors: [], warnings: [] }));
    let fileHash: string;
    try {
      fileHash = await hashFile(file);
    } catch {
      setState((s) => ({
        ...s,
        status: "error",
        errors: [{
          error_code: "CLIENT_HASH_ERROR",
          field: "file",
          message: "Could not compute file hash. Please try again.",
          suggested_fix: "Ensure the file is not corrupted and try re-uploading.",
          meta: {},
        }],
      }));
      return;
    }

    // ── Step 2: POST to engine upload endpoint ──
    setState((s) => ({ ...s, status: "uploading", fileHash }));
    try {
      const response = engine === "carbon"
        ? await engineApi.uploadCarbon(file, timestampUtc)
        : await engineApi.uploadWater(file, timestampUtc);

      const validation = response.validation;

      if (validation.status === "VALIDATION_FAILED" || validation.errors.length > 0) {
        setState((s) => ({
          ...s,
          status: "error",
          errors: validation.errors,
          warnings: validation.warnings,
          result: null,
        }));
        return;
      }

      if (validation.status === "DUPLICATE_INPUT_DETECTED") {
        // Surface as a warning, not a hard error — let the user decide
        setState((s) => ({
          ...s,
          status: "error",
          errors: validation.errors,
          warnings: validation.warnings,
          result: response.result as T | null,
        }));
        return;
      }

      // ── Step 3: Success — persist to D1, then update UI state ──
      // Fire-and-forget: persist runs in background, doesn't block the UI
      if (response.result) {
        persistResult({
          type: engine,
          result: response.result,
          fileHash,
          fileName: file.name,
          fileSize: file.size,
          facilityId: user?.facilityId ?? "default",
        }).catch((err) => console.warn("[persist] D1 save failed:", err));
      }

      setState({
        status: "success",
        result: response.result as T,
        errors: [],
        warnings: validation.warnings,
        fileHash,
        fileName: file.name,
      });
    } catch {
      setState((s) => ({
        ...s,
        status: "error",
        errors: [{
          error_code: "NETWORK_ERROR",
          field: "file",
          message: "Could not reach the calculation engine. Check your connection.",
          suggested_fix: "Verify the API server is running and try again.",
          meta: {},
        }],
      }));
    }
  };

  const reset = () =>
    setState({ status: "idle", result: null, errors: [], warnings: [], fileHash: null, fileName: null });

  return { inputRef, trigger, handleFileChange, reset, ...state };
}
