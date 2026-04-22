# Requirements Document

## Introduction

The Water Engine feature adds a dedicated water accounting module (`water_engine.py`) to the Tefnut platform, compliant with the GCCA Sustainability Guidelines for Water (Version 0.1, October 2019). It mirrors the "Audit-Ready" and "Explainable" architecture of the existing Carbon Engine: Pydantic input/output models, a step-by-step `steps_breakdown`, a cryptographic `audit_trail`, and a `methodology` tag. The engine calculates the two mandatory GCCA water KPIs — Total Water Consumption (m³/year) and Water Consumption per Unit of Product (litres/tonne cementitious) — while correctly handling all GCCA-defined special categories: harvested rainwater, quarry water, recycled water, and storm water.

---

## Glossary

- **Water_Engine**: The Python calculation module (`water_engine.py`) that computes water KPIs for a single cement plant in accordance with GCCA Water Guidelines v0.1.
- **Water_Result**: The Pydantic output model returned by `WaterEngine.calculate()`, serialised as JSON by the API.
- **Total_Water_Withdrawal**: The sum of all water drawn from external sources (surface water, groundwater, quarry water used, municipal/potable water, external wastewater, and harvested rainwater) expressed in m³/year. Recycled water and storm water collected and discharged without use are excluded.
- **Total_Water_Discharge**: The sum of all water released to external destinations (ocean, surface, subsurface/well, off-site water treatment, beneficial/other users) expressed in m³/year. Storm water collected and discharged without use is excluded.
- **Total_Water_Consumption**: `Total_Water_Withdrawal − Total_Water_Discharge`, expressed in m³/year. Includes harvested rainwater.
- **Total_Freshwater_Consumption**: `Total_Water_Consumption` minus the volume of harvested rainwater, expressed in m³/year.
- **KPI_1**: Total Water Consumption (m³/year) — the primary GCCA water KPI.
- **KPI_2**: Water Consumption per Unit of Product (litres/tonne cementitious product) — the GCCA intensity KPI.
- **Withdrawal_Source**: A categorised origin of water drawn into the plant. Valid sources: `surface_water`, `groundwater`, `quarry_water_used`, `municipal_potable_water`, `external_wastewater`, `harvested_rainwater`.
- **Discharge_Destination**: A categorised destination for water released from the plant. Valid destinations: `ocean`, `surface_water`, `subsurface_well`, `offsite_water_treatment`, `beneficial_other_users`.
- **Harvested_Rainwater**: Rainwater collected on-site. Counted as a `Withdrawal_Source` and included in `Total_Water_Consumption`, but excluded from `Total_Freshwater_Consumption`.
- **Quarry_Water_Used**: Water from quarry operations that is used on-site. Counted as a `Withdrawal_Source`.
- **Quarry_Water_Not_Used**: Water from quarry operations that is not used on-site. Reported separately; excluded from `Total_Water_Withdrawal`, `Total_Water_Discharge`, and `Total_Water_Consumption`.
- **Recycled_Water**: Water returned to a recycling installation on-site. Excluded from `Total_Water_Withdrawal`, `Total_Water_Discharge`, and `Total_Water_Consumption`. Make-up water added to recycled water is counted as withdrawal.
- **Storm_Water**: Water collected and discharged without use. Reported separately; excluded from `Total_Water_Withdrawal`, `Total_Water_Discharge`, and `Total_Water_Consumption`.
- **Audit_Trail**: A structured record linking a `Water_Result` to the exact raw inputs (source filename, upload timestamp, and SHA-256 hash of the `WaterInput`) used to produce it.
- **Methodology_Tag**: A structured field on `Water_Result` identifying the calculation protocol: `protocol_name = "GCCA Water"`, `protocol_version = "0.1"`.
- **Steps_Breakdown**: An ordered list of `CalculationStep` objects attached to `Water_Result`, each describing one intermediate computation with its formula, named inputs, and output value.
- **Calculation_Step**: A single entry in `Steps_Breakdown` containing `step_id`, `label`, `formula`, `inputs` (dict with `value` and `unit`), `output_value`, and `output_unit`.
- **Source_Reference**: A sub-object on `Audit_Trail` recording `source_filename`, `upload_timestamp_utc` (ISO-8601 UTC), and `input_hash` (SHA-256 hex digest of the serialised `WaterInput` JSON).
- **WaterInput**: The Pydantic input model carrying all plant-level water data into the `Water_Engine`.
- **Cementitious_Production**: Total production of cementitious product in tonnes per year, used as the denominator for KPI_2.

