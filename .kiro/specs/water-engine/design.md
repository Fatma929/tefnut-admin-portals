# Design Document: Water Engine

## Overview

The Water Engine adds a standalone `water_engine.py` module to the Tefnut platform that computes the two mandatory GCCA Water KPIs for a single cement plant:

- **KPI 1** — Total Water Consumption (m³/year)
- **KPI 2** — Water Consumption per Unit of Product (litres/tonne cementitious)

The design mirrors the Audit-Ready Carbon Engine architecture exactly: Pydantic input/output models, an `AuditContext` dataclass injected by the handler, a cryptographic `AuditTrail`, a `MethodologyTag`, and a `steps_breakdown` of ordered `CalculationStep` objects. The engine is a pure calculation module — it does not read from `datetime.now()` or environment variables; all context is injected.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  API Layer  (handler.py or water_handler.py)            │
│  • Injects source_filename, upload_timestamp_utc,       │
│    user_id into AuditContext dataclass                  │
│  • Passes AuditContext to WaterEngine constructor       │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│  Engine Layer  (water_engine.py)                        │
│  • Pydantic models: WaterWithdrawal, WaterDischarge,    │
│    WaterInput, WaterResult                              │
│  • Shared models: AuditContext, AuditTrail,             │
│    MethodologyTag, CalculationStep (mirrored from       │
│    carbon_engine.py)                                    │
│  • WaterEngine.__init__ accepts WaterInput +            │
│    AuditContext                                         │
│  • calculate() returns WaterResult with audit_trail,    │
│    methodology, and steps_breakdown                     │
└─────────────────────────────────────────────────────────┘
```

The handler is the only place that knows the request context (filename, timestamp, user). It constructs an `AuditContext` and passes it to `WaterEngine`. The engine is kept pure.

---

## Components and Interfaces

### `AuditContext` Dataclass (injected by handler)

```python
from dataclasses import dataclass, field

@dataclass
class AuditContext:
    source_filename: str
    upload_timestamp_utc: str   # ISO-8601 UTC string, e.g. "2026-01-15T10:30:00Z"
    user_id: str = "anonymous"
```

### Pydantic Input Models

```python
class WaterWithdrawal(BaseModel):
    surface_water: float = Field(0.0, ge=0)
    groundwater: float = Field(0.0, ge=0)
    quarry_water_used: float = Field(0.0, ge=0)
    municipal_potable_water: float = Field(0.0, ge=0)
    external_wastewater: float = Field(0.0, ge=0)
    harvested_rainwater: float = Field(0.0, ge=0)

class WaterDischarge(BaseModel):
    ocean: float = Field(0.0, ge=0)
    surface_water: float = Field(0.0, ge=0)
    subsurface_well: float = Field(0.0, ge=0)
    offsite_water_treatment: float = Field(0.0, ge=0)
    beneficial_other_users: float = Field(0.0, ge=0)

class WaterInput(BaseModel):
    withdrawal: WaterWithdrawal = Field(default_factory=WaterWithdrawal)
    discharge: WaterDischarge = Field(default_factory=WaterDischarge)
    quarry_water_not_used_m3_yr: float = Field(0.0, ge=0)
    recycled_water_m3_yr: float = Field(0.0, ge=0)
    storm_water_collected_discharged_m3_yr: float = Field(0.0, ge=0)
    cementitious_production_t_yr: float = Field(..., gt=0)
```

### Pydantic Output Models

```python
class SourceReference(BaseModel):
    source_filename: str
    upload_timestamp_utc: str   # ISO-8601 UTC
    input_hash: str             # SHA-256 hex digest of WaterInput JSON

class AuditTrail(BaseModel):
    source_reference: SourceReference
    user_id: str

class MethodologyTag(BaseModel):
    protocol_name: str = "GCCA Water"
    protocol_version: str = "0.1"   # Validated: ^\d+\.\d+$

class CalculationStep(BaseModel):
    step_id: str
    label: str
    formula: str
    inputs: dict[str, Any]   # {"field_name": {"value": float, "unit": str}}
    output_value: float
    output_unit: str

class WaterResult(BaseModel):
    # KPI outputs
    total_water_withdrawal_m3: float
    total_water_discharge_m3: float
    total_water_consumption_m3: float
    total_freshwater_consumption_m3: float
    water_consumption_per_tonne_litres: float
    # Special category pass-through
    quarry_water_not_used_m3: float
    recycled_water_m3: float
    storm_water_collected_discharged_m3: float
    harvested_rainwater_withdrawal_m3: float
    # Warnings
    warnings: list[str] = Field(default_factory=list)
    # Audit / explainability
    audit_trail: AuditTrail
    methodology: MethodologyTag
    steps_breakdown: list[CalculationStep]
