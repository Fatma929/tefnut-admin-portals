# Implementation Plan: Full-Stack Integration

## Overview

Wire the Tefnut frontend to both Python calculation engines through a consistent `EngineResponse<T>` envelope. The work spans five areas: fixing `ValidationResult.to_response_dict()`, refactoring `carbon_engine/handler.py`, creating `water_engine/handler.py`, patching the frontend hook and proxy routes, and declaring Cloudflare Worker environment bindings.

Each task builds on the previous one. The carbon handler refactor (Task 2) depends on the validation fix (Task 1). The water handler (Task 3) mirrors the carbon handler and can be written in parallel once Task 1 is done. Frontend and config tasks (Tasks 4–6) are independent of each other and of Tasks 1–3.

## Tasks

- [x] 1. Fix `ValidationResult.to_response_dict()` to always include `errors` key
  - In `carbon_engine/validation.py`, update the `to_response_dict()` method on `ValidationResult`
  - The success branch currently returns `{ "status": "OK", "warnings": [...] }` — add `"errors": []` so the key is always present
  - The failure branch already includes `errors`; no change needed there
  - This fix is consumed by both Lambda handlers and all proxy routes
  - _Requirements: 1.1, 1.2_

  - [ ]* 1.1 Write property test for envelope key invariant
    - **Property 1: Envelope shape invariant** — `to_response_dict()` MUST always return a dict with keys `status`, `errors`, and `warnings` regardless of `is_blocked` value
    - Use `hypothesis` with `@given(st.booleans())` to drive `is_blocked`
    - **Validates: Requirements 1.1, 1.2**

- [x] 2. Refactor `carbon_engine/handler.py` to emit the `EngineResponse` envelope
  - [x] 2.1 Add `_engine_response()` and `_extract_header()` helpers
    - Add `_engine_response(result_dict: dict | None, validation: ValidationResult) -> dict` that builds `{ "result": result_dict, "validation": validation.to_response_dict() }`
    - Add `_extract_header(event: dict, name: str) -> str | None` that does a case-insensitive header lookup over `event.get("headers") or {}`
    - Import `ValidationResult` and `WarningDetail` from `carbon_engine.validation`
    - _Requirements: 1.1, 1.2_

  - [x] 2.2 Refactor `_handle_json` to call `validate_input()` and return the envelope
    - Import `CarbonEngine.validate_input` (already a classmethod on `CarbonEngine`)
    - After parsing the JSON body into a raw dict, call `CarbonEngine.validate_input(raw_dict, timestamp_utc)` where `timestamp_utc` is extracted via `_extract_header(event, "x-timestamp-utc")` with a UTC fallback
    - If `validation.is_blocked`, return `_ok(_engine_response(None, validation))`
    - Otherwise construct `PlantInput`, run `CarbonEngine(plant_input).calculate()`, merge `result.validation_warnings` into `validation.warnings`, and return `_ok(_engine_response(json.loads(result.model_dump_json()), validation))`
    - Remove the old `return _ok(result.model_dump_json())` line
    - _Requirements: 1.3, 1.4, 1.5, 1.6_

  - [x] 2.3 Refactor `_handle_upload` to call `validate_input()` and return the envelope
    - Replace the existing header-extraction loops with `_extract_header()` calls for `content-type`, `x-filename`, `x-timestamp-utc`, and `x-user-id`
    - After `parse_file()` succeeds, call `CarbonEngine.validate_input(json.loads(plant_input.model_dump_json()), timestamp_utc)` to get a `ValidationResult`
    - If `validation.is_blocked`, return `_ok(_engine_response(None, validation))` without running the calculation
    - After `CarbonEngine(plant_input).calculate()`, merge `result.validation_warnings` into `validation.warnings` via `validation.warnings.append(WarningDetail(**w))`
    - Return `_ok(_engine_response(json.loads(result.model_dump_json()), validation))` — drop the old `parsed_input` field
    - _Requirements: 1.3, 1.4, 1.5, 1.6_

  - [ ]* 2.4 Write property tests for carbon handler envelope
    - **Property 2: Null result on validation failure** — for any event that causes `validate_input` to return `is_blocked=True`, the handler response body MUST have `result=null` and `validation.status="VALIDATION_FAILED"`
    - **Property 3: Non-null result on success** — for any valid event, the handler response body MUST have a non-null `result` and `validation.status="OK"`
    - Use `hypothesis` with synthesised Lambda event dicts; mock `CarbonEngine.validate_input` and `CarbonEngine.calculate` to control outcomes
    - **Validates: Requirements 1.3, 1.4, 2.5, 2.6**

  - [ ]* 2.5 Write unit tests for `_handle_upload` and `_handle_json`
    - Test success path: assert response body matches `{ result: {...}, validation: { status: "OK", errors: [], warnings: [...] } }`
    - Test blocked-validation path: assert `result` is `null` and `status` is `"VALIDATION_FAILED"`
    - Test missing file: assert HTTP 400
    - Test parse error: assert HTTP 422
    - _Requirements: 1.3, 1.4, 1.5, 1.6_

