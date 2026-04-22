# Implementation Plan: Bulletproof Validation Layer

## Overview

Upgrade `carbon_engine/validation.py` and `carbon_engine/validators.py` to the full Pydantic V2 error-contract design, wire both engines to the new pipeline, and update `handler.py` to return 422 on blocked validation and embed warnings in 200 responses.

## Tasks

- [ ] 1. Upgrade `carbon_engine/validation.py` — Pydantic V2 error contract models
  - Replace the existing dataclass-based `ValidationIssue` / `ValidationResult` with Pydantic V2 `ErrorDetail`, `WarningDetail`, and `ValidationResult` models as specified in the design
  - Add `is_blocked` field to `ValidationResult`; update `add_error` to set both `is_valid = False` and `is_blocked = True` for blocker codes
  - Expand `ValidationCode` enum to include all codes: `DUPLICATE_SUBMISSION`, `CRITICAL_DATA_ERROR`, `NEGATIVE_CONSUMPTION_ERROR`, `INCONSISTENT_FUEL_DATA`, `INCONSISTENT_PROCESS_DATA` (removing `LOGICAL_DATA_ERROR` and `DUPLICATE_INPUT_DETECTED`)
  - Add `suggested_fix` field to `ErrorDetail` and `WarningDetail`; populate it for every code via a helper map
  - Add `to_response_dict()` method to `ValidationResult`
  - _Requirements: 9.1, 9.2, 9.4, 9.5, 9.6_

- [ ] 2. Upgrade `carbon_engine/validators.py` — DuplicateRegistry and all validator functions
  - [ ] 2.1 Implement `DuplicateRegistry` class with `check_and_register()` and `clear()` methods, replacing the module-level `_SEEN_HASHES` dict; keep a `_DEFAULT_REGISTRY` singleton
    - _Requirements: 6.1, 6.2, 6.3, 13.1, 13.3_
  - [ ]* 2.2 Write property test for `DuplicateRegistry` — Property 7: Duplicate submission is detected, blocked, and returns first-seen metadata
    - **Property 7: Duplicate submission is detected, blocked, and returns first-seen metadata**
    - **Validates: Requirements 6.2, 6.3, 13.1, 13.3, 13.6**
  - [ ] 2.3 Upgrade `validate_schema()` to map Pydantic V2 errors to the new `ErrorDetail` / `WarningDetail` models with `suggested_fix` populated; map enum errors to `INVALID_CATEGORY` with `meta.submitted` and `meta.allowed`; map list-field errors to include `meta.row`
    - _Requirements: 1.1, 1.2, 1.4, 7.1, 7.2, 7.3_
  - [ ] 2.4 Upgrade `validate_no_negatives()` to include the submitted value in `meta` block of each `ErrorDetail`
    - _Requirements: 2.1, 2.2, 2.3_
  - [ ] 2.5 Upgrade `validate_duplicate()` to accept an optional `DuplicateRegistry` parameter (defaulting to `_DEFAULT_REGISTRY`), return a blocker `ErrorDetail` with `DUPLICATE_SUBMISSION` code and `meta` containing `first_seen_timestamp` and `original_input_hash`
    - _Requirements: 6.2, 6.3, 13.1, 13.6_
  - [ ]* 2.6 Write property test for `compute_input_hash` — Property 6: Input hash is deterministic
    - **Property 6: Input hash is deterministic**
    - **Validates: Requirements 6.1, 6.5, 13.2, 13.5**
  - [ ] 2.7 Add `validate_production_scale()` function that checks `cement_production_t_yr`, `clinker_production_t_yr`, and `cementitious_production_t_yr` against `Production_Scale_Min` (10) and `Production_Scale_Max` (10,000,000), returning `UNIT_MISMATCH_SUSPECTED` warnings with the submitted value in `meta`
    - _Requirements: 11.1, 11.2, 11.5_
  - [ ] 2.8 Upgrade `validate_water_units()` to also check `quarry_water_not_used_m3_yr`, `recycled_water_m3_yr`, and `storm_water_collected_discharged_m3_yr` against the `Unit_Mismatch_Threshold`; update `validate_water_logic()` to use `NEGATIVE_CONSUMPTION_ERROR` code instead of `LOGICAL_DATA_ERROR`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 10.3, 10.4_
  - [ ]* 2.9 Write property test for missing-field detection — Property 1: Missing required fields are all reported
    - **Property 1: Missing required fields are all reported**
    - **Validates: Requirements 1.1, 1.2, 1.4**
  - [ ]* 2.10 Write property test for negative value detection — Property 2: Negative numeric values are all reported with submitted value in meta
    - **Property 2: Negative numeric values are all reported with submitted value in meta**
    - **Validates: Requirements 2.1, 2.2, 2.3**
  - [ ]* 2.11 Write property test for enum validation — Property 8: Invalid enum values produce INVALID_CATEGORY errors with allowed-values list
    - **Property 8: Invalid enum values produce INVALID_CATEGORY errors with allowed-values list**
    - **Validates: Requirements 7.1, 7.2, 7.3, 8.2, 8.3**
  - [ ]* 2.12 Write property test for error round-trip — Property 9: Every error response round-trips through JSON without data loss
    - **Property 9: Every error response round-trips through JSON without data loss**
    - **Validates: Requirements 9.1, 9.2, 9.4, 9.5, 9.6**

