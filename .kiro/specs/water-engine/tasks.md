# Implementation Plan: Water Engine

## Overview

Implement `water_engine.py` as a standalone GCCA-compliant water KPI calculation module, mirroring the Audit-Ready Carbon Engine architecture. The module exposes Pydantic input/output models, a `WaterEngine` class with a `calculate()` method, and is covered by property-based tests (Hypothesis) and unit tests.

## Tasks

- [x] 1. Define Pydantic models in `water_engine.py`
  - Create `water_engine/water_engine.py` (or `water_engine.py` at the same level as `carbon_engine/`)
  - Implement `WaterWithdrawal` with 6 fields (`surface_water`, `groundwater`, `quarry_water_used`, `municipal_potable_water`, `external_wastewater`, `harvested_rainwater`), all `float = Field(0.0, ge=0)`
  - Implement `WaterDischarge` with 5 fields (`ocean`, `surface_water`, `subsurface_well`, `offsite_water_treatment`, `beneficial_other_users`), all `float = Field(0.0, ge=0)`
  - Implement `WaterInput` with `withdrawal`, `discharge`, `quarry_water_not_used_m3_yr`, `recycled_water_m3_yr`, `storm_water_collected_discharged_m3_yr`, and `cementitious_production_t_yr` (required, `gt=0`)
  - Implement `SourceReference`, `AuditTrail`, `MethodologyTag` (with `field_validator` enforcing `^\d+\.\d+$`), `CalculationStep`, and `WaterResult` output models
  - Implement `AuditContext` dataclass with `source_filename`, `upload_timestamp_utc`, and `user_id = "anonymous"`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 6.1, 7.1–7.4, 8.2, 9.1, 9.2, 10.1, 10.2, 10.3_

- [x] 2. Implement `WaterEngine` class and `calculate()` method
  - [x] 2.1 Implement `WaterEngine.__init__` — accept `WaterInput` and `AuditContext`; raise `ValueError("upload_timestamp_utc is required for audit trail")` if `audit_context.upload_timestamp_utc` is empty/missing
    - _Requirements: 9.4_

  - [x] 2.2 Implement `_compute_withdrawal()` — sum the 6 withdrawal sources; return `total_water_withdrawal_m3`
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 2.3 Implement `_compute_discharge()` — sum the 5 discharge destinations; return `total_water_discharge_m3`
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 2.4 Implement KPI 1 logic — `total_water_consumption_m3 = max(0.0, withdrawal - discharge)`; append warning to `warnings` list when discharge > withdrawal; compute `total_freshwater_consumption_m3 = max(0.0, consumption - harvested_rainwater)`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 2.5 Implement KPI 2 logic — `water_consumption_per_tonne_litres = (total_water_consumption_m3 × 1000) / cementitious_production_t_yr`
    - _Requirements: 6.2, 6.3, 6.4_

  - [x] 2.6 Implement `_build_steps_breakdown()` — emit exactly 5 `CalculationStep` objects in the fixed order: `total_withdrawal` → `total_discharge` → `kpi_1_consumption` → `freshwater_consumption` → `kpi_2_intensity`; each step's `inputs` dict must use `{"value": ..., "unit": ...}` format; the `kpi_2_intensity` step must include the `1000 L/m³` conversion factor as a named input
    - _Requirements: 8.1–8.9_

  - [x] 2.7 Implement `_build_audit_trail()` — compute `input_hash = hashlib.sha256(water_input.model_dump_json().encode("utf-8")).hexdigest()`; assemble `AuditTrail` from `AuditContext` fields
    - _Requirements: 9.1, 9.2, 9.3, 9.5_

  - [x] 2.8 Wire `calculate()` — call all private helpers, assemble and return `WaterResult` with `methodology = MethodologyTag()`, `audit_trail`, `steps_breakdown`, all KPI fields, and all special-category pass-through fields
    - _Requirements: 7.1–7.4, 10.1, 10.2_

- [x] 3. Checkpoint — verify reference case manually
  - Instantiate `WaterEngine` with the Requirement 11 reference inputs (500k surface + 50k municipal withdrawal, 100k surface discharge, 2.3M tonnes) and assert the 5 expected output values match; ensure all tests pass, ask the user if questions arise.

