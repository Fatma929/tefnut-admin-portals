# Design Document — Bulletproof Validation Layer

## Overview

The Bulletproof Validation Layer is a shared, engine-agnostic validation subsystem that intercepts all incoming data for both the Carbon Engine and the Water Engine before any calculation is performed. It returns structured, machine-readable `ValidationResult` objects containing typed `ErrorDetail` and `WarningDetail` items, each carrying an `error_code`, `field`, `message`, `suggested_fix`, and `meta` block.

The layer is implemented as a single shared module (`carbon_engine/validators.py`) that is already imported by both engines. This design upgrades that module and the companion `carbon_engine/validation.py` to satisfy the full requirements contract, including:

- Pydantic V2 schema validation for `PlantInput` (carbon) and `WaterInput` (water)
- Negative-value sweeps across all numeric fields
- Logical sanity checks (discharge > withdrawal, zero-CO₂ with non-zero fuel)
- Unit-scale / order-of-magnitude warnings
- SHA-256 idempotency via a `DuplicateRegistry`
- `FuelType` and `WaterSource` enum enforcement
- Hard physical-limit checks that halt calculation (`CRITICAL_DATA_ERROR`, `NEGATIVE_CONSUMPTION_ERROR`)
- Post-calculation inter-field consistency checks (`INCONSISTENT_FUEL_DATA`, `INCONSISTENT_PROCESS_DATA`)

Both engines expose a `validate_input(raw_data, timestamp_utc)` class method that returns a `ValidationResult` without raising. The `calculate()` method on each engine runs its own post-calculation checks and merges the results into the final response object.

---

## Architecture

The validation layer sits between the API handler and the calculation engine in a three-stage pipeline:

```
┌──────────────────────────────────────────────────────────────────────┐
│  API Handler (handler.py / future water handler)                     │
│  • Deserialises raw JSON / file upload                               │
│  • Calls Engine.validate_input(raw_data, timestamp_utc)              │
│  • If ValidationResult.is_blocked → return 422 with errors list      │
│  • Else → construct typed model, call Engine.calculate()             │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Pre-Calculation Validation  (validators.py)                         │
│  Stage 1 — Schema (Pydantic V2): MISSING_COLUMN, INVALID_CATEGORY,  │
│             NEGATIVE_VALUE_ERROR                                     │
│  Stage 2 — Negative sweep on raw dict                                │
│  Stage 3 — Unit / scale checks: UNIT_MISMATCH_SUSPECTED             │
│  Stage 4 — Duplicate detection: DUPLICATE_SUBMISSION                │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Calculation Engine  (carbon_engine.py / water_engine.py)            │
│  • Runs domain calculation                                           │
│  • Post-calc checks: OUT_OF_INDUSTRY_RANGE, CRITICAL_DATA_ERROR,    │
│    NEGATIVE_CONSUMPTION_ERROR, INCONSISTENT_FUEL_DATA,              │
│    INCONSISTENT_PROCESS_DATA                                         │
│  • Merges post-calc issues into CalculationResult.validation_result  │
└──────────────────────────────────────────────────────────────────────┘
```

### Blocker vs. Warning Decision

| Code | Stage | Blocks calculation? |
|---|---|---|
| `MISSING_COLUMN` | Pre-calc | Yes |
| `NEGATIVE_VALUE_ERROR` | Pre-calc | Yes |
| `INVALID_CATEGORY` | Pre-calc | Yes |
| `DUPLICATE_SUBMISSION` | Pre-calc | Yes |
| `CRITICAL_DATA_ERROR` | Post-calc | Yes |
| `NEGATIVE_CONSUMPTION_ERROR` | Post-calc | No (clamps to 0) |
| `UNIT_MISMATCH_SUSPECTED` | Pre-calc | No |
| `INCONSISTENT_FUEL_DATA` | Post-calc | No |
| `INCONSISTENT_PROCESS_DATA` | Post-calc | No |
| `OUT_OF_INDUSTRY_RANGE` | Post-calc | No |

---

## Components and Interfaces

### Shared Module: `carbon_engine/validation.py`

Defines all Pydantic V2 models for the error contract and the `ValidationResult` aggregate.