- [ ] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Add `WaterSource` enum to `water_engine/water_engine.py`
  - Define `WaterSource(str, Enum)` with members: `SURFACE_WATER`, `GROUNDWATER`, `QUARRY_WATER_USED`, `MUNICIPAL_POTABLE_WATER`, `EXTERNAL_WASTEWATER`, `HARVESTED_RAINWATER`
  - Add a `validate_water_sources()` function in `validators.py` that checks a dynamic key-value map against `WaterSource` members and returns `INVALID_CATEGORY` errors with `meta.submitted` and `meta.allowed`
  - _Requirements: 8.1, 8.2, 8.3_

- [ ] 5. Integrate pre-calc validation into `CarbonEngine.validate_input()`
  - Update `CarbonEngine.validate_input()` to call the upgraded validators in order: schema → negatives → production scale → duplicate detection (with optional `registry` parameter)
  - Ensure the method returns a `ValidationResult` with `is_blocked = True` when any blocker error is present
  - _Requirements: 1.3, 2.2, 6.4, 11.1, 11.5, 13.4_

- [ ] 6. Integrate pre-calc validation into `WaterEngine.validate_input()`
  - Update `WaterEngine.validate_input()` to call: schema → negatives → production scale (`cementitious_production_t_yr`) → water unit mismatch (withdrawal + ancillary fields) → water source enum check → duplicate detection
  - Ensure the method returns a `ValidationResult` with `is_blocked = True` when any blocker error is present
  - _Requirements: 1.3, 2.2, 5.1, 5.4, 6.4, 8.3, 11.2, 11.5, 13.4_

- [ ] 7. Add post-calc checks to `CarbonEngine.calculate()`
  - [ ] 7.1 Add `CRITICAL_DATA_ERROR` check: after computing `specific_co2_kg_per_t_cement`, if value < 100 or > 2000, append a blocker `ErrorDetail` to the result's `validation_result` and return `None` for the result field (or raise a sentinel that the handler converts to a 422)
    - _Requirements: 10.1, 10.2, 10.5_
  - [ ] 7.2 Add `INCONSISTENT_FUEL_DATA` check: if total fuel consumption > 0 and fuel combustion CO₂ = 0, append `INCONSISTENT_FUEL_DATA` warning with the computed fuel CO₂ in `meta`
    - _Requirements: 12.1, 12.4_
  - [ ] 7.3 Add `INCONSISTENT_PROCESS_DATA` check: if `clinker_production_t_yr` > 0 and calcination CO₂ = 0, append `INCONSISTENT_PROCESS_DATA` warning with the computed calcination CO₂ in `meta` and the active calcination method field name
    - _Requirements: 12.2, 12.4_
  - [ ] 7.4 Ensure both inter-field checks run without short-circuiting (both warnings appended when both conditions hold)
    - _Requirements: 12.5_
  - [ ]* 7.5 Write property test for CO₂ out-of-industry-range — Property 4: CO₂ out-of-industry-range triggers warning; in-range produces no warning
    - **Property 4: CO₂ out-of-industry-range triggers warning; in-range produces no warning**
    - **Validates: Requirements 4.1, 4.3**
  - [ ]* 7.6 Write property test for critical CO₂ limits — Property 10: CO₂ outside hard physical limits halts calculation
    - **Property 10: CO₂ outside hard physical limits halts calculation**
    - **Validates: Requirements 10.1, 10.2**
  - [ ]* 7.7 Write property test for inter-field consistency — Property 12: Inter-field inconsistencies are all reported without short-circuiting
    - **Property 12: Inter-field inconsistencies are all reported without short-circuiting**
    - **Validates: Requirements 12.1, 12.2, 12.4, 12.5**