- [x] 4. Write unit tests in `water_engine/tests/test_water_engine.py`
  - [x] 4.1 Test default methodology values (`"GCCA Water"`, `"0.1"`) when no override is provided
    - _Requirements: 10.1, 10.2_

  - [x] 4.2 Test default `user_id = "anonymous"` when not provided in `AuditContext`
    - _Requirements: 9.5_

  - [x] 4.3 Test reference validation case (Requirement 11): assert `total_water_withdrawal_m3 = 550000`, `total_water_discharge_m3 = 100000`, `total_water_consumption_m3 = 450000`, `total_freshwater_consumption_m3 = 450000`, `water_consumption_per_tonne_litres ≈ 195.65`
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 4.4 Test `ValueError` raised when `upload_timestamp_utc` is absent or empty
    - _Requirements: 9.4_

  - [x] 4.5 Test zero-input case: all withdrawal and discharge fields zero → all KPI outputs zero, all 5 steps still emitted with `output_value = 0.0`
    - _Requirements: 8.9_

  - [x] 4.6 Test discharge-exceeds-withdrawal case: `total_water_consumption_m3 = 0.0` and `result.warnings` is non-empty
    - _Requirements: 5.3_

  - [x] 4.7 Test `steps_breakdown` has exactly 5 steps with correct `step_id` values in correct order
    - _Requirements: 8.3–8.8_

  - [x] 4.8 Test `kpi_2_intensity` step `inputs` dict contains the `1000 L/m³` conversion factor key
    - _Requirements: 6.4, 8.7_

  - [x] 4.9 Test `input_hash` changes when any field of `WaterInput` changes (two calls with differing inputs)
    - _Requirements: 9.3_

  - [x] 4.10 Test `MethodologyTag` raises `ValueError` for invalid `protocol_version` strings (`"v0.1"`, `"0"`, `"0.1.0"`, `"abc"`)
    - _Requirements: 10.3_