### Shared Module: `carbon_engine/validators.py`

Contains all validator functions. Both engines import from this module. No engine-specific logic lives here — validators are pure functions that accept plain Python values and return `ValidationResult`.

### `DuplicateRegistry`

A class (replacing the current module-level `_SEEN_HASHES` dict) that encapsulates the in-process hash store. It is injectable for testing.

```python
class DuplicateRegistry:
    def __init__(self) -> None:
        self._store: dict[str, str] = {}   # hash → ISO-8601 timestamp

    def check_and_register(self, input_hash: str, timestamp_utc: str) -> str | None:
        """
        Returns the first_seen_timestamp if the hash is a duplicate,
        otherwise registers it and returns None.
        """
        if input_hash in self._store:
            return self._store[input_hash]
        self._store[input_hash] = timestamp_utc
        return None

    def clear(self) -> None:
        self._store.clear()

# Module-level singleton (used by both engines by default)
_DEFAULT_REGISTRY = DuplicateRegistry()
```

### Engine Integration Points

**CarbonEngine** (`carbon_engine.py`):
- `CarbonEngine.validate_input(raw_data, timestamp_utc, registry?)` — pre-calc validation
- `CarbonEngine.calculate()` — runs post-calc checks, returns `CalculationResult` with embedded `ValidationResult`

**WaterEngine** (`water_engine.py`):
- `WaterEngine.validate_input(raw_data, timestamp_utc, registry?)` — pre-calc validation
- `WaterEngine.calculate()` — runs post-calc checks, returns `WaterResult` with embedded `ValidationResult`

Both engines return a combined response object:

```python
class EngineResponse(BaseModel):
    result: CalculationResult | WaterResult | None   # None when blocked
    validation: ValidationResult
```

---

## Data Models

### `ErrorDetail` (Pydantic V2)

```python
class ErrorDetail(BaseModel):
    error_code: str          # e.g. "MISSING_COLUMN"
    field: str               # dot-path to the offending field
    message: str             # human-readable description
    suggested_fix: str       # never null; corrective action string
    meta: dict = {}          # optional structured context
```

### `WarningDetail` (Pydantic V2)

```python
class WarningDetail(BaseModel):
    error_code: str
    field: str
    message: str
    suggested_fix: str
    meta: dict = {}
```

`WarningDetail` is structurally identical to `ErrorDetail`; the distinction is carried by which list they appear in (`errors` vs `warnings`).

### `ValidationResult` (Pydantic V2)

```python
class ValidationResult(BaseModel):
    is_valid: bool = True
    is_blocked: bool = False   # True when any blocker error is present
    errors: list[ErrorDetail] = []
    warnings: list[WarningDetail] = []

    def add_error(self, code, field, message, suggested_fix, meta=None) -> None: ...
    def add_warning(self, code, field, message, suggested_fix, meta=None) -> None: ...

    def to_response_dict(self) -> dict:
        """Serialise to the wire format expected by the API contract."""
        if self.is_blocked:
            return {
                "status": "VALIDATION_FAILED",
                "errors": [e.model_dump() for e in self.errors],
                "warnings": [w.model_dump() for w in self.warnings],
            }
        return {
            "status": "OK",
            "warnings": [w.model_dump() for w in self.warnings],
        }
```

### `ValidationCode` Enum

```python
class ValidationCode(str, Enum):
    # Blockers
    MISSING_COLUMN           = "MISSING_COLUMN"
    NEGATIVE_VALUE_ERROR     = "NEGATIVE_VALUE_ERROR"
    INVALID_CATEGORY         = "INVALID_CATEGORY"
    DUPLICATE_SUBMISSION     = "DUPLICATE_SUBMISSION"
    CRITICAL_DATA_ERROR      = "CRITICAL_DATA_ERROR"
    # Warnings
    NEGATIVE_CONSUMPTION_ERROR  = "NEGATIVE_CONSUMPTION_ERROR"
    UNIT_MISMATCH_SUSPECTED     = "UNIT_MISMATCH_SUSPECTED"
    INCONSISTENT_FUEL_DATA      = "INCONSISTENT_FUEL_DATA"
    INCONSISTENT_PROCESS_DATA   = "INCONSISTENT_PROCESS_DATA"
    OUT_OF_INDUSTRY_RANGE       = "OUT_OF_INDUSTRY_RANGE"
```

