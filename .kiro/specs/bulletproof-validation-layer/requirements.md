# Requirements Document

## Introduction

This feature upgrades both the Carbon Engine (`carbon_engine/carbon_engine.py`) and the Water Engine (`water_engine/water_engine.py`) with an enterprise-grade validation layer. The layer intercepts all incoming data before any calculation is performed and returns structured, machine-readable error JSON responses. It covers five validation domains: schema validation, logical sanity checks, unit-consistency checks, duplicate-input detection, and enum enforcement.

---

## Glossary

- **Carbon_Engine**: The Python module `carbon_engine/carbon_engine.py` that computes GCCA-compliant CO₂ footprints for cement plants.
- **Water_Engine**: The Python module `water_engine/water_engine.py` that computes GCCA Water KPIs for cement plants.
- **Validation_Layer**: The shared set of validators, guards, and error models applied to both engines before any calculation runs.
- **Error_Response**: A structured JSON object returned when validation fails, containing an `error_code`, `field`, `message`, and optional `meta` block.
- **Input_Hash**: The SHA-256 hex digest of the canonical JSON serialisation of a validated input model.
- **Duplicate_Registry**: An in-process (or injected) store that maps Input_Hash values to their first-seen ISO-8601 UTC timestamp.
- **FuelType**: The Python `Enum` class enumerating all valid fuel type identifiers for the Carbon_Engine.
- **WaterSource**: A Python `Enum` class enumerating all valid water withdrawal source identifiers for the Water_Engine.
- **Net_Specific_CO2**: The calculated value `specific_co2_kg_per_t_cement` produced by the Carbon_Engine, expressed in kg CO₂ / t cementitious product.
- **Total_Withdrawal**: The sum of all `WaterWithdrawal` sub-fields computed by the Water_Engine.
- **Total_Discharge**: The sum of all `WaterDischarge` sub-fields computed by the Water_Engine.
- **Unit_Mismatch_Threshold**: The value `10,000,000 m³/yr` above which a single water withdrawal field is suspected to have been entered in litres rather than cubic metres.
- **Small_Plant_Production_Threshold**: A cementitious production value of `≤ 5,000,000 t/yr`, used to contextualise the unit-mismatch check.
- **Physical_CO2_Lower_Bound**: The value `100 kg/t`, below which Net_Specific_CO2 is physically impossible for a cement plant.
- **Physical_CO2_Upper_Bound**: The value `2000 kg/t`, above which Net_Specific_CO2 is physically impossible for a cement plant.
- **Production_Scale_Min**: The value `10 t/yr`, below which a cement or clinker production figure is suspected to be a data entry error.
- **Production_Scale_Max**: The value `10,000,000 t/yr`, above which a cement or clinker production figure is suspected to have been entered in the wrong unit (e.g. kg instead of tonnes).
- **Suggested_Fix**: A human-readable string included in every Error_Response that describes the most likely corrective action for the reported error.
- **Input_Hash**: The SHA-256 hex digest of the canonical JSON serialisation of a validated input model (existing definition, referenced by Requirement 13).

---

## Requirements

### Requirement 1: Schema Validation — Missing Columns

**User Story:** As a data engineer, I want the system to reject inputs with missing required fields and return a specific error code, so that I can immediately identify which column is absent without inspecting stack traces.

#### Acceptance Criteria

1. WHEN a required field is absent from the input payload, THE Validation_Layer SHALL return an Error_Response with `error_code` equal to `"MISSING_COLUMN"` and `field` equal to the name of the missing column.
2. WHEN multiple required fields are absent simultaneously, THE Validation_Layer SHALL return a list of Error_Response objects, one per missing field, without short-circuiting after the first.
3. THE Validation_Layer SHALL perform missing-column checks for both the Carbon_Engine input model (`PlantInput`) and the Water_Engine input model (`WaterInput`) using Pydantic V2 validators.
4. IF a required field is present but set to `null`, THEN THE Validation_Layer SHALL treat it as missing and return the `MISSING_COLUMN` error code.

---

### Requirement 2: Schema Validation — Negative Values

**User Story:** As a data engineer, I want the system to reject negative numerical inputs and identify the offending field by name, so that physically impossible values never reach the calculation engine.

#### Acceptance Criteria

1. WHEN a numerical field that must be non-negative receives a negative value, THE Validation_Layer SHALL return an Error_Response with `error_code` equal to `"NEGATIVE_VALUE_ERROR"` and `field` equal to the name of the offending field.
2. THE Validation_Layer SHALL enforce non-negativity on all `float` and `int` fields in `WaterWithdrawal`, `WaterDischarge`, `WaterInput`, `FuelEntry`, `CalcinationInputB1`, `CalcinationInputA1`, `ElectricityInput`, and `TransportEntry`.
3. WHEN a negative value is detected, THE Validation_Layer SHALL include the submitted value in the `meta` block of the Error_Response.