- [ ] 8. Add post-calc checks to `WaterEngine.calculate()`
  - [ ] 8.1 Replace the existing `validate_water_logic()` call with the upgraded version that uses `NEGATIVE_CONSUMPTION_ERROR`; ensure the clamped `0.0` consumption value is returned alongside the warning
    - _Requirements: 10.3, 10.4_
  - [ ]* 8.2 Write property test for water discharge > withdrawal — Property 3: Water discharge exceeding withdrawal raises non-blocking error and clamps consumption
    - **Property 3: Water discharge exceeding withdrawal raises non-blocking error and clamps consumption**
    - **Validates: Requirements 3.1, 3.2, 10.3, 10.4**
  - [ ]* 8.3 Write property test for water unit mismatch — Property 5: Water volume fields exceeding threshold trigger non-blocking unit-mismatch warning
    - **Property 5: Water volume fields exceeding threshold trigger non-blocking unit-mismatch warning**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 11.3, 11.4**
  - [ ]* 8.4 Write property test for production scale — Property 11: Production values outside plausible range trigger non-blocking unit-mismatch warning
    - **Property 11: Production values outside plausible range trigger non-blocking unit-mismatch warning**
    - **Validates: Requirements 11.1, 11.2, 11.5**

- [ ] 9. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Update `handler.py` to use the new validation pipeline
  - In `_handle_json()`: call `CarbonEngine.validate_input(body, timestamp_utc)` before constructing `PlantInput`; if `result.is_blocked`, return `_err(422, ...)` with `result.to_response_dict()` as the detail body
  - In `_handle_upload()`: call `CarbonEngine.validate_input(parsed_raw_dict, timestamp_utc)` after parsing the file; apply the same 422 gate
  - Embed `validation_warnings` from the `CalculationResult` into the 200 response body under a `"validation"` key
  - Ensure no Python tracebacks are serialised into any response body
  - _Requirements: 9.2, 9.4, 10.1, 10.2_

- [ ] 11. Write unit tests in `carbon_engine/tests/test_validation.py`
  - Test each `ValidationCode` with a concrete minimal example (one test per error code)
  - Test `DuplicateRegistry.check_and_register()`: first call returns `None`, second call returns the first-seen timestamp
  - Test `compute_input_hash()` with two known inputs to verify determinism and distinctness
  - Test that `suggested_fix` is non-null and non-empty for every `ValidationCode` member
  - Test handler integration: mock `CarbonEngine.validate_input` returning a blocked result → assert 422; returning warnings only → assert 200 with warnings in body
  - _Requirements: 6.1, 6.2, 9.6, 13.1, 13.2_

- [ ] 12. Write Hypothesis property-based tests in `carbon_engine/tests/test_validation_pbt.py`
  - Implement all property test sub-tasks deferred from tasks 2 and 7 (Properties 1, 2, 4, 6, 7, 8, 9, 10, 12) using `@settings(max_examples=100)` and the tag format `# Feature: bulletproof-validation-layer, Property N: ...`
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 4.1, 4.3, 6.1, 6.2, 7.1, 9.1, 10.1, 12.1, 12.2_

- [ ] 13. Write water engine validation tests in `water_engine/tests/test_water_validation.py`
  - Implement all property test sub-tasks deferred from task 8 (Properties 3, 5, 11) using `@settings(max_examples=100)`
  - Add unit tests for `WaterSource` enum enforcement (Requirement 8), `validate_water_units()` with ancillary fields, and the `NEGATIVE_CONSUMPTION_ERROR` clamping behaviour
  - _Requirements: 3.1, 3.2, 5.1, 5.4, 8.1, 8.2, 8.3, 10.3, 10.4, 11.2_

- [ ] 14. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties defined in the design document
- Unit tests validate specific examples and edge cases
- The `DuplicateRegistry` singleton is shared across both engines by default; tests should inject a fresh instance to avoid cross-test contamination