### `FuelType` Enum (existing, in `carbon_engine.py`)

Already defined. No changes required. The validator maps Pydantic enum errors to `INVALID_CATEGORY` with `meta.allowed` populated from `FuelType` members.

### `WaterSource` Enum (new, in `water_engine.py`)

```python
class WaterSource(str, Enum):
    SURFACE_WATER        = "surface_water"
    GROUNDWATER          = "groundwater"
    QUARRY_WATER_USED    = "quarry_water_used"
    MUNICIPAL_POTABLE_WATER = "municipal_potable_water"
    EXTERNAL_WASTEWATER  = "external_wastewater"
    HARVESTED_RAINWATER  = "harvested_rainwater"
```

Members correspond 1-to-1 with the sub-fields of `WaterWithdrawal`.

### `PlantInput` (existing, in `carbon_engine.py`)

No structural changes. The validator wraps Pydantic V2 `ValidationError` and maps each error to the new `ErrorDetail` model.

### `WaterInput` (existing, in `water_engine.py`)

No structural changes. Same wrapping approach.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: Missing required fields are all reported

*For any* input payload where one or more required fields are absent or set to null, the validation layer SHALL return a `ValidationResult` whose `errors` list contains exactly one `MISSING_COLUMN` entry per missing field, each with the correct `field` name — without short-circuiting after the first missing field.

**Validates: Requirements 1.1, 1.2, 1.4**

---

### Property 2: Negative numeric values are all reported with submitted value in meta

*For any* input payload where one or more numeric fields that must be non-negative contain a negative value, the validation layer SHALL return a `ValidationResult` whose `errors` list contains one `NEGATIVE_VALUE_ERROR` entry per offending field, each with the correct `field` name and the submitted value in the `meta` block.

**Validates: Requirements 2.1, 2.2, 2.3**

---

### Property 3: Water discharge exceeding withdrawal raises non-blocking error and clamps consumption

*For any* `WaterInput` where the sum of all discharge sub-fields is strictly greater than the sum of all withdrawal sub-fields, the `WaterEngine.calculate()` result SHALL contain a `NEGATIVE_CONSUMPTION_ERROR` entry in `validation_warnings` AND the `total_water_consumption_m3` field SHALL equal `0.0` (clamped).

**Validates: Requirements 3.1, 3.2, 10.3, 10.4**

---

### Property 4: CO₂ out-of-industry-range triggers warning; in-range produces no warning

*For any* `PlantInput` that produces a `specific_co2_kg_per_t_cement` value outside the range `[300, 1000]`, the `CalculationResult` SHALL contain an `OUT_OF_INDUSTRY_RANGE` entry in `validation_warnings`. Conversely, *for any* input that produces a value within `[300, 1000]`, no `OUT_OF_INDUSTRY_RANGE` warning SHALL be present.

**Validates: Requirements 4.1, 4.3**

---

### Property 5: Water volume fields exceeding threshold trigger non-blocking unit-mismatch warning

*For any* `WaterInput` where any individual withdrawal sub-field, discharge sub-field, or ancillary volume field (`quarry_water_not_used_m3_yr`, `recycled_water_m3_yr`, `storm_water_collected_discharged_m3_yr`) exceeds `10,000,000`, the validation layer SHALL add a `UNIT_MISMATCH_SUSPECTED` entry to `warnings` identifying the specific field — and the calculation SHALL still proceed (non-blocking).

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 11.3, 11.4**

---

### Property 6: Input hash is deterministic

*For any* valid input object `x`, calling `compute_input_hash(x)` twice SHALL produce the same SHA-256 hex string. Equivalently, the hash function is a pure function of the canonical JSON serialisation of `x`.

**Validates: Requirements 6.1, 6.5, 13.2, 13.5**

---

### Property 7: Duplicate submission is detected, blocked, and returns first-seen metadata

*For any* valid input `x` submitted twice to the same `DuplicateRegistry`, the second submission SHALL return a `ValidationResult` with a `DUPLICATE_SUBMISSION` error containing `first_seen_timestamp` and `original_input_hash` in the `meta` block, and the calculation SHALL NOT proceed.