```

### `WaterEngine` Class

```python
class WaterEngine:
    def __init__(self, water_input: WaterInput, audit_context: AuditContext) -> None:
        self.water_input = water_input
        self.audit_context = audit_context

    def calculate(self) -> WaterResult: ...
```

---

## Data Models

### Input Hash Computation

```python
import hashlib

raw_json = self.water_input.model_dump_json()
input_hash = hashlib.sha256(raw_json.encode("utf-8")).hexdigest()
```

### `MethodologyTag` Validation

```python
import re
from pydantic import field_validator

@field_validator("protocol_version")
@classmethod
def validate_version_format(cls, v: str) -> str:
    if not re.fullmatch(r"\d+\.\d+", v):
        raise ValueError("protocol_version must be in the format '<major>.<minor>'")
    return v
```

### Steps Breakdown — Step IDs, Formulas, and Ordering

The `steps_breakdown` always contains exactly 5 steps in this fixed order:

| Order | `step_id` | `label` | `formula` | `output_unit` |
|---|---|---|---|---|
| 1 | `total_withdrawal` | Total Water Withdrawal | `surface_water + groundwater + quarry_water_used + municipal_potable_water + external_wastewater + harvested_rainwater` | `m³/yr` |
| 2 | `total_discharge` | Total Water Discharge | `ocean + surface_water + subsurface_well + offsite_water_treatment + beneficial_other_users` | `m³/yr` |
| 3 | `kpi_1_consumption` | KPI 1 — Total Water Consumption | `total_water_withdrawal_m3 - total_water_discharge_m3` | `m³/yr` |
| 4 | `freshwater_consumption` | Total Freshwater Consumption | `total_water_consumption_m3 - harvested_rainwater_withdrawal_m3` | `m³/yr` |
| 5 | `kpi_2_intensity` | KPI 2 — Water Consumption Intensity | `(total_water_consumption_m3 × 1000) / cementitious_production_t_yr` | `L/t cementitious` |

### `inputs` Dictionary Format

Each entry in `inputs` is a dict with `value` and `unit`:

```json
{
  "surface_water_m3_yr": {"value": 500000.0, "unit": "m³/yr"},
  "groundwater_m3_yr": {"value": 0.0, "unit": "m³/yr"}
}
```

### KPI Calculation Logic

```
total_water_withdrawal_m3 = sum of all 6 withdrawal sources
total_water_discharge_m3  = sum of all 5 discharge destinations

total_water_consumption_m3 = max(0.0, total_water_withdrawal_m3 - total_water_discharge_m3)
  → if discharge > withdrawal: set to 0.0 and append warning

total_freshwater_consumption_m3 = max(0.0, total_water_consumption_m3 - harvested_rainwater)

