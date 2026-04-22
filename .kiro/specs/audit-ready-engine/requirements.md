# Requirements Document

## Introduction

The Audit-Ready Engine feature extends the Tefnut Carbon Engine backend with three architectural capabilities required for regulatory transparency and third-party auditability: (1) an Audit Trail that links every calculation result to its raw input source, (2) Methodology Versioning that tags every report with the protocol version used, and (3) Explainable Calculations that expose a step-by-step breakdown of how each CO2 figure was derived. Together these capabilities transform the engine from a "black box" calculator into a fully traceable, audit-grade system compliant with GCCA and CBAM reporting obligations.

## Glossary

- **Carbon_Engine**: The Python calculation engine (`carbon_engine.py`) that computes CO2 emissions for a cement plant.
- **Calculation_Result**: The Pydantic output model returned by `CarbonEngine.calculate()`, serialised as JSON by the API.
- **Audit_Trail**: A structured record that links a `Calculation_Result` to the exact raw inputs (source file name, upload timestamp, and original `PlantInput` snapshot) used to produce it.
- **Raw_Inputs**: The original, unmodified data values provided by the user — either via JSON body or uploaded file — before any engine transformation.
- **Methodology_Tag**: A structured field on `Calculation_Result` that identifies the calculation protocol name and version (e.g., `GCCA v3.1`) applied during a specific calculation run.
- **Protocol_Version**: A string in the format `<standard> v<major>.<minor>` (e.g., `GCCA v3.1`) that uniquely identifies a published calculation methodology.
- **Steps_Breakdown**: An ordered list of `CalculationStep` objects attached to `Calculation_Result`, each describing one intermediate computation with its formula, input values, and output value.
- **Calculation_Step**: A single entry in `Steps_Breakdown` containing a human-readable label, the formula applied, the named input values, and the resulting output value.
- **Handler**: The AWS Lambda entry point (`handler.py`) that routes API requests to the `Carbon_Engine` and serialises responses.
- **Parser**: The data ingestion layer (`parser.py`) that converts uploaded Excel/CSV files into `PlantInput` objects.
- **PlantInput**: The Pydantic input model that carries all plant-level data into the `Carbon_Engine`.
- **Source_Reference**: A sub-object on `Audit_Trail` that records the origin of the raw inputs: `source_filename`, `upload_timestamp_utc`, and `input_hash`.
- **Input_Hash**: A SHA-256 hex digest of the serialised `PlantInput` JSON, used to detect whether inputs have changed between runs.

---

## Requirements

### Requirement 1: Audit Trail — Raw Input Traceability

**User Story:** As an auditor, I want every calculation result to carry a reference to the exact raw inputs that produced it, so that I can verify the provenance of any reported CO2 figure without re-running the calculation.

#### Acceptance Criteria

1. THE `Calculation_Result` SHALL include an `audit_trail` field of type `AuditTrail`.
2. WHEN a calculation is triggered via the JSON endpoint (`POST /api/calculate`), THE `Carbon_Engine` SHALL populate `audit_trail.source_reference.source_filename` with the value `"json_input"` and `audit_trail.source_reference.upload_timestamp_utc` with the UTC ISO-8601 timestamp of the request.
3. WHEN a calculation is triggered via the file-upload endpoint (`POST /api/calculate/upload`), THE `Carbon_Engine` SHALL populate `audit_trail.source_reference.source_filename` with the original uploaded filename and `audit_trail.source_reference.upload_timestamp_utc` with the UTC ISO-8601 timestamp of the upload.
4. THE `Carbon_Engine` SHALL compute `audit_trail.source_reference.input_hash` as the SHA-256 hex digest of the UTF-8-encoded JSON serialisation of the `PlantInput` used for that calculation.
5. THE `Calculation_Result` SHALL include `audit_trail.raw_inputs` as a verbatim copy of the `PlantInput` model, serialised to a JSON-compatible dictionary, so that the exact inputs are preserved alongside the result.
6. IF `audit_trail.source_reference.upload_timestamp_utc` cannot be determined, THEN THE `Carbon_Engine` SHALL raise a `ValueError` with the message `"upload_timestamp_utc is required for audit trail"`.

---

### Requirement 2: Methodology Versioning