---

### Requirement 3: Logical Sanity Check — Water Discharge Exceeds Withdrawal

**User Story:** As an environmental auditor, I want the system to flag physically impossible water balances, so that data entry errors are caught before they propagate into official reports.

#### Acceptance Criteria

1. WHEN Total_Discharge is strictly greater than Total_Withdrawal, THE Water_Engine SHALL include an entry in the `errors` list of the response with `error_code` equal to `"LOGICAL_DATA_ERROR"` and a message stating that consumption cannot be negative unless there is an unexplained source.
2. WHILE a `LOGICAL_DATA_ERROR` is present, THE Water_Engine SHALL still return the clamped consumption value (`0.0 m³`) alongside the error, so downstream consumers receive a complete response.
3. THE Water_Engine SHALL compute Total_Withdrawal and Total_Discharge before performing the logical check, using the same summation logic as the existing `_compute_withdrawal` and `_compute_discharge` helpers.

---

### Requirement 4: Logical Sanity Check — Net Specific CO₂ Out of Industry Range

**User Story:** As a sustainability manager, I want the system to warn me when the calculated Net Specific CO₂ falls outside the industry-accepted range, so that I can verify the input data before submitting a report.

#### Acceptance Criteria

1. WHEN Net_Specific_CO2 is less than `300 kg/t` or greater than `1000 kg/t`, THE Carbon_Engine SHALL append a warning entry to the `warnings` list of the result with `error_code` equal to `"OUT_OF_INDUSTRY_RANGE"` and the computed value included in the `meta` block.
2. THE Carbon_Engine SHALL perform the range check after the full calculation is complete, using the final `specific_co2_kg_per_t_cement` value.
3. WHERE the Net_Specific_CO2 is within the range `[300, 1000]`, THE Carbon_Engine SHALL not append any range warning.

---

### Requirement 5: Unit Consistency Check — Water Withdrawal Order of Magnitude

**User Story:** As a data entry operator, I want the system to warn me when a water withdrawal value appears to have been entered in litres instead of cubic metres, so that I can correct the unit before the value is used in calculations.

#### Acceptance Criteria

1. WHEN any single water withdrawal sub-field value exceeds `Unit_Mismatch_Threshold` (`10,000,000`), THE Validation_Layer SHALL return an Error_Response with `error_code` equal to `"UNIT_MISMATCH_SUSPECTED"` and `message` equal to `"Please verify if values are in m³"`.
2. THE Validation_Layer SHALL identify the specific field name that triggered the threshold in the `field` property of the Error_Response.
3. WHEN a `UNIT_MISMATCH_SUSPECTED` error is raised, THE Validation_Layer SHALL not block the calculation; the warning SHALL be included in the `warnings` list of the result so the calculation still proceeds.
4. THE Validation_Layer SHALL apply the unit-mismatch check to all sub-fields of `WaterWithdrawal` individually.

---

### Requirement 6: Duplicate Input Detection

**User Story:** As a system integrator, I want the system to detect when the same input payload is submitted more than once, so that idempotent re-submissions are identified and the operator is informed of the original processing timestamp.

#### Acceptance Criteria

1. WHEN an input payload is received, THE Validation_Layer SHALL compute the Input_Hash as the SHA-256 hex digest of the canonical JSON serialisation of the validated input model.
2. WHEN the Input_Hash matches a hash already present in the Duplicate_Registry, THE Validation_Layer SHALL return a response with `status` equal to `"DUPLICATE_INPUT_DETECTED"` and a `first_seen_timestamp` field containing the ISO-8601 UTC timestamp of the original submission.
3. WHEN the Input_Hash does not match any existing entry, THE Validation_Layer SHALL store the hash and the current UTC timestamp in the Duplicate_Registry before proceeding with the calculation.
4. THE Validation_Layer SHALL apply duplicate detection to both the Carbon_Engine and the Water_Engine.
5. FOR ALL valid input objects `x`, computing the Input_Hash of `x` twice SHALL produce the same hash (deterministic hashing round-trip property).

---

### Requirement 7: Enum Enforcement — Fuel Types

**User Story:** As a data engineer, I want the system to reject unrecognised fuel type identifiers and list the allowed values in the error response, so that I can correct the value without consulting separate documentation.

#### Acceptance Criteria

1. WHEN a `fuel_type` value is provided that does not match any member of the `FuelType` enum, THE Validation_Layer SHALL return an Error_Response with `error_code` equal to `"INVALID_CATEGORY"`, `field` equal to `"fuel_type"`, the submitted value in the `meta.submitted` field, and the full list of allowed values in the `meta.allowed` field.
2. THE Validation_Layer SHALL enforce `FuelType` enum membership for every entry in both `kiln_fuels` and `non_kiln_fuels` lists of `PlantInput`.
3. WHEN an invalid `fuel_type` is detected in a list, THE Validation_Layer SHALL report the row index of the offending entry in the `meta.row` field of the Error_Response.