- [ ] 5. Write property-based tests in `water_engine/tests/test_water_engine_properties.py`
  - [ ]* 5.1 Property 1 — WaterInput accepts all valid field combinations
    - **Property 1: WaterInput accepts all valid field combinations**
    - Use `st.floats(min_value=0, max_value=1e9, allow_nan=False, allow_infinity=False)` for each withdrawal/discharge field and `st.floats(min_value=0.001, max_value=1e9)` for production
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1**

  - [ ]* 5.2 Property 2 — Missing fields default to zero
    - **Property 2: Missing fields default to zero**
    - Build `WaterInput` with only `cementitious_production_t_yr` and assert calculation completes without error and all omitted volumes are treated as zero
    - **Validates: Requirements 1.5, 2.2**

  - [ ]* 5.3 Property 3 — Total withdrawal equals sum of 6 sources
    - **Property 3: Total withdrawal equals sum of 6 sources**
    - Assert `result.total_water_withdrawal_m3 == sum(6 source fields)` within float tolerance
    - **Validates: Requirements 3.1**

  - [ ]* 5.4 Property 4 — Excluded fields do not affect withdrawal or discharge totals
    - **Property 4: Excluded fields do not affect withdrawal or discharge totals**
    - Fix all withdrawal/discharge fields; vary `quarry_water_not_used_m3_yr`, `recycled_water_m3_yr`, `storm_water_collected_discharged_m3_yr`; assert totals unchanged
    - **Validates: Requirements 3.2, 4.2**

  - [ ]* 5.5 Property 5 — Total discharge equals sum of 5 destinations
    - **Property 5: Total discharge equals sum of 5 destinations**
    - Assert `result.total_water_discharge_m3 == sum(5 destination fields)` within float tolerance
    - **Validates: Requirements 4.1**

  - [ ]* 5.6 Property 6 — KPI 1 consumption is non-negative and equals withdrawal minus discharge
    - **Property 6: KPI 1 consumption is non-negative and equals withdrawal minus discharge**
    - Assert `result.total_water_consumption_m3 == max(0.0, withdrawal - discharge)`; when discharge > withdrawal assert `result.warnings` is non-empty
    - **Validates: Requirements 5.1, 5.3**

  - [ ]* 5.7 Property 7 — Freshwater consumption excludes harvested rainwater and is non-negative
    - **Property 7: Freshwater consumption excludes harvested rainwater and is non-negative**
    - Assert `result.total_freshwater_consumption_m3 == max(0.0, consumption - harvested_rainwater)`
    - **Validates: Requirements 5.4, 5.5**

  - [ ]* 5.8 Property 8 — KPI 2 intensity equals consumption × 1000 / production
    - **Property 8: KPI 2 intensity equals consumption × 1000 / production**
    - Assert `abs(result.water_consumption_per_tonne_litres - (consumption * 1000 / production)) < 0.01`
    - **Validates: Requirements 6.2**

  - [ ]* 5.9 Property 9 — Special category fields are passed through unchanged
    - **Property 9: Special category fields are passed through unchanged**
    - Assert `result.quarry_water_not_used_m3`, `result.recycled_water_m3`, `result.storm_water_collected_discharged_m3`, `result.harvested_rainwater_withdrawal_m3` equal the corresponding input fields exactly
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

  - [ ]* 5.10 Property 10 — Steps breakdown structural completeness
    - **Property 10: Steps breakdown structural completeness**
    - Assert `len(result.steps_breakdown) == 5` and each step has non-None, non-empty `step_id`, `label`, `formula`, `inputs`, `output_value`, `output_unit`
    - **Validates: Requirements 8.1, 8.2, 8.9**

  - [ ]* 5.11 Property 11 — Steps breakdown ordering and step IDs
    - **Property 11: Steps breakdown ordering and step IDs**
    - Assert `[s.step_id for s in result.steps_breakdown] == ["total_withdrawal", "total_discharge", "kpi_1_consumption", "freshwater_consumption", "kpi_2_intensity"]`
    - **Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.7, 8.8**

  - [ ]* 5.12 Property 12 — Input hash determinism
    - **Property 12: Input hash determinism**
    - Independently compute `SHA-256(water_input.model_dump_json().encode("utf-8")).hexdigest()` and assert it equals `result.audit_trail.source_reference.input_hash`
    - **Validates: Requirements 9.2, 9.3**

  - [ ]* 5.13 Property 13 — Audit trail structural completeness
    - **Property 13: Audit trail structural completeness**
    - Assert `result.audit_trail.source_reference.source_filename`, `upload_timestamp_utc`, and `input_hash` are all non-empty strings, and `user_id` is a string
    - **Validates: Requirements 9.1, 9.2**

  - [ ]* 5.14 Property 14 — Missing upload_timestamp_utc raises ValueError
    - **Property 14: Missing upload_timestamp_utc raises ValueError**
    - For any valid `WaterInput`, constructing `WaterEngine` with an `AuditContext` where `upload_timestamp_utc = ""` must raise `ValueError` with message `"upload_timestamp_utc is required for audit trail"`
    - **Validates: Requirements 9.4**

  - [ ]* 5.15 Property 15 — Invalid protocol_version raises ValueError
    - **Property 15: Invalid protocol_version raises ValueError**
    - Use `st.text().filter(lambda s: not re.fullmatch(r"\d+\.\d+", s))` to generate invalid version strings; assert `MethodologyTag(protocol_version=v)` raises `ValueError` with the expected message
    - **Validates: Requirements 10.3**

- [x] 6. Generate sample JSON output file
  - Run the reference validation case (Requirement 11) and write the serialised `WaterResult` JSON to `water_engine/sample_output.json`
  - The file must demonstrate all 5 `steps_breakdown` entries, the `audit_trail`, and `methodology` tag
  - _Requirements: 11.1, 11.2, 11.3_

- [ ] 7. Final checkpoint — Ensure all tests pass
  - Run `pytest water_engine/tests/ -v` and confirm all unit tests and property tests pass; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All property tests use `hypothesis` with a minimum of 100 iterations (`@settings(max_examples=100)`)
- Each property test file must include the tag comment: `# Feature: water-engine, Property {N}: {property_text}`
- The `water_engine.py` module must be self-contained — no imports from `carbon_engine`
- `AuditContext` is a plain `dataclass`, not a Pydantic model, to keep the engine layer pure
- The `kpi_2_intensity` step's `inputs` dict must include a `"conversion_factor_l_per_m3"` key with `{"value": 1000.0, "unit": "L/m³"}`
