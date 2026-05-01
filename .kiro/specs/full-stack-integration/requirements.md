# Requirements Document

## Introduction

The full-stack integration feature connects the Tefnut frontend (TanStack Start on Cloudflare Workers) to the Python calculation engines (Carbon and Water) through a consistent, well-defined API contract. It resolves six concrete gaps: the missing water engine Lambda handler, the inconsistent response envelope emitted by both Lambda handlers, the hardcoded `facilityId` in the persistence hook, the non-deterministic audit hash in the dev-path subprocess, and the undeclared Cloudflare Worker environment variable bindings.

---

## Glossary

- **System**: The Tefnut full-stack platform (frontend + API routes + Lambda handlers + Python engines).
- **CF_Worker**: The TanStack Start application running on Cloudflare Workers, hosting the `/api/*` routes.
- **Carbon_Handler**: `carbon_engine/handler.py` — the AWS Lambda entry point for the carbon engine.
- **Water_Handler**: `water_engine/handler.py` — the new AWS Lambda entry point for the water engine.
- **Carbon_Engine**: `carbon_engine/carbon_engine.py` — the GCCA-compliant CO₂ calculator (`CarbonEngine` class).
- **Water_Engine**: `water_engine/water_engine.py` — the GCCA Water KPI calculator (`WaterEngine` class).
- **EngineResponse**: The unified JSON response envelope `{ result: T | null, validation: { status, errors, warnings } }` defined in `src/lib/engine-types.ts`.
- **ValidationResult**: The Python `ValidationResult` object from `carbon_engine/validation.py`, shared by both engines.
- **Proxy_Route**: A TanStack Start API route (`api.carbon.upload.ts` or `api.water.upload.ts`) that forwards requests to Lambda in production or runs a Python subprocess in development.
- **Dev_Path**: The development code path in a Proxy_Route that invokes the Python engine via `child_process.execFile` when no Lambda URL is configured.
- **Lambda_URL**: The AWS Lambda Function URL, configured via `LAMBDA_CARBON_URL` or `LAMBDA_WATER_URL` environment variables.
- **facilityId**: A string identifier scoping a calculation result to a specific cement plant facility, sourced from the authenticated user's JWT payload.
- **AuditContext**: The `AuditContext` dataclass in `water_engine/water_engine.py` carrying `source_filename`, `upload_timestamp_utc`, and `user_id`.
- **input_hash**: A deterministic SHA-256 hex digest of the canonical JSON serialisation of an engine input dict, computed by `compute_input_hash()` in `carbon_engine/validators.py`.
- **D1**: Cloudflare D1 SQLite database used for persisting engine results.
- **wrangler.jsonc**: The Cloudflare Workers configuration file that declares environment variable bindings.

---

## Requirements

### Requirement 1: Unified Response Envelope

**User Story:** As a frontend developer, I want every engine upload endpoint to return a consistent `EngineResponse<T>` envelope, so that the client can handle success and failure uniformly without special-casing each engine.

#### Acceptance Criteria

1. WHEN a file is uploaded to `/api/carbon/upload` or `/api/water/upload`, THE CF_Worker SHALL return an HTTP 200 response whose body is a JSON object with exactly two top-level keys: `result` and `validation`.
2. THE `validation` object SHALL always contain three keys: `status` (one of `"OK"`, `"VALIDATION_FAILED"`, `"DUPLICATE_INPUT_DETECTED"`), `errors` (array, always present), and `warnings` (array, always present).
3. WHEN the Carbon_Handler or Water_Handler determines that `ValidationResult.is_blocked` is `True`, THE handler SHALL set `result` to `null` and `validation.status` to `"VALIDATION_FAILED"` in the response envelope.
4. WHEN the Carbon_Handler or Water_Handler completes a successful calculation, THE handler SHALL set `result` to the serialised engine output object and `validation.status` to `"OK"` in the response envelope.
5. WHEN the engine produces `validation_warnings` in the calculation result, THE handler SHALL include those warnings in `validation.warnings` in the response envelope.
6. THE Carbon_Handler SHALL emit the EngineResponse envelope directly — it SHALL NOT return raw `result.model_dump_json()` or `{ result, parsed_input }` as the top-level response body.

---

### Requirement 2: Water Engine Lambda Handler

**User Story:** As a platform operator, I want a Lambda handler for the water engine that mirrors the carbon handler, so that the water calculation path works identically in production without relying on a dev subprocess.

#### Acceptance Criteria

1. THE Water_Handler SHALL be implemented as `water_engine/handler.py` with a `lambda_handler(event, context)` entry point.
2. WHEN the Water_Handler receives a `POST /api/water/upload` request, THE Water_Handler SHALL accept both `multipart/form-data` and raw binary body formats.
3. WHEN the Water_Handler extracts a file from the request, THE Water_Handler SHALL parse it into a `WaterInput` object using `pandas` for Excel and CSV formats.
4. WHEN the Water_Handler has parsed the file, THE Water_Handler SHALL call `WaterEngine.validate_input(raw_dict, timestamp_utc)` before running the calculation.
5. WHEN `WaterEngine.validate_input` returns a blocked `ValidationResult`, THE Water_Handler SHALL return the EngineResponse envelope with `result=null` and `validation.status="VALIDATION_FAILED"` without running the calculation.
6. WHEN validation passes, THE Water_Handler SHALL construct an `AuditContext` from the `X-Filename`, `X-Timestamp-Utc`, and `X-User-Id` request headers and pass it to `WaterEngine(water_input, audit_ctx).calculate()`.
7. THE Water_Handler SHALL return CORS headers (`Access-Control-Allow-Origin: *`) on all responses, matching the Carbon_Handler behaviour.
8. THE Water_Handler response envelope SHALL have the same JSON shape as the Carbon_Handler response envelope for equivalent valid and invalid inputs.