**Validates: Requirements 6.2, 6.3, 13.1, 13.3, 13.6**

---

### Property 8: Invalid enum values produce INVALID_CATEGORY errors with allowed-values list

*For any* input containing a `fuel_type` value not in `FuelType` or a `water_source` key not in `WaterSource`, the validation layer SHALL return an `INVALID_CATEGORY` error with the submitted value in `meta.submitted`, the full list of allowed values in `meta.allowed`, and (for list fields) the row index in `meta.row`.

**Validates: Requirements 7.1, 7.2, 7.3, 8.2, 8.3**

---

### Property 9: Every error response round-trips through JSON without data loss

*For any* `ErrorDetail` or `WarningDetail` object produced by the validation layer, serialising it to JSON and deserialising it back SHALL produce an object equal to the original. Every such object SHALL contain non-null, non-empty values for `error_code`, `field`, `message`, and `suggested_fix`.

**Validates: Requirements 9.1, 9.2, 9.4, 9.5, 9.6**

---

### Property 10: CO₂ outside hard physical limits halts calculation

*For any* `PlantInput` that produces a `specific_co2_kg_per_t_cement` value below `100 kg/t` or above `2000 kg/t`, the engine SHALL raise a `CRITICAL_DATA_ERROR` and SHALL NOT return a `CalculationResult` (the result field SHALL be `None` or absent).

**Validates: Requirements 10.1, 10.2**

---

### Property 11: Production values outside plausible range trigger non-blocking unit-mismatch warning

*For any* `PlantInput` or `WaterInput` where `cement_production_t_yr`, `clinker_production_t_yr`, or `cementitious_production_t_yr` is less than `10` or greater than `10,000,000`, the validation layer SHALL add a `UNIT_MISMATCH_SUSPECTED` entry to `warnings` identifying the specific field — and the calculation SHALL still proceed (non-blocking).

**Validates: Requirements 11.1, 11.2, 11.5**

---

### Property 12: Inter-field inconsistencies are all reported without short-circuiting

*For any* `PlantInput` where (a) total fuel consumption > 0 but fuel combustion CO₂ = 0, or (b) clinker production > 0 but calcination CO₂ = 0, the engine SHALL append the corresponding `INCONSISTENT_FUEL_DATA` or `INCONSISTENT_PROCESS_DATA` entry to `validation_warnings`, including the offending computed value in `meta`. When both conditions hold simultaneously, both entries SHALL be present.

**Validates: Requirements 12.1, 12.2, 12.4, 12.5**

---

## Error Handling

### Pre-Calculation Errors (Blockers)

When `ValidationResult.is_blocked` is `True`, the handler returns HTTP 422 with the body:

```json
{
  "status": "VALIDATION_FAILED",
  "errors": [
    {
      "error_code": "MISSING_COLUMN",
      "field": "cement_production_t_yr",
      "message": "Required field 'cement_production_t_yr' is missing or null.",
      "suggested_fix": "Provide a positive float value for cement_production_t_yr (tonnes per year).",
      "meta": {}
    }
  ],
  "warnings": []
}
```

### Duplicate Submission Response

```json
{
  "status": "DUPLICATE_INPUT_DETECTED",
  "errors": [
    {
      "error_code": "DUPLICATE_SUBMISSION",
      "field": "input_hash",
      "message": "This exact input was already processed at 2024-01-15T10:30:00Z.",
      "suggested_fix": "If this is an intentional resubmission, modify at least one field to generate a new hash.",
      "meta": {
        "first_seen_timestamp": "2024-01-15T10:30:00Z",
        "original_input_hash": "abc123..."
      }
    }
  ],
  "warnings": []
}
```

### Post-Calculation Warnings (Non-Blocking)

Warnings are embedded in the calculation result:

```json
{
  "result": { ... },
  "validation": {
    "status": "OK",
    "warnings": [
      {
        "error_code": "OUT_OF_INDUSTRY_RANGE",
        "field": "specific_co2_kg_per_t_cement",
        "message": "Specific CO2 of 1200.0 kg/t is outside the expected industry range of 300–1000 kg/t.",
        "suggested_fix": "Review fuel consumption and calcination inputs for data entry errors.",
        "meta": { "computed_value": 1200.0, "range_min": 300, "range_max": 1000 }
      }
    ]
  }
}
```