water_consumption_per_tonne_litres = (total_water_consumption_m3 × 1000) / cementitious_production_t_yr
```

### Reference Validation Case

| Input | Value |
|---|---|
| `withdrawal.surface_water` | 500,000 m³ |
| `withdrawal.municipal_potable_water` | 50,000 m³ |
| `discharge.surface_water` | 100,000 m³ |
| `cementitious_production_t_yr` | 2,300,000 t |

| Expected Output | Value |
|---|---|
| `total_water_withdrawal_m3` | 550,000 |
| `total_water_discharge_m3` | 100,000 |
| `total_water_consumption_m3` | 450,000 |
| `total_freshwater_consumption_m3` | 450,000 |
| `water_consumption_per_tonne_litres` | ≈ 195.65 |

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

Before listing properties, redundancies are eliminated:

- Requirements 1.1–1.4 (model accepts each field) and 2.1 (model accepts discharge fields) are combined into one comprehensive model acceptance property.
- Requirements 1.5 and 2.2 (missing fields default to zero) are combined into one default-value property.
- Requirements 3.1 and 4.1 (withdrawal/discharge sums) are kept separate — they test different arithmetic paths.
- Requirements 3.2 and 4.2 (excluded fields don't affect totals) are combined into one exclusion invariant.
- Requirements 7.1–7.4 (special category pass-through) are combined into one round-trip property.
- Requirements 8.1–8.9 (steps breakdown structure and ordering) are combined into two properties: structural completeness and ordering.
- Requirements 9.1–9.2 (audit_trail structure) are combined into one structural property.
- Requirements 5.3 and 5.5 (clamping to zero) are combined into one non-negativity invariant.

---

### Property 1: WaterInput accepts all valid field combinations

*For any* combination of non-negative floats for all 6 withdrawal sources, all 5 discharge destinations, and the 4 special-category fields, constructing a `WaterInput` with a positive `cementitious_production_t_yr` must succeed without raising a validation error.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1**

---

### Property 2: Missing fields default to zero

*For any* `WaterInput` constructed with only `cementitious_production_t_yr` provided (all other fields omitted), the engine must treat all omitted withdrawal and discharge volumes as zero and complete the calculation without error.

**Validates: Requirements 1.5, 2.2**

---

### Property 3: Total withdrawal equals sum of 6 sources

*For any* `WaterInput` with non-negative values for all 6 withdrawal sources, `result.total_water_withdrawal_m3` must equal the arithmetic sum of `surface_water + groundwater + quarry_water_used + municipal_potable_water + external_wastewater + harvested_rainwater`.

**Validates: Requirements 3.1**

---

### Property 4: Excluded fields do not affect withdrawal or discharge totals

*For any* `WaterInput`, varying `quarry_water_not_used_m3_yr`, `recycled_water_m3_yr`, and `storm_water_collected_discharged_m3_yr` while holding all withdrawal and discharge source fields constant must leave `total_water_withdrawal_m3` and `total_water_discharge_m3` unchanged.

**Validates: Requirements 3.2, 4.2**

---

### Property 5: Total discharge equals sum of 5 destinations

*For any* `WaterInput` with non-negative values for all 5 discharge destinations, `result.total_water_discharge_m3` must equal the arithmetic sum of `ocean + surface_water + subsurface_well + offsite_water_treatment + beneficial_other_users`.

**Validates: Requirements 4.1**

---

### Property 6: KPI 1 consumption is non-negative and equals withdrawal minus discharge

*For any* `WaterInput`, `result.total_water_consumption_m3` must equal `max(0.0, total_water_withdrawal_m3 - total_water_discharge_m3)`. When discharge exceeds withdrawal, the result must be `0.0` and `result.warnings` must be non-empty.

**Validates: Requirements 5.1, 5.3**

---

### Property 7: Freshwater consumption excludes harvested rainwater and is non-negative

*For any* `WaterInput`, `result.total_freshwater_consumption_m3` must equal `max(0.0, total_water_consumption_m3 - withdrawal.harvested_rainwater)`.

**Validates: Requirements 5.4, 5.5**

---

### Property 8: KPI 2 intensity equals consumption × 1000 / production

*For any* `WaterInput` with positive `cementitious_production_t_yr`, `result.water_consumption_per_tonne_litres` must equal `(total_water_consumption_m3 × 1000.0) / cementitious_production_t_yr` within a tolerance of 0.01.

**Validates: Requirements 6.2**

---

### Property 9: Special category fields are passed through unchanged

*For any* `WaterInput`, `result.quarry_water_not_used_m3`, `result.recycled_water_m3`, `result.storm_water_collected_discharged_m3`, and `result.harvested_rainwater_withdrawal_m3` must equal the corresponding input fields exactly.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4**

---

### Property 10: Steps breakdown structural completeness

*For any* valid `WaterInput`, `result.steps_breakdown` must contain exactly 5 `CalculationStep` objects, each with non-None, non-empty values for `step_id`, `label`, `formula`, `inputs`, `output_value`, and `output_unit`.

**Validates: Requirements 8.1, 8.2, 8.9**

---

### Property 11: Steps breakdown ordering and step IDs

*For any* valid `WaterInput`, the `steps_breakdown` list must contain steps with `step_id` values `["total_withdrawal", "total_discharge", "kpi_1_consumption", "freshwater_consumption", "kpi_2_intensity"]` in exactly that order.

**Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.7, 8.8**

---

### Property 12: Input hash determinism

*For any* valid `WaterInput`, independently computing `SHA-256(water_input.model_dump_json().encode("utf-8")).hexdigest()` must produce the same value as `result.audit_trail.source_reference.input_hash`.

**Validates: Requirements 9.2, 9.3**

---

### Property 13: Audit trail structural completeness

*For any* valid `WaterInput` with a valid `AuditContext`, `result.audit_trail` must contain a `source_reference` with non-empty `source_filename`, `upload_timestamp_utc`, and `input_hash`, plus a `user_id` string.

**Validates: Requirements 9.1, 9.2**

---

### Property 14: Missing upload_timestamp_utc raises ValueError

*For any* `WaterInput`, constructing a `WaterEngine` without providing `upload_timestamp_utc` in the `AuditContext` must raise a `ValueError` with the message `"upload_timestamp_utc is required for audit trail"`.

**Validates: Requirements 9.4**

---

### Property 15: Invalid protocol_version raises ValueError

*For any* string that does NOT match `^\d+\.\d+$` (e.g. `"v0.1"`, `"0"`, `"0.1.0"`, `"abc"`), constructing a `MethodologyTag` with that `protocol_version` must raise a `ValueError` with the message `"protocol_version must be in the format '<major>.<minor>'"`.

**Validates: Requirements 10.3**

---

## Error Handling

| Condition | Behaviour |
|---|---|
| `upload_timestamp_utc` not provided to `WaterEngine` | Raise `ValueError("upload_timestamp_utc is required for audit trail")` |
| `protocol_version` does not match `^\d+\.\d+$` | Raise `ValueError("protocol_version must be in the format '<major>.<minor>'")` |
| `AuditContext` not passed to `WaterEngine` | Raise `TypeError` at construction time (required argument) |
| `cementitious_production_t_yr` ≤ 0 | Pydantic `ValidationError` at `WaterInput` construction time |
| Any withdrawal or discharge volume < 0 | Pydantic `ValidationError` at `WaterInput` construction time |
| `total_water_discharge_m3 > total_water_withdrawal_m3` | Set `total_water_consumption_m3 = 0.0`; append warning to `result.warnings` |
| `total_freshwater_consumption_m3` would be negative | Set to `0.0` silently |

---

## Testing Strategy

### Property-Based Testing Library

**`hypothesis`** (Python) — the standard PBT library for Python. Each property test runs a minimum of 100 iterations.

Tag format: `# Feature: water-engine, Property {N}: {property_text}`