---

### Requirement 8: Enum Enforcement — Water Sources

**User Story:** As a data engineer, I want the system to reject unrecognised water source identifiers and list the allowed values in the error response, so that water data is always categorised using the approved taxonomy.

#### Acceptance Criteria

1. THE Water_Engine SHALL define a `WaterSource` enum whose members correspond to the sub-fields of `WaterWithdrawal`: `surface_water`, `groundwater`, `quarry_water_used`, `municipal_potable_water`, `external_wastewater`, and `harvested_rainwater`.
2. WHEN a water source key is provided that does not match any member of the `WaterSource` enum, THE Validation_Layer SHALL return an Error_Response with `error_code` equal to `"INVALID_CATEGORY"`, `field` equal to `"water_source"`, the submitted value in `meta.submitted`, and the full list of allowed values in `meta.allowed`.
3. THE Validation_Layer SHALL enforce `WaterSource` enum membership when the input is provided as a dynamic key-value map rather than a typed Pydantic model.

---

### Requirement 9: Structured Error JSON Contract

**User Story:** As a frontend developer, I want all validation errors to follow a consistent JSON schema, so that I can build a single error-display component that handles all error types without special-casing.

#### Acceptance Criteria

1. THE Validation_Layer SHALL produce every Error_Response as a JSON object containing exactly the fields: `error_code` (string), `field` (string), `message` (string), `suggested_fix` (string), and `meta` (object, may be empty `{}`).
2. WHEN multiple validation errors occur, THE Validation_Layer SHALL wrap them in a top-level object with a `status` field equal to `"VALIDATION_FAILED"` and an `errors` array containing the individual Error_Response objects.
3. WHEN a duplicate input is detected, THE Validation_Layer SHALL return a top-level object with `status` equal to `"DUPLICATE_INPUT_DETECTED"`, `input_hash` (string), and `first_seen_timestamp` (ISO-8601 string).
4. THE Validation_Layer SHALL not include Python exception tracebacks or internal module paths in any Error_Response returned to the caller.
5. FOR ALL Error_Response objects, serialising to JSON and deserialising back SHALL produce an object equal to the original (round-trip property).
6. THE Validation_Layer SHALL populate the `suggested_fix` field with a human-readable corrective action string for every error code defined in Requirements 1 through 13; the field SHALL never be `null` or absent.

---

### Requirement 10: Hard Physical Limits — Carbon and Water

**User Story:** As a sustainability manager, I want the system to immediately reject inputs that are physically impossible for a cement plant, so that obviously corrupt data never enters the calculation pipeline.

#### Acceptance Criteria

1. WHEN Net_Specific_CO2 is less than `Physical_CO2_Lower_Bound` (`100 kg/t`) or greater than `Physical_CO2_Upper_Bound` (`2000 kg/t`), THE Carbon_Engine SHALL return an Error_Response with `error_code` equal to `"CRITICAL_DATA_ERROR"`, `field` equal to `"specific_co2_kg_per_t_cement"`, and the computed value in the `meta` block.
2. WHEN a `CRITICAL_DATA_ERROR` is raised for Net_Specific_CO2, THE Carbon_Engine SHALL halt further processing and SHALL NOT return a calculation result.
3. WHEN Total_Discharge is strictly greater than Total_Withdrawal, THE Water_Engine SHALL return an Error_Response with `error_code` equal to `"NEGATIVE_CONSUMPTION_ERROR"`, `field` equal to `"total_water_consumption_m3"`, and both Total_Withdrawal and Total_Discharge values in the `meta` block.
4. WHEN a `NEGATIVE_CONSUMPTION_ERROR` is raised, THE Water_Engine SHALL still return the clamped consumption value (`0.0 m³`) alongside the error so downstream consumers receive a complete response.
5. THE Validation_Layer SHALL apply the `CRITICAL_DATA_ERROR` check after the full Carbon_Engine calculation is complete, using the final `specific_co2_kg_per_t_cement` value.

---

### Requirement 11: Unit and Scale Validation — Production and Water Volumes

**User Story:** As a data entry operator, I want the system to warn me when production or water volume figures are outside any plausible operating range, so that unit-conversion mistakes (e.g. entering kg instead of tonnes, or litres instead of m³) are caught before they distort KPIs.

#### Acceptance Criteria