---

## Requirements

### Requirement 1: Water Withdrawal Input Categorisation

**User Story:** As a plant data manager, I want to record water withdrawals by source category, so that the engine can correctly apply GCCA rules for each source type.

#### Acceptance Criteria

1. THE `WaterInput` SHALL accept withdrawal volumes (in m³/year, ≥ 0) for each of the following named sources: `surface_water`, `groundwater`, `quarry_water_used`, `municipal_potable_water`, `external_wastewater`, `harvested_rainwater`.
2. THE `WaterInput` SHALL accept a separate `quarry_water_not_used_m3_yr` field (m³/year, ≥ 0) for quarry water that is not used on-site.
3. THE `WaterInput` SHALL accept a `recycled_water_m3_yr` field (m³/year, ≥ 0) for water returned to an on-site recycling installation.
4. THE `WaterInput` SHALL accept a `storm_water_collected_discharged_m3_yr` field (m³/year, ≥ 0) for storm water collected and discharged without use.
5. IF any withdrawal volume field is omitted from the input, THEN THE `Water_Engine` SHALL treat the omitted field as zero without raising an error.

---

### Requirement 2: Water Discharge Input Categorisation

**User Story:** As a plant data manager, I want to record water discharges by destination category, so that the engine can compute net consumption correctly.

#### Acceptance Criteria

1. THE `WaterInput` SHALL accept discharge volumes (in m³/year, ≥ 0) for each of the following named destinations: `ocean`, `surface_water`, `subsurface_well`, `offsite_water_treatment`, `beneficial_other_users`.
2. IF any discharge volume field is omitted from the input, THEN THE `Water_Engine` SHALL treat the omitted field as zero without raising an error.

---

### Requirement 3: Total Water Withdrawal Calculation

**User Story:** As a sustainability reporter, I want the engine to compute Total Water Withdrawal in accordance with GCCA rules, so that the figure is compliant and auditable.

#### Acceptance Criteria

1. THE `Water_Engine` SHALL compute `Total_Water_Withdrawal` as the sum of: `surface_water`, `groundwater`, `quarry_water_used`, `municipal_potable_water`, `external_wastewater`, and `harvested_rainwater` withdrawal volumes.
2. THE `Water_Engine` SHALL exclude `recycled_water_m3_yr`, `quarry_water_not_used_m3_yr`, and `storm_water_collected_discharged_m3_yr` from `Total_Water_Withdrawal`.
3. THE `Water_Result` SHALL report `total_water_withdrawal_m3` in m³/year.

---

### Requirement 4: Total Water Discharge Calculation

**User Story:** As a sustainability reporter, I want the engine to compute Total Water Discharge in accordance with GCCA rules, so that the net consumption figure is correct.

#### Acceptance Criteria

1. THE `Water_Engine` SHALL compute `Total_Water_Discharge` as the sum of: `ocean`, `surface_water`, `subsurface_well`, `offsite_water_treatment`, and `beneficial_other_users` discharge volumes.
2. THE `Water_Engine` SHALL exclude `storm_water_collected_discharged_m3_yr` from `Total_Water_Discharge`.
3. THE `Water_Result` SHALL report `total_water_discharge_m3` in m³/year.

---

### Requirement 5: KPI 1 — Total Water Consumption

**User Story:** As a sustainability reporter, I want the engine to calculate KPI 1 (Total Water Consumption) using the GCCA formula, so that the figure is ready for regulatory submission.

