# Design Document: Audit-Ready Engine

## Overview

This feature extends the Tefnut Carbon Engine with three capabilities required for regulatory transparency and third-party auditability under GCCA v3.1 and CBAM obligations:

1. **Audit Trail** — every `CalculationResult` carries a cryptographic fingerprint of its inputs, the source filename, the requesting user, and a UTC timestamp, so any reported figure can be traced back to its exact raw data.
2. **Methodology Versioning** — every result is tagged with the protocol name and version used, preserving historical validity when the methodology evolves.
3. **Explainable Calculations (Steps Breakdown)** — the API response includes a human-readable, machine-verifiable step-by-step breakdown of every intermediate computation, enabling auditors and engineers to reproduce the arithmetic independently.

The design is additive: all new fields are appended to existing Pydantic models, and the `CarbonEngine.calculate()` method is extended to populate them. No existing calculation logic is changed.

---

## Architecture

The feature touches three layers of the existing stack:

```
┌─────────────────────────────────────────────────────────┐
│  API Layer  (handler.py)                                │
│  • Injects source_filename, upload_timestamp_utc,       │
│    user_id into a new AuditContext dataclass            │
│  • Passes AuditContext to CarbonEngine constructor      │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│  Engine Layer  (carbon_engine.py)                       │
│  • New Pydantic models: AuditTrail, MethodologyTag,     │
│    CalculationStep                                      │
│  • CarbonEngine.__init__ accepts AuditContext           │
│  • calculate() populates audit_trail, methodology,      │
│    and steps_breakdown on CalculationResult             │
│  • Each _calc_* method returns (value, CalculationStep) │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│  Input Layer  (PlantInput / parser.py)                  │
│  • PlantInput gains optional methodology_override       │
│  • No parser changes required                           │
└─────────────────────────────────────────────────────────┘
```

The handler is the only place that knows the request context (filename, timestamp, user). It constructs an `AuditContext` and passes it to `CarbonEngine`. The engine is kept pure — it does not read from `datetime.now()` or environment variables directly; all context is injected.

---

## Components and Interfaces

### New Pydantic Models (`carbon_engine.py`)

```python
class SourceReference(BaseModel):
    source_filename: str
    upload_timestamp_utc: str          # ISO-8601, e.g. "2026-01-15T10:30:00Z"
    input_hash: str                    # SHA-256 hex digest of PlantInput JSON

class AuditTrail(BaseModel):
    source_reference: SourceReference
    user_id: str                       # Passed from request context; "anonymous" if absent
    raw_inputs: dict                   # PlantInput.model_dump(mode="json")

class MethodologyTag(BaseModel):
    protocol_name: str = "GCCA"
    protocol_version: str = "3.1"     # Validated: ^\d+\.\d+$

class CalculationStep(BaseModel):
    step_id: str                       # e.g. "calcination_b1", "fuel_coal_anthracite_kiln"
    label: str                         # Human-readable description
    formula: str                       # String representation of the equation
    inputs: dict[str, Any]             # {"clinker_production_t_yr": {"value": 100000, "unit": "t/yr"}}
    output_value: float
    output_unit: str                   # e.g. "tCO2", "kg CO2/t cement"
```

### Updated `CalculationResult`

```python
class CalculationResult(BaseModel):
    # ... existing fields unchanged ...
    audit_trail: AuditTrail
    methodology: MethodologyTag
    steps_breakdown: list[CalculationStep]
```

### New `AuditContext` Dataclass (injected by handler)

```python
@dataclass
class AuditContext:
    source_filename: str
    upload_timestamp_utc: str   # ISO-8601 UTC string
    user_id: str = "anonymous"
```

### Updated `CarbonEngine.__init__`

```python
class CarbonEngine:
    def __init__(self, plant: PlantInput, audit_context: AuditContext) -> None:
        self.plant = plant
        self.audit_context = audit_context
```

### Updated `PlantInput`

```python
class PlantInput(BaseModel):
    # ... existing fields unchanged ...
    methodology_override: Optional[MethodologyTag] = None
```

### Handler Changes (`handler.py`)

Both `_handle_json` and `_handle_upload` are updated to:
1. Capture `datetime.utcnow().isoformat() + "Z"` as `upload_timestamp_utc`.
2. Extract `user_id` from the `X-User-Id` request header (default `"anonymous"`).
3. Construct `AuditContext` and pass it to `CarbonEngine`.

---

## Data Models

### `AuditTrail` Population

The `input_hash` is computed inside `CarbonEngine.calculate()` as:

```python
import hashlib, json

raw_json = self.plant.model_dump_json()
input_hash = hashlib.sha256(raw_json.encode("utf-8")).hexdigest()
```

`raw_inputs` is populated as:

```python
raw_inputs = self.plant.model_dump(mode="json")
```

### `MethodologyTag` Validation

`protocol_version` is validated with a Pydantic `field_validator`:

```python
import re

@field_validator("protocol_version")
@classmethod
def validate_version_format(cls, v: str) -> str:
    if not re.fullmatch(r"\d+\.\d+", v):
        raise ValueError("protocol_version must be in the format '<major>.<minor>'")
    return v
```

### `CalculationStep` — Step IDs and Formulas

| `step_id` | Scope | Formula string |
|---|---|---|
| `calcination_b1` | Scope 1 | `CO2 = (clinker + bypass_dust + CKD×d) × EF / 1000` |
| `calcination_a1` | Scope 1 | `CO2 = KF × (1 - DR) × LOI_RM + CKD × EF_CKD` |
| `fuel_<type>_<kiln\|non_kiln>` | Scope 1 | `CO2 = consumption × LHV × EF / 1,000,000` |
| `scope2_electricity` | Scope 2 | `CO2 = purchased_mwh × grid_ef / 1000` |
| `specific_co2` | KPI | `specific_CO2 = (total_CO2e / cement_production) × 1000` |

### `inputs` Dictionary Format

Each entry in `inputs` is a dict with `value` and `unit`:

```json
{
  "clinker_production_t_yr": {"value": 100000, "unit": "t/yr"},
  "calcination_ef_kg_per_t_clinker": {"value": 525.0, "unit": "kg CO2/t clinker"}
}
```

### Step Ordering

Steps are appended in this fixed order:
1. Calcination step (`calcination_b1` or `calcination_a1`)
2. Fuel steps — kiln fuels first, then non-kiln fuels (one step per `FuelEntry`)
3. `scope2_electricity`
4. `specific_co2`

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

Before listing properties, redundancies are eliminated:

- Requirements 1.1 (audit_trail field exists) and 1.5 (raw_inputs round-trip) can be combined: if raw_inputs round-trips correctly, the field necessarily exists and is correctly typed.
- Requirements 2.1 (methodology field exists) and 2.2 (fields present) are combined into one structural property.
- Requirements 3.1 (steps_breakdown exists) and 3.2 (each step has all fields) are combined.
- Requirements 3.3 and 3.4 (calcination steps) are combined into one property parameterised by method.
- Requirements 2.5 (invalid version raises) and 2.4 (override is used) are kept separate — they test different behaviours.

---

### Property 1: Raw inputs round-trip

*For any* valid `PlantInput`, the `audit_trail.raw_inputs` dictionary in the `CalculationResult` must deserialise back to a `PlantInput` that is equal to the original.

**Validates: Requirements 1.1, 1.5**

---

### Property 2: Input hash determinism

*For any* valid `PlantInput`, independently computing `SHA-256(plant_input.model_dump_json().encode("utf-8")).hexdigest()` must produce the same value as `result.audit_trail.source_reference.input_hash`.

**Validates: Requirements 1.4**

---

### Property 3: Source filename is preserved

*For any* non-empty filename string passed as `AuditContext.source_filename`, the `result.audit_trail.source_reference.source_filename` must equal that string exactly.

**Validates: Requirements 1.2, 1.3**

---

### Property 4: Methodology tag structural completeness

*For any* valid `PlantInput` (with or without `methodology_override`), the `result.methodology` must be a `MethodologyTag` with non-empty `protocol_name` and a `protocol_version` matching `^\d+\.\d+$`.

**Validates: Requirements 2.1, 2.2, 2.3**

---

### Property 5: Methodology override is respected

*For any* valid `(protocol_name, protocol_version)` pair where `protocol_version` matches `^\d+\.\d+$`, setting `PlantInput.methodology_override` to that pair must result in `result.methodology.protocol_name` and `result.methodology.protocol_version` equalling those values.

**Validates: Requirements 2.4**

---

### Property 6: Invalid protocol_version raises ValueError

*For any* string that does NOT match `^\d+\.\d+$` (e.g. `"v3.1"`, `"3"`, `"3.1.0"`, `"abc"`), constructing a `MethodologyTag` with that `protocol_version` must raise a `ValueError` with the message `"protocol_version must be in the format '<major>.<minor>'"`.

**Validates: Requirements 2.5**

---

### Property 7: Methodology round-trip through JSON serialisation

*For any* valid `MethodologyTag`, serialising a `CalculationResult` to JSON and deserialising it back must produce a `MethodologyTag` equal to the original.