1. WHEN `cement_production_t_yr` or `clinker_production_t_yr` in `PlantInput` is less than `Production_Scale_Min` (`10 t/yr`) or greater than `Production_Scale_Max` (`10,000,000 t/yr`), THE Validation_Layer SHALL return an Error_Response with `error_code` equal to `"UNIT_MISMATCH_SUSPECTED"`, the offending field name in `field`, and the submitted value in the `meta` block.
2. WHEN `cementitious_production_t_yr` in `WaterInput` is less than `Production_Scale_Min` (`10 t/yr`) or greater than `Production_Scale_Max` (`10,000,000 t/yr`), THE Validation_Layer SHALL return an Error_Response with `error_code` equal to `"UNIT_MISMATCH_SUSPECTED"`, `field` equal to `"cementitious_production_t_yr"`, and the submitted value in the `meta` block.
3. WHEN any single water volume field (withdrawal or discharge sub-fields, `quarry_water_not_used_m3_yr`, `recycled_water_m3_yr`, `storm_water_collected_discharged_m3_yr`) exceeds `Unit_Mismatch_Threshold` (`10,000,000 m³/yr`), THE Validation_Layer SHALL return an Error_Response with `error_code` equal to `"UNIT_MISMATCH_SUSPECTED"`, the offending field name in `field`, and `message` equal to `"Please verify if values are in m³"`.
4. WHEN a `UNIT_MISMATCH_SUSPECTED` error is raised for any field, THE Validation_Layer SHALL NOT block the calculation; the warning SHALL be included in the `warnings` list of the result so the calculation still proceeds.
5. THE Validation_Layer SHALL apply production scale checks to both engines independently during the pre-calculation validation phase.

---

### Requirement 12: Inter-field Dependency Checks

**User Story:** As an environmental auditor, I want the system to detect internally inconsistent combinations of fields, so that silent data errors — where individual fields look valid but their combination is physically impossible — are surfaced before a report is generated.

#### Acceptance Criteria

1. WHEN the total fuel consumption across all `kiln_fuels` and `non_kiln_fuels` entries is greater than `0` AND the total CO₂ emissions from fuel combustion equals `0`, THE Carbon_Engine SHALL return an Error_Response with `error_code` equal to `"INCONSISTENT_FUEL_DATA"`, `field` equal to `"kiln_fuels"`, and a message explaining that non-zero fuel consumption must produce non-zero CO₂ emissions.
2. WHEN `clinker_production_t_yr` is greater than `0` AND the calcination CO₂ contribution equals `0`, THE Carbon_Engine SHALL return an Error_Response with `error_code` equal to `"INCONSISTENT_PROCESS_DATA"`, `field` equal to `"calcination_b1"` or `"calcination_a1"` (whichever method is active), and a message explaining that clinker production must produce non-zero calcination emissions.
3. THE Carbon_Engine SHALL perform inter-field dependency checks after the full calculation is complete, using the final computed values for fuel CO₂ and calcination CO₂.
4. WHEN an `INCONSISTENT_FUEL_DATA` or `INCONSISTENT_PROCESS_DATA` error is raised, THE Carbon_Engine SHALL include the offending computed value (fuel CO₂ or calcination CO₂) in the `meta` block of the Error_Response.
5. IF both `INCONSISTENT_FUEL_DATA` and `INCONSISTENT_PROCESS_DATA` conditions are present simultaneously, THEN THE Carbon_Engine SHALL return both errors in the `errors` array without short-circuiting after the first.

---

### Requirement 13: Idempotency via SHA-256 Duplicate Detection

**User Story:** As a system integrator, I want the system to return structured metadata about a previously processed submission when the same payload is re-submitted, so that idempotent retries are handled gracefully and operators can trace the original record.

#### Acceptance Criteria

1. WHEN an input payload is received whose Input_Hash matches a hash already present in the Duplicate_Registry, THE Validation_Layer SHALL return an Error_Response with `error_code` equal to `"DUPLICATE_SUBMISSION"`, `field` equal to `"input_hash"`, and a `meta` block containing `first_seen_timestamp` (ISO-8601 string) and `original_input_hash` (string).
2. THE Validation_Layer SHALL compute the Input_Hash as the SHA-256 hex digest of the canonical JSON serialisation of the validated input model, consistent with the hashing logic defined in Requirement 6.
3. WHEN the Input_Hash does not match any existing entry, THE Validation_Layer SHALL store the hash and the current UTC timestamp in the Duplicate_Registry before proceeding with the calculation.
4. THE Validation_Layer SHALL apply duplicate detection to both the Carbon_Engine and the Water_Engine.
5. FOR ALL valid input objects `x`, computing the Input_Hash of `x` twice SHALL produce the same hash (deterministic hashing round-trip property).
6. WHEN a `DUPLICATE_SUBMISSION` error is returned, THE Validation_Layer SHALL NOT proceed with the calculation; the response SHALL contain only the error and the metadata of the original submission.