- [x] 3. Create `water_engine/handler.py` Lambda handler
  - [x] 3.1 Create the file with module-level helpers and CORS constants
    - Create `water_engine/handler.py`
    - Add `_CORS_HEADERS`, `_ok()`, `_err()`, `_engine_response()`, and `_extract_header()` — identical in structure to the carbon handler equivalents
    - Import `WaterEngine`, `WaterInput`, `WaterWithdrawal`, `WaterDischarge`, `AuditContext` from `water_engine.water_engine`
    - Import `ValidationResult`, `WarningDetail` from `carbon_engine.validation`
    - _Requirements: 2.1, 2.7, 2.8_

  - [x] 3.2 Implement `_parse_water_input_from_file(file_bytes, filename)`
    - Accept `(file_bytes: bytes, filename: str) -> tuple[dict, WaterInput]`
    - Use `pandas.read_excel` for `.xlsx`/`.xls` and `pandas.read_csv` otherwise
    - Read the first row (`df.iloc[0].to_dict()`) and map columns to `WaterWithdrawal` and `WaterDischarge` fields using the helper `g(k, default=0.0)` pattern from the design
    - Build and return `(raw_dict, WaterInput(...))` so the caller can pass `raw_dict` to `validate_input()`
    - _Requirements: 2.3_

  - [x] 3.3 Implement `_handle_upload(event)`
    - Extract `content-type`, `x-filename`, `x-user-id`, and `x-timestamp-utc` headers via `_extract_header()`; apply UTC fallback for timestamp
    - Decode the body: base64-decode if `isBase64Encoded=True`, otherwise use raw bytes
    - If `content-type` contains `multipart/form-data`, use `cgi.FieldStorage` to extract the `file` part; otherwise treat the whole body as the file
    - Call `_parse_water_input_from_file(file_bytes, filename)`; return `_err(422, ...)` on parse failure
    - Call `WaterEngine.validate_input(raw_dict, timestamp_utc)`; if `is_blocked`, return `_ok(_engine_response(None, validation))`
    - Construct `AuditContext(source_filename=filename, upload_timestamp_utc=timestamp_utc, user_id=user_id)` and call `WaterEngine(water_input, audit_ctx).calculate()`
    - Merge `result.validation_warnings` into `validation.warnings`
    - Return `_ok(_engine_response(json.loads(result.model_dump_json()), validation))`
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 3.4 Implement `lambda_handler(event, context)` entry point
    - Wrap `_handle_upload(event)` in a try/except; log and return `_err(500, "Internal server error")` on unhandled exceptions
    - Log the request path at INFO level
    - _Requirements: 2.1_

  - [ ]* 3.5 Write property tests for water handler envelope
    - **Property 2: Null result on validation failure** — same property as 2.4 but for the water handler; use synthesised events with blocked `WaterEngine.validate_input` mock
    - **Property 3: Non-null result on success** — same property as 2.4 but for the water handler
    - **Property 7: Water and carbon handler envelope parity** — given structurally equivalent valid inputs for both engines, assert the top-level JSON keys and `validation` object keys are identical between the two handlers
    - **Validates: Requirements 2.5, 2.6, 2.8**

  - [ ]* 3.6 Write unit tests for `_parse_water_input_from_file` and `_handle_upload`
    - Test `_parse_water_input_from_file` with an in-memory `openpyxl` workbook written to a `BytesIO` buffer
    - Test `_handle_upload` success path with a minimal multipart event
    - Test `_handle_upload` with raw binary body (no multipart)
    - Test empty body returns HTTP 400
    - _Requirements: 2.2, 2.3, 2.4_

- [x] 4. Checkpoint — ensure Python tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Fix `src/hooks/use-engine-upload.ts` — dynamic `facilityId`
  - Add `import { useAuth } from "@/lib/auth-context";` at the top of the file
  - Inside `useEngineUpload()`, call `const { user } = useAuth();`
  - In the `persistResult()` call inside `handleFileChange`, replace `facilityId: "default"` with `facilityId: user?.facilityId ?? "default"`
  - Remove the inline comment `// replace with real facilityId from auth context`
  - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 5.1 Write property test for `facilityId` propagation
    - **Property 5: facilityId propagation** — for any authenticated user with a non-null `facilityId`, every `persistResult()` call triggered by the hook MUST receive that exact `facilityId` — never the string `"default"`
    - Use `fast-check` with `fc.string()` to generate arbitrary `facilityId` values; mock `useAuth` and `persistResult`
    - **Validates: Requirements 4.1, 4.3**

  - [ ]* 5.2 Write unit tests for `useEngineUpload` `facilityId` resolution
    - Test that when `user.facilityId` is `"plant-42"`, `persistResult` is called with `facilityId: "plant-42"`
    - Test that when `user` is `null`, `persistResult` is called with `facilityId: "default"`
    - _Requirements: 4.1, 4.2_