### `suggested_fix` Strings by Error Code

| Error Code | Suggested Fix |
|---|---|
| `MISSING_COLUMN` | "Provide a value for the required field '{field}'." |
| `NEGATIVE_VALUE_ERROR` | "Replace the negative value with a non-negative number. Physical quantities cannot be negative." |
| `INVALID_CATEGORY` | "Use one of the allowed values: {meta.allowed}." |
| `DUPLICATE_SUBMISSION` | "If this is an intentional resubmission, modify at least one field to generate a new hash." |
| `CRITICAL_DATA_ERROR` | "Review all input fields. The computed CO₂ value is physically impossible for a cement plant." |
| `NEGATIVE_CONSUMPTION_ERROR` | "Verify that total discharge does not exceed total withdrawal. Consumption has been clamped to 0." |
| `UNIT_MISMATCH_SUSPECTED` | "Verify that the value is in the correct unit (m³ for water, tonnes for production)." |
| `INCONSISTENT_FUEL_DATA` | "Check that fuel emission factors are non-zero and fuel consumption is correctly entered." |
| `INCONSISTENT_PROCESS_DATA` | "Check that the calcination emission factor and clinker production are correctly entered." |
| `OUT_OF_INDUSTRY_RANGE` | "Review fuel consumption and calcination inputs. The computed specific CO₂ is outside the typical cement industry range of 300–1000 kg/t." |

### No Tracebacks in Responses

All validator functions are wrapped in `try/except` blocks. Internal exceptions are logged at `ERROR` level and converted to a generic `CRITICAL_DATA_ERROR` response. Python tracebacks and module paths are never serialised into the response body.

---

## Testing Strategy

### Dual Testing Approach

Unit tests cover specific examples and edge cases. Property-based tests verify universal properties across many generated inputs.

### Property-Based Testing Library

**Hypothesis** (Python) is the chosen PBT library. Each property test is configured with `@settings(max_examples=100)`.

Tag format for each test:
```
# Feature: bulletproof-validation-layer, Property {N}: {property_text}
```

### Property Test Implementations

Each of the 12 correctness properties maps to one Hypothesis test:

| Property | Hypothesis Strategy |
|---|---|
| P1 — Missing fields | `st.fixed_dictionaries` with random required fields removed |
| P2 — Negative values | `st.floats(max_value=-0.001)` injected into random numeric fields |
| P3 — Discharge > withdrawal | `st.floats(min_value=0)` with discharge > withdrawal constraint |
| P4 — CO₂ range | `st.builds(PlantInput, ...)` with inputs tuned to produce out-of-range CO₂ |
| P5 — Water unit mismatch | `st.floats(min_value=10_000_001)` for withdrawal fields |
| P6 — Hash determinism | `st.builds(WaterInput, ...)` or `st.builds(PlantInput, ...)` |
| P7 — Duplicate detection | Submit same generated input twice to a fresh `DuplicateRegistry` |
| P8 — Enum validation | `st.text()` filtered to exclude valid enum values |
| P9 — Error round-trip | `st.builds(ErrorDetail, ...)` with random field values |
| P10 — Critical CO₂ limits | Inputs producing CO₂ < 100 or > 2000 |
| P11 — Production scale | `st.floats(max_value=9.9)` or `st.floats(min_value=10_000_001)` |
| P12 — Inter-field consistency | Inputs with fuel consumption but zero-EF fuels |

### Unit Tests

Unit tests cover:
- Each error code with a concrete minimal example
- The `DuplicateRegistry.check_and_register` method
- The `compute_input_hash` function with known inputs
- The `suggested_fix` field is non-null for every `ValidationCode` member
- Handler integration: 422 response on blocked validation, 200 with warnings on non-blocking

### Test File Locations

```
carbon_engine/tests/test_validation.py      # unit tests for validators.py
carbon_engine/tests/test_validation_pbt.py  # Hypothesis property tests
water_engine/tests/test_water_validation.py # water-engine-specific validation tests
```