---

### Requirement 3: Audit Hash Determinism

**User Story:** As an auditor, I want the `input_hash` in every engine result's audit trail to be a deterministic SHA-256 digest, so that duplicate detection and audit trail verification work correctly across all code paths.

#### Acceptance Criteria

1. WHEN the Dev_Path subprocess computes the `input_hash` for a carbon calculation, THE Dev_Path SHALL use `compute_input_hash(raw_dict)` from `carbon_engine.validators` — not Python's built-in `str.__hash__()`.
2. WHEN `compute_input_hash` is called with the same input dict, THE Carbon_Engine SHALL return the same SHA-256 hex string on every invocation, regardless of process, runtime, or key insertion order.
3. WHEN the Water_Handler computes the `input_hash` via `WaterEngine._build_audit_trail()`, THE Water_Handler SHALL produce the same hash as `compute_input_hash` would produce for the same logical input data.

---

### Requirement 4: Dynamic `facilityId` Resolution

**User Story:** As a facility manager, I want calculation results to be persisted under my facility's ID from my JWT token, so that results are correctly scoped to my facility and not stored under a generic placeholder.

#### Acceptance Criteria

1. WHEN `useEngineUpload` calls `persistResult()` after a successful engine response, THE hook SHALL pass `user.facilityId` from `useAuth()` as the `facilityId` parameter — not the hardcoded string `"default"`.
2. WHEN the authenticated user's `facilityId` is `null`, THE hook SHALL pass `"default"` as the `facilityId` fallback.
3. THE `useEngineUpload` hook SHALL import and call `useAuth()` to obtain the current user's `facilityId`.

---

### Requirement 5: Cloudflare Worker Environment Bindings

**User Story:** As a developer deploying to Cloudflare Workers, I want `LAMBDA_CARBON_URL` and `LAMBDA_WATER_URL` declared in `wrangler.jsonc`, so that the Worker runtime can access these variables and the proxy routes function correctly in production.

#### Acceptance Criteria

1. THE `wrangler.jsonc` file SHALL declare `LAMBDA_CARBON_URL` and `LAMBDA_WATER_URL` under the `vars` key.
2. WHEN `LAMBDA_CARBON_URL` is set to a non-empty string in the Worker environment, THE `/api/carbon/upload` route SHALL proxy the request to that URL instead of invoking the Dev_Path subprocess.
3. WHEN `LAMBDA_WATER_URL` is set to a non-empty string in the Worker environment, THE `/api/water/upload` route SHALL proxy the request to that URL instead of invoking the Dev_Path subprocess.
4. WHERE local development is required, THE System SHALL support a `.dev.vars` file for setting `LAMBDA_CARBON_URL` and `LAMBDA_WATER_URL` without committing secrets to source control.

---

### Requirement 6: Water Proxy Route Lambda URL

**User Story:** As a platform operator, I want the water upload proxy route to use a dedicated `LAMBDA_WATER_URL` environment variable, so that the carbon and water Lambda functions can be deployed and scaled independently.

#### Acceptance Criteria

1. WHEN `LAMBDA_WATER_URL` is set, THE `/api/water/upload` route SHALL proxy to `${LAMBDA_WATER_URL}/api/water/upload`.
2. WHEN `LAMBDA_WATER_URL` is not set but `LAMBDA_CARBON_URL` is set, THE `/api/water/upload` route SHALL NOT fall back to `LAMBDA_CARBON_URL` — it SHALL use the Dev_Path subprocess instead.
3. WHEN the Water_Handler Lambda is proxied, THE Proxy_Route SHALL forward the `Content-Type`, `X-Filename`, `X-User-Id`, and `X-Org-Id` headers to the Lambda.

---

### Requirement 7: Error Handling and Observability

**User Story:** As a developer, I want all failure modes in the upload pipeline to produce structured, actionable error responses, so that I can diagnose problems without inspecting raw stack traces.

#### Acceptance Criteria

1. WHEN the Lambda function URL is unreachable, THE Proxy_Route SHALL return HTTP 503 with an EngineResponse envelope containing `result=null`, `validation.status="VALIDATION_FAILED"`, and an error with `error_code="ENGINE_UNAVAILABLE"`.
2. WHEN the Dev_Path subprocess fails (Python not found, script error, parse error), THE Proxy_Route SHALL return HTTP 503 with the same `ENGINE_UNAVAILABLE` envelope structure.
3. WHEN the Carbon_Handler or Water_Handler encounters an unhandled exception during calculation, THE handler SHALL return HTTP 500 with `{ "error": "Internal server error" }`.
4. WHEN the D1 persist call fails after a successful engine response, THE System SHALL log the error to the console and SHALL NOT change the upload status shown to the user.
5. IF the request to `/api/carbon/upload` or `/api/water/upload` does not include a valid JWT, THEN THE CF_Worker SHALL return HTTP 401 with `{ "error": "Authentication required" }` before forwarding to Lambda.