### Unit Tests (example-based)

- Default methodology values (`"GCCA Water"`, `"0.1"`) when no override is provided.
- Default `user_id = "anonymous"` when not provided in `AuditContext`.
- Reference validation case from Requirement 11: inputs → expected outputs including `water_consumption_per_tonne_litres ≈ 195.65`.
- `ValueError` raised when `upload_timestamp_utc` is absent.
- Zero-input case: all withdrawal and discharge fields zero → all KPI outputs zero, all 5 steps still emitted.
- Discharge-exceeds-withdrawal case: `total_water_consumption_m3 = 0.0` and warning present.
- `steps_breakdown` has exactly 5 steps with correct `step_id` values in correct order.
- `kpi_2_intensity` step `inputs` dict contains the `1000 L/m³` conversion factor.

### Property Tests (hypothesis)

Each property from the Correctness Properties section maps to one `@given` test:

| Property | Hypothesis strategy |
|---|---|
| P1: WaterInput accepts all valid combinations | `st.floats(min_value=0, max_value=1e9)` for each field, `st.floats(min_value=0.001)` for production |
| P2: Missing fields default to zero | `st.builds(WaterInput, cementitious_production_t_yr=st.floats(min_value=0.001))` |
| P3: Total withdrawal sum | `st.floats(min_value=0, max_value=1e9)` × 6 sources |
| P4: Excluded fields don't affect totals | Fix withdrawal/discharge, vary excluded fields with `st.floats(min_value=0)` |
| P5: Total discharge sum | `st.floats(min_value=0, max_value=1e9)` × 5 destinations |
| P6: KPI 1 non-negative and correct | `st.builds(WaterInput, ...)` with full field generators |
| P7: Freshwater excludes rainwater | Same as P6 |
| P8: KPI 2 arithmetic | `st.floats(min_value=0)` for consumption, `st.floats(min_value=0.001)` for production |
| P9: Special category pass-through | `st.floats(min_value=0)` for each special field |
| P10: Steps structural completeness | `st.builds(WaterInput, ...)` |
| P11: Steps ordering and IDs | `st.builds(WaterInput, ...)` |
| P12: Input hash determinism | `st.builds(WaterInput, ...)` |
| P13: Audit trail structural completeness | `st.builds(WaterInput, ...)` + `st.builds(AuditContext, ...)` |
| P14: Missing timestamp raises ValueError | `st.builds(WaterInput, ...)` with no timestamp |
| P15: Invalid protocol_version raises | `st.text().filter(lambda s: not re.fullmatch(r"\d+\.\d+", s))` |

### Integration Tests

- End-to-end: call `WaterEngine.calculate()` with the Requirement 11 reference scenario and assert all 5 expected output values.
- Verify `input_hash` changes when any field of `WaterInput` changes (2 example calls with differing inputs).
- Verify `steps_breakdown[4].inputs` contains a key for the `1000 L/m³` conversion factor.