#### Acceptance Criteria

1. THE `Water_Engine` SHALL compute `KPI_1` as: `Total_Water_Withdrawal − Total_Water_Discharge`.
2. THE `Water_Result` SHALL report `total_water_consumption_m3` in m³/year.
3. IF `Total_Water_Withdrawal` is less than `Total_Water_Discharge`, THEN THE `Water_Engine` SHALL set `total_water_consumption_m3` to `0.0` and SHALL include a warning message in the result indicating that discharge exceeds withdrawal.
4. THE `Water_Engine` SHALL compute `total_freshwater_consumption_m3` as `total_water_consumption_m3` minus the `harvested_rainwater` withdrawal volume.
5. IF `total_freshwater_consumption_m3` would be negative, THEN THE `Water_Engine` SHALL set it to `0.0`.

---

### Requirement 6: KPI 2 — Water Consumption per Unit of Product

**User Story:** As a sustainability reporter, I want the engine to calculate KPI 2 (Water Consumption per unit of cementitious product) in litres/tonne, so that the intensity metric is ready for benchmarking and reporting.

#### Acceptance Criteria

1. THE `WaterInput` SHALL accept `cementitious_production_t_yr` (tonnes/year, > 0) as a required field.
2. THE `Water_Engine` SHALL compute `KPI_2` as: `(total_water_consumption_m3 × 1,000) / cementitious_production_t_yr`.
3. THE `Water_Result` SHALL report `water_consumption_per_tonne_litres` in litres/tonne cementitious.
4. THE `Water_Engine` SHALL apply the unit conversion factor of 1,000 litres per m³ explicitly as a named step in `steps_breakdown`.

---

### Requirement 7: Special Category Reporting

**User Story:** As a sustainability reporter, I want the engine to separately report quarry water not used, recycled water, and storm water, so that the full GCCA disclosure is complete even though these volumes are excluded from the main KPIs.

#### Acceptance Criteria

1. THE `Water_Result` SHALL include `quarry_water_not_used_m3` equal to the `quarry_water_not_used_m3_yr` input value.
2. THE `Water_Result` SHALL include `recycled_water_m3` equal to the `recycled_water_m3_yr` input value.
3. THE `Water_Result` SHALL include `storm_water_collected_discharged_m3` equal to the `storm_water_collected_discharged_m3_yr` input value.
4. THE `Water_Result` SHALL include `harvested_rainwater_withdrawal_m3` equal to the `harvested_rainwater` withdrawal input value, to support the freshwater consumption calculation and disclosure.

---

### Requirement 8: Steps Breakdown — Explainability

**User Story:** As a plant engineer or auditor, I want the API response to include a step-by-step breakdown of every water calculation, so that I can verify the arithmetic and trace each figure back to its source inputs.

#### Acceptance Criteria

1. THE `Water_Result` SHALL include a `steps_breakdown` field containing an ordered list of `CalculationStep` objects.
2. THE `CalculationStep` SHALL contain: `step_id` (string, unique within a result), `label` (human-readable description), `formula` (string representation of the equation), `inputs` (dictionary of named input values each with `value` and `unit` sub-fields), `output_value` (numeric result), and `output_unit` (string).
3. THE `Water_Engine` SHALL emit a `CalculationStep` with `step_id` `"total_withdrawal"` recording each withdrawal source volume and the summed `total_water_withdrawal_m3`.
4. THE `Water_Engine` SHALL emit a `CalculationStep` with `step_id` `"total_discharge"` recording each discharge destination volume and the summed `total_water_discharge_m3`.
5. THE `Water_Engine` SHALL emit a `CalculationStep` with `step_id` `"kpi_1_consumption"` recording `total_water_withdrawal_m3`, `total_water_discharge_m3`, and the resulting `total_water_consumption_m3`.
6. THE `Water_Engine` SHALL emit a `CalculationStep` with `step_id` `"freshwater_consumption"` recording `total_water_consumption_m3`, `harvested_rainwater_withdrawal_m3`, and the resulting `total_freshwater_consumption_m3`.
7. THE `Water_Engine` SHALL emit a `CalculationStep` with `step_id` `"kpi_2_intensity"` recording `total_water_consumption_m3`, the conversion factor `1000 L/m³`, `cementitious_production_t_yr`, and the resulting `water_consumption_per_tonne_litres`.
8. THE `steps_breakdown` list SHALL be ordered: `total_withdrawal` → `total_discharge` → `kpi_1_consumption` → `freshwater_consumption` → `kpi_2_intensity`.
9. IF any input volume is zero or absent, THE `Water_Engine` SHALL still emit the corresponding `CalculationStep` with `output_value` of `0.0` and an `inputs` dictionary reflecting the zero values.