- [x] 6. Fix `src/routes/api.water.upload.ts` — remove `LAMBDA_CARBON_URL` fallback
  - Change `const lambdaUrl = process.env.LAMBDA_WATER_URL ?? process.env.LAMBDA_CARBON_URL;` to `const lambdaUrl = process.env.LAMBDA_WATER_URL;`
  - Verify the proxy `fetch` URL is already `${lambdaUrl}/api/water/upload` (not `/api/calculate/upload`) — no change needed there
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 7. Fix `src/routes/api.carbon.upload.ts` — deterministic audit hash in dev path
  - In the inline Python script string, replace the `input_hash` computation:
    - Remove: `'input_hash': plant_input.model_dump_json().__hash__().__str__()`
    - Add import at the top of the script: `from carbon_engine.validators import compute_input_hash`
    - After `plant_input = parse_file(data, sys.argv[2])`, add `raw_dict = json.loads(plant_input.model_dump_json())`
    - Set `'input_hash': compute_input_hash(raw_dict)` in the `audit_trail` dict
  - _Requirements: 3.1, 3.2_

  - [ ]* 7.1 Write property test for audit hash determinism
    - **Property 4: Audit hash determinism** — for any `PlantInput` dict, `compute_input_hash()` MUST return the same SHA-256 hex string on every call regardless of key insertion order
    - Use `hypothesis` with `@given(st.dictionaries(...))` to generate arbitrary dicts; assert `compute_input_hash(d) == compute_input_hash(dict(reversed(d.items())))`
    - **Validates: Requirements 3.1, 3.2**

- [x] 8. Add `vars` block to `wrangler.jsonc` and create `.dev.vars`
  - [x] 8.1 Add `vars` block to `wrangler.jsonc`
    - Add a `"vars"` key at the top level of `wrangler.jsonc` with `"LAMBDA_CARBON_URL": ""` and `"LAMBDA_WATER_URL": ""`
    - These are placeholder values; production values are set via `wrangler secret put`
    - _Requirements: 5.1_

  - [x] 8.2 Create `.dev.vars` example file
    - Create `.dev.vars` at the workspace root with placeholder values:
      ```
      LAMBDA_CARBON_URL=http://localhost:9000
      LAMBDA_WATER_URL=http://localhost:9001
      ```
    - Verify `.dev.vars` is already listed in `.gitignore`; if not, add it
    - _Requirements: 5.4_

- [x] 9. Verify `water_engine/requirements.txt` includes `pandas` and `openpyxl`
  - Confirm `pandas` and `openpyxl` are present with pinned versions in `water_engine/requirements.txt`
  - Both are already listed (`pandas==3.0.2`, `openpyxl==3.1.5`); no change needed unless versions are missing
  - _Requirements: 2.3_

- [x] 10. Checkpoint — wire everything together and verify envelope parity
  - [x] 10.1 Verify the carbon proxy route normalisation is consistent with the new Lambda envelope
    - In `src/routes/api.carbon.upload.ts`, the production branch currently normalises `data.result ?? data` — update it to pass `data.result` directly now that the Lambda emits the full envelope, and forward `data.validation` as-is instead of reconstructing it
    - _Requirements: 1.1, 1.2, 1.5_

  - [x] 10.2 Verify the water proxy route normalisation is consistent with the new Lambda envelope
    - Apply the same normalisation fix to `src/routes/api.water.upload.ts` production branch: pass `data.result` and `data.validation` directly from the Lambda response
    - _Requirements: 1.1, 1.2, 1.5_

  - [ ]* 10.3 Write property test for validation warnings round-trip
    - **Property 6: Validation warnings round-trip** — for any engine result containing `validation_warnings`, those warnings MUST appear in `validation.warnings` in the final response envelope and MUST NOT be dropped
    - Test both the Python handler layer (unit) and the TypeScript proxy normalisation layer
    - **Validates: Requirements 1.5**

- [ ] 11. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Task 1 must be completed before Tasks 2 and 3, as both handlers call `to_response_dict()`
- Tasks 5, 6, 7, and 8 are independent of each other and of the Python tasks — they can be done in any order
- Task 9 is a verification step; `water_engine/requirements.txt` already has the correct entries
- Property tests use `hypothesis` (Python) and `fast-check` (TypeScript) — both are already in the respective `requirements.txt` and `package.json`
- The `parsed_input` field is intentionally dropped from the carbon Lambda response in Task 2; the proxy route already discards it