**User Story:** As a compliance officer, I want every calculation result to be tagged with the protocol version used, so that historical reports remain valid when the methodology is updated and new reports can adopt the new version without affecting old ones.

#### Acceptance Criteria

1. THE `Calculation_Result` SHALL include a `methodology` field of type `MethodologyTag`.
2. THE `MethodologyTag` SHALL contain `protocol_name` (string, e.g., `"GCCA"`) and `protocol_version` (string, e.g., `"3.1"`).
3. THE `Carbon_Engine` SHALL default `methodology.protocol_name` to `"GCCA"` and `methodology.protocol_version` to `"3.1"` when no override is provided.
4. WHEN a `PlantInput` carries an optional `methodology_override` field specifying a `protocol_name` and `protocol_version`, THE `Carbon_Engine` SHALL use those values in place of the defaults.
5. THE `Carbon_Engine` SHALL validate that `protocol_version` matches the pattern `^\d+\.\d+$` (e.g., `"3.1"`, `"4.0"`); IF the pattern does not match, THEN THE `Carbon_Engine` SHALL raise a `ValueError` with the message `"protocol_version must be in the format '<major>.<minor>'"`.
6. THE `Calculation_Result` SHALL preserve `methodology` unchanged through JSON serialisation and deserialisation (round-trip property).

---

### Requirement 3: Explainable Calculations — Steps Breakdown

**User Story:** As a plant engineer, I want the API to return a step-by-step breakdown of how each CO2 figure was calculated, so that I can verify the arithmetic and explain the result to an auditor or regulator.

#### Acceptance Criteria

1. THE `Calculation_Result` SHALL include a `steps_breakdown` field containing an ordered list of `CalculationStep` objects.
2. THE `CalculationStep` SHALL contain: `step_id` (string, unique within a result), `label` (human-readable description), `formula` (string representation of the equation applied), `inputs` (dictionary of named input values with units), and `output_value` (numeric result) and `output_unit` (string).
3. WHEN the `Carbon_Engine` computes Scope 1 calcination CO2 using Method B1, THE `Carbon_Engine` SHALL emit a `CalculationStep` with `step_id` `"calcination_b1"`, recording `clinker_production_t_yr`, `calcination_ef_kg_per_t_clinker`, and the resulting `calcination_co2_t`.
4. WHEN the `Carbon_Engine` computes Scope 1 calcination CO2 using Method A1, THE `Carbon_Engine` SHALL emit a `CalculationStep` with `step_id` `"calcination_a1"`, recording `kiln_feed_t_yr`, `loi_raw_meal_pct`, `dust_return_correction_pct`, and the resulting `calcination_co2_t`.
5. WHEN the `Carbon_Engine` computes fuel combustion CO2 for each fuel entry, THE `Carbon_Engine` SHALL emit one `CalculationStep` per fuel with `step_id` `"fuel_<fuel_type>_<kiln|non_kiln>"`, recording `consumption_t_per_yr`, `lhv_gj_per_t`, `ef_kg_co2_per_gj`, and the resulting `co2_t`.
6. WHEN the `Carbon_Engine` computes Scope 2 electricity CO2, THE `Carbon_Engine` SHALL emit a `CalculationStep` with `step_id` `"scope2_electricity"`, recording `purchased_electricity_mwh_yr`, `grid_ef_kg_co2_per_mwh`, and the resulting `electricity_co2_t`.
7. WHEN the `Carbon_Engine` computes the specific CO2 KPI, THE `Carbon_Engine` SHALL emit a `CalculationStep` with `step_id` `"specific_co2"`, recording `total_co2e_t`, `cement_production_t_yr`, and the resulting `specific_co2_kg_per_t_cement`.
8. THE `steps_breakdown` list SHALL be ordered such that Scope 1 steps appear before Scope 2 steps, which appear before the KPI step.
9. IF a calculation scope produces zero CO2 because its inputs are absent or zero, THEN THE `Carbon_Engine` SHALL still emit the corresponding `CalculationStep` with `output_value` of `0.0` and an `inputs` dictionary reflecting the zero or absent values.
10. THE `Carbon_Engine` SHALL ensure that the sum of `output_value` across all fuel `CalculationStep` objects equals the `scope1.fuel_combustion_co2_t` field in the same `Calculation_Result` (within a floating-point tolerance of 0.01 t).