---

### Requirement 9: Audit Trail

**User Story:** As an auditor, I want every water calculation result to carry a cryptographic reference to its exact inputs, so that I can verify the provenance of any reported figure.

#### Acceptance Criteria

1. THE `Water_Result` SHALL include an `audit_trail` field containing a `Source_Reference` sub-object and a `user_id` string.
2. THE `Source_Reference` SHALL contain `source_filename` (string), `upload_timestamp_utc` (ISO-8601 UTC string), and `input_hash` (SHA-256 hex digest of the UTF-8-encoded JSON serialisation of the `WaterInput`).
3. THE `Water_Engine` SHALL compute `input_hash` as `SHA-256(WaterInput.model_dump_json().encode("utf-8")).hexdigest()`.
4. IF `upload_timestamp_utc` is not provided to the `Water_Engine`, THEN THE `Water_Engine` SHALL raise a `ValueError` with the message `"upload_timestamp_utc is required for audit trail"`.
5. THE `audit_trail` SHALL include `user_id`; WHEN no user identity is available, THE `Water_Engine` SHALL default `user_id` to `"anonymous"`.

---

### Requirement 10: Methodology Tag

**User Story:** As a compliance officer, I want every water calculation result to be tagged with the GCCA Water Guidelines version used, so that historical reports remain valid when the methodology is updated.

#### Acceptance Criteria

1. THE `Water_Result` SHALL include a `methodology` field of type `MethodologyTag`.
2. THE `Water_Engine` SHALL default `methodology.protocol_name` to `"GCCA Water"` and `methodology.protocol_version` to `"0.1"`.
3. THE `MethodologyTag` SHALL validate that `protocol_version` matches the pattern `^\d+\.\d+$`; IF the pattern does not match, THEN THE `Water_Engine` SHALL raise a `ValueError` with the message `"protocol_version must be in the format '<major>.<minor>'"`.

---

### Requirement 11: Sample Output Validation

**User Story:** As a developer integrating the water engine, I want a documented sample JSON output for a reference plant scenario, so that I can validate my integration against a known-correct result.

#### Acceptance Criteria

1. WHEN the `Water_Engine` is given the following inputs:
   - Withdrawal: `surface_water = 500,000 m³`, `municipal_potable_water = 50,000 m³`, all other withdrawal sources = 0
   - Discharge: `surface_water = 100,000 m³`, all other discharge destinations = 0
   - `cementitious_production_t_yr = 2,300,000`
   THE `Water_Engine` SHALL produce:
   - `total_water_withdrawal_m3 = 550,000`
   - `total_water_discharge_m3 = 100,000`
   - `total_water_consumption_m3 = 450,000`
   - `total_freshwater_consumption_m3 = 450,000` (no harvested rainwater)
   - `water_consumption_per_tonne_litres ≈ 195.65` (rounded to 2 decimal places)
2. THE `Water_Result` for the scenario in criterion 1 SHALL include a `steps_breakdown` with exactly 5 `CalculationStep` objects in the order defined in Requirement 8.
3. THE `Water_Result` for the scenario in criterion 1 SHALL include an `audit_trail` with a non-empty `input_hash` and a `methodology` tag with `protocol_name = "GCCA Water"` and `protocol_version = "0.1"`.