**Validates: Requirements 2.6**

---

### Property 8: Steps breakdown structural completeness

*For any* valid `PlantInput`, every `CalculationStep` in `result.steps_breakdown` must have non-None, non-empty values for `step_id`, `label`, `formula`, `inputs`, `output_value`, and `output_unit`.

**Validates: Requirements 3.1, 3.2**

---

### Property 9: Calcination step is always emitted

*For any* valid `PlantInput` using either Method A1 or B1, `result.steps_breakdown` must contain exactly one step with `step_id` equal to `"calcination_a1"` or `"calcination_b1"` (matching the method used), and its `output_value` must equal `result.scope1.calcination_co2_t`.

**Validates: Requirements 3.3, 3.4**

---

### Property 10: One fuel step per fuel entry

*For any* list of N fuel entries (kiln + non-kiln combined), `result.steps_breakdown` must contain exactly N steps whose `step_id` starts with `"fuel_"`, and each step's `output_value` must be non-negative.

**Validates: Requirements 3.5**

---

### Property 11: Fuel steps sum equals total fuel combustion CO2

*For any* list of fuel entries, the sum of `output_value` across all steps with `step_id` starting with `"fuel_"` must equal `result.scope1.fuel_combustion_co2_t` within a tolerance of 0.01 t.

**Validates: Requirements 3.10**

---

### Property 12: Step ordering invariant

*For any* valid `PlantInput`, the `steps_breakdown` list must satisfy: all Scope 1 steps (calcination + fuel) appear before the `scope2_electricity` step, which appears before the `specific_co2` step.

**Validates: Requirements 3.8**

---

## Error Handling

| Condition | Behaviour |
|---|---|
| `upload_timestamp_utc` not provided to `CarbonEngine` | Raise `ValueError("upload_timestamp_utc is required for audit trail")` |
| `protocol_version` does not match `^\d+\.\d+$` | Raise `ValueError("protocol_version must be in the format '<major>.<minor>'")` |
| `AuditContext` not passed to `CarbonEngine` | Raise `TypeError` at construction time (required argument) |
| `PlantInput.model_dump_json()` fails (should never happen with valid model) | Propagate exception; do not silently swallow |

All existing error handling in `handler.py` (`ValidationError`, `TemplateParseError`) is unchanged.

---

## Testing Strategy

### Property-Based Testing Library

**`hypothesis`** (Python) — the standard PBT library for Python. Each property test runs a minimum of 100 iterations.

Tag format: `# Feature: audit-ready-engine, Property {N}: {property_text}`

### Unit Tests (example-based)

- Default methodology values (`"GCCA"`, `"3.1"`) when no override is provided.
- JSON endpoint sets `source_filename = "json_input"`.
- Upload endpoint preserves the original filename.
- `ValueError` is raised when `upload_timestamp_utc` is absent.
- Zero-input scopes still emit their `CalculationStep` with `output_value == 0.0` (Requirement 3.9).
- Step ordering with a full plant (calcination + 2 fuels + electricity).

### Property Tests (hypothesis)

Each property from the Correctness Properties section maps to one `@given` test:

| Property | Hypothesis strategy |
|---|---|
| P1: Raw inputs round-trip | `st.builds(PlantInput, ...)` with valid field generators |
| P2: Input hash determinism | Same strategy; compute hash independently |
| P3: Source filename preserved | `st.text(min_size=1)` for filename |
| P4: Methodology structural completeness | `st.builds(PlantInput, ...)` |
| P5: Methodology override respected | `st.from_regex(r"\d+\.\d+")` for version, `st.text(min_size=1)` for name |
| P6: Invalid version raises | `st.text().filter(lambda s: not re.fullmatch(r"\d+\.\d+", s))` |
| P7: Methodology JSON round-trip | `st.builds(MethodologyTag, ...)` |
| P8: Steps structural completeness | `st.builds(PlantInput, ...)` |
| P9: Calcination step emitted | Separate strategies for A1 and B1 inputs |
| P10: One fuel step per entry | `st.lists(st.builds(FuelEntry, ...), min_size=0, max_size=10)` |
| P11: Fuel steps sum | Same as P10 |
| P12: Step ordering | `st.builds(PlantInput, ...)` |

### Integration Tests

- End-to-end: POST `/api/calculate` with a JSON body returns a response containing `audit_trail`, `methodology`, and `steps_breakdown`.
- End-to-end: POST `/api/calculate/upload` with an `.xlsx` file returns `audit_trail.source_reference.source_filename` equal to the uploaded filename.
- Verify `input_hash` changes when any field of `PlantInput` changes (2 example calls).
