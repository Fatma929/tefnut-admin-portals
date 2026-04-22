"""
Tefnut Carbon Engine — Validator implementations (Enterprise Hardening Phase).
All validators return a ValidationResult; they never raise.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from pydantic import ValidationError

from carbon_engine.validation import ValidationCode, ValidationResult

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SPECIFIC_CO2_WARN_MIN_KG_T = 300.0
SPECIFIC_CO2_WARN_MAX_KG_T = 1000.0
SPECIFIC_CO2_HARD_MIN_KG_T = 100.0
SPECIFIC_CO2_HARD_MAX_KG_T = 2000.0

WATER_UNIT_MISMATCH_THRESHOLD = 10_000_000.0

PRODUCTION_SCALE_MIN_T = 10.0
PRODUCTION_SCALE_MAX_T = 10_000_000.0

_PRODUCTION_FIELDS = {
    "cement_production_t_yr",
    "clinker_production_t_yr",
    "cementitious_production_t_yr",
}


# ---------------------------------------------------------------------------
# DuplicateRegistry — injectable, replaces module-level dict
# ---------------------------------------------------------------------------
class DuplicateRegistry:
    """In-process store mapping SHA-256 input hashes to first-seen timestamps."""

    def __init__(self) -> None:
        self._store: dict[str, str] = {}

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


# Module-level singleton used by both engines by default
_DEFAULT_REGISTRY = DuplicateRegistry()


# ---------------------------------------------------------------------------
# 1. Schema / Pydantic V2 validation
# ---------------------------------------------------------------------------
def validate_schema(model_class: Any, raw_data: dict) -> ValidationResult:
    """
    Attempt to construct a Pydantic model from raw_data.
    Maps Pydantic V2 errors to structured ErrorDetail items.
    """
    result = ValidationResult()
    try:
        model_class(**raw_data)
    except ValidationError as exc:
        for err in exc.errors():
            loc = err.get("loc", ())
            # Detect row index for list fields
            row_index: int | None = None
            clean_loc_parts = []
            for part in loc:
                if isinstance(part, int):
                    row_index = part
                else:
                    clean_loc_parts.append(str(part))
            field_path = ".".join(clean_loc_parts) if clean_loc_parts else "unknown"

            pydantic_type = err.get("type", "")
            input_val = err.get("input")

            if pydantic_type == "missing":
                result.add_error(
                    ValidationCode.MISSING_COLUMN,
                    field_path,
                    f"MISSING_COLUMN: Required field '{field_path}' is missing or null.",
                    suggested_fix=f"Provide a value for the required field '{field_path}'.",
                    meta={},
                )
            elif pydantic_type in (
                "greater_than_equal",
                "greater_than",
                "less_than_equal",
                "less_than",
                "float_parsing",
                "int_parsing",
            ):
                result.add_error(
                    ValidationCode.NEGATIVE_VALUE_ERROR,
                    field_path,
                    f"NEGATIVE_VALUE_ERROR: {field_path} — {err['msg']}",
                    meta={"submitted_value": input_val},
                )
            elif pydantic_type in ("enum", "literal_error"):
                ctx = err.get("ctx", {})
                # Pydantic V2 puts allowed values in ctx["expected"]
                raw_expected = ctx.get("expected", "")
                if isinstance(raw_expected, str):
                    # e.g. "'coal' or 'gas' or 'oil'"
                    allowed = [v.strip("' ") for v in raw_expected.split(" or ")]
                else:
                    allowed = [str(e) for e in raw_expected]
                meta: dict[str, Any] = {"submitted": input_val, "allowed": allowed}
                if row_index is not None:
                    meta["row"] = row_index
                result.add_error(
                    ValidationCode.INVALID_CATEGORY,
                    field_path,
                    (
                        f"INVALID_CATEGORY: {input_val!r} is not a valid value for '{field_path}'. "
                        f"Expected one of: {allowed}"
                    ),
                    suggested_fix=f"Use one of the allowed values: {allowed}.",
                    meta=meta,
                )
            else:
                result.add_error(
                    ValidationCode.NEGATIVE_VALUE_ERROR,
                    field_path,
                    f"VALIDATION_ERROR: {field_path} — {err['msg']}",
                    meta={"submitted_value": input_val},
                )
    return result


# ---------------------------------------------------------------------------
# 2. Negative-value sweep on a plain dict (pre-Pydantic)
# ---------------------------------------------------------------------------
def validate_no_negatives(data: dict, prefix: str = "") -> ValidationResult:
    """Recursively check all numeric values are >= 0."""
    result = ValidationResult()
    for key, val in data.items():
        full_key = f"{prefix}.{key}" if prefix else key
        if isinstance(val, dict):
            sub = validate_no_negatives(val, full_key)
            result.errors.extend(sub.errors)
            result.warnings.extend(sub.warnings)
            if not sub.is_valid:
                result.is_valid = False
                result.is_blocked = True
        elif isinstance(val, (int, float)) and val < 0:
            result.add_error(
                ValidationCode.NEGATIVE_VALUE_ERROR,
                full_key,
                f"NEGATIVE_VALUE_ERROR: '{full_key}' has a negative value ({val}). "
                "Physical quantities cannot be negative.",
                meta={"submitted_value": val},
            )
    return result


# ---------------------------------------------------------------------------
# 3. Production scale check (1000x guard)
# ---------------------------------------------------------------------------
def validate_production_scale(data: dict) -> ValidationResult:
    """
    Warn if any production field is outside the plausible range
    [PRODUCTION_SCALE_MIN_T, PRODUCTION_SCALE_MAX_T].
    Non-blocking — adds to warnings, does not block calculation.
    """
    result = ValidationResult()
    for field_name in _PRODUCTION_FIELDS:
        val = data.get(field_name)
        if val is None:
            continue
        if not isinstance(val, (int, float)):
            continue
        if val < PRODUCTION_SCALE_MIN_T or val > PRODUCTION_SCALE_MAX_T:
            suspected_scale = 1000 if val > PRODUCTION_SCALE_MAX_T else None
            suggested_val = val / 1000 if suspected_scale else None
            result.add_warning(
                ValidationCode.UNIT_MISMATCH_SUSPECTED,
                field_name,
                (
                    f"UNIT_MISMATCH_SUSPECTED: '{field_name}' = {val:,.0f} t/yr is outside the "
                    f"plausible range [{PRODUCTION_SCALE_MIN_T:,.0f}, {PRODUCTION_SCALE_MAX_T:,.0f}] t/yr. "
                    "Value may have been entered in the wrong unit (e.g. kg instead of tonnes)."
                ),
                meta={
                    "submitted_value": val,
                    "plausible_min_t_yr": PRODUCTION_SCALE_MIN_T,
                    "plausible_max_t_yr": PRODUCTION_SCALE_MAX_T,
                    **({"suspected_scale": suspected_scale, "suggested_corrected_value": suggested_val}
                       if suspected_scale else {}),
                },
            )
    return result


# ---------------------------------------------------------------------------
# 4. Carbon — out-of-industry-range check (post-calculation, warning)
# ---------------------------------------------------------------------------
def validate_specific_co2_range(specific_co2_kg_t: float) -> ValidationResult:
    """Warn if specific CO2 is outside the industry-standard range [300, 1000]."""
    result = ValidationResult()
    if not (SPECIFIC_CO2_WARN_MIN_KG_T <= specific_co2_kg_t <= SPECIFIC_CO2_WARN_MAX_KG_T):
        result.add_warning(
            ValidationCode.OUT_OF_INDUSTRY_RANGE,
            "specific_co2_kg_per_t_cement",
            (
                f"OUT_OF_INDUSTRY_RANGE: Specific CO₂ of {specific_co2_kg_t:.1f} kg/t is outside "
                f"the expected industry range of "
                f"{SPECIFIC_CO2_WARN_MIN_KG_T}–{SPECIFIC_CO2_WARN_MAX_KG_T} kg/t cementitious."
            ),
            meta={
                "computed_value": specific_co2_kg_t,
                "range_min": SPECIFIC_CO2_WARN_MIN_KG_T,
                "range_max": SPECIFIC_CO2_WARN_MAX_KG_T,
            },
        )
    return result


# ---------------------------------------------------------------------------
# 5. Carbon — hard physical limits (post-calculation, blocker)
# ---------------------------------------------------------------------------
def validate_specific_co2_hard_limits(specific_co2_kg_t: float) -> ValidationResult:
    """Block if specific CO2 is physically impossible (< 100 or > 2000 kg/t)."""
    result = ValidationResult()
    if not (SPECIFIC_CO2_HARD_MIN_KG_T <= specific_co2_kg_t <= SPECIFIC_CO2_HARD_MAX_KG_T):
        result.add_error(
            ValidationCode.CRITICAL_DATA_ERROR,
            "specific_co2_kg_per_t_cement",
            (
                f"CRITICAL_DATA_ERROR: Specific CO₂ of {specific_co2_kg_t:.1f} kg/t is physically "
                f"impossible for a cement plant. Valid range: "
                f"{SPECIFIC_CO2_HARD_MIN_KG_T}–{SPECIFIC_CO2_HARD_MAX_KG_T} kg/t."
            ),
            meta={
                "computed_value": specific_co2_kg_t,
                "hard_min": SPECIFIC_CO2_HARD_MIN_KG_T,
                "hard_max": SPECIFIC_CO2_HARD_MAX_KG_T,
            },
        )
    return result


# ---------------------------------------------------------------------------
# 6. Water — logical data check (discharge > withdrawal, non-blocking)
# ---------------------------------------------------------------------------
def validate_water_logic(total_withdrawal_m3: float, total_discharge_m3: float) -> ValidationResult:
    """Warn (non-blocking) if discharge exceeds withdrawal."""
    result = ValidationResult()
    if total_discharge_m3 > total_withdrawal_m3:
        result.add_warning(
            ValidationCode.NEGATIVE_CONSUMPTION_ERROR,
            "total_water_consumption_m3",
            (
                f"NEGATIVE_CONSUMPTION_ERROR: Total discharge ({total_discharge_m3:,.0f} m³) exceeds "
                f"total withdrawal ({total_withdrawal_m3:,.0f} m³). "
                "Water consumption cannot be negative; value has been clamped to 0.0 m³."
            ),
            meta={
                "total_withdrawal_m3": total_withdrawal_m3,
                "total_discharge_m3": total_discharge_m3,
            },
        )
    return result


# ---------------------------------------------------------------------------
# 7. Water — unit mismatch on volume fields
# ---------------------------------------------------------------------------
def validate_water_units(volume_fields: dict[str, float]) -> ValidationResult:
    """Warn if any water volume field exceeds the unit-mismatch threshold."""
    result = ValidationResult()
    for field_name, value in volume_fields.items():
        if isinstance(value, (int, float)) and value > WATER_UNIT_MISMATCH_THRESHOLD:
            result.add_warning(
                ValidationCode.UNIT_MISMATCH_SUSPECTED,
                field_name,
                (
                    f"UNIT_MISMATCH_SUSPECTED: '{field_name}' = {value:,.0f} m³/yr exceeds "
                    f"{WATER_UNIT_MISMATCH_THRESHOLD:,.0f} m³/yr. "
                    "Please verify if values are in m³ (not litres)."
                ),
                meta={
                    "submitted_value": value,
                    "threshold_m3_yr": WATER_UNIT_MISMATCH_THRESHOLD,
                    "suspected_scale": 1000,
                    "suggested_corrected_value": value / 1000,
                },
            )
    return result


# ---------------------------------------------------------------------------
# 8. Duplicate detection (idempotency)
# ---------------------------------------------------------------------------
def compute_input_hash(data: dict) -> str:
    """Compute a deterministic SHA-256 hash of a canonical JSON serialisation."""
    serialised = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(serialised.encode("utf-8")).hexdigest()


def validate_duplicate(
    input_hash: str,
    timestamp_utc: str,
    registry: DuplicateRegistry | None = None,
) -> ValidationResult:
    """
    Block if the same input hash has been seen before.
    Uses _DEFAULT_REGISTRY unless a custom registry is injected.
    """
    reg = registry if registry is not None else _DEFAULT_REGISTRY
    result = ValidationResult()
    first_seen = reg.check_and_register(input_hash, timestamp_utc)
    if first_seen is not None:
        result.add_error(
            ValidationCode.DUPLICATE_SUBMISSION,
            "input_hash",
            (
                f"DUPLICATE_SUBMISSION: This exact input was already processed at {first_seen}. "
                "Returning duplicate status without reprocessing."
            ),
            meta={
                "first_seen_timestamp": first_seen,
                "original_input_hash": input_hash,
            },
        )
    return result


def clear_duplicate_cache() -> None:
    """Clear the default in-process duplicate cache (useful for testing)."""
    _DEFAULT_REGISTRY.clear()
