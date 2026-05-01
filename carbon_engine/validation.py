"""
Tefnut Carbon Engine — Enterprise Validation Layer (Pydantic V2)
Provides structured error/warning codes and models for all validation checks.
"""
from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Validation Codes
# ---------------------------------------------------------------------------
class ValidationCode(str, Enum):
    # Blockers — halt calculation
    MISSING_COLUMN = "MISSING_COLUMN"
    NEGATIVE_VALUE_ERROR = "NEGATIVE_VALUE_ERROR"
    INVALID_CATEGORY = "INVALID_CATEGORY"
    DUPLICATE_SUBMISSION = "DUPLICATE_SUBMISSION"
    CRITICAL_DATA_ERROR = "CRITICAL_DATA_ERROR"
    # Warnings — non-blocking, calculation proceeds
    NEGATIVE_CONSUMPTION_ERROR = "NEGATIVE_CONSUMPTION_ERROR"
    UNIT_MISMATCH_SUSPECTED = "UNIT_MISMATCH_SUSPECTED"
    INCONSISTENT_FUEL_DATA = "INCONSISTENT_FUEL_DATA"
    INCONSISTENT_PROCESS_DATA = "INCONSISTENT_PROCESS_DATA"
    OUT_OF_INDUSTRY_RANGE = "OUT_OF_INDUSTRY_RANGE"


# Codes that block calculation
_BLOCKER_CODES = {
    ValidationCode.MISSING_COLUMN,
    ValidationCode.NEGATIVE_VALUE_ERROR,
    ValidationCode.INVALID_CATEGORY,
    ValidationCode.DUPLICATE_SUBMISSION,
    ValidationCode.CRITICAL_DATA_ERROR,
}

# Default suggested_fix strings per code
_SUGGESTED_FIX: dict[ValidationCode, str] = {
    ValidationCode.MISSING_COLUMN: (
        "Provide a value for the required field. Check the API schema for the expected type."
    ),
    ValidationCode.NEGATIVE_VALUE_ERROR: (
        "Replace the negative value with a non-negative number. Physical quantities cannot be negative."
    ),
    ValidationCode.INVALID_CATEGORY: (
        "Use one of the allowed values listed in the 'meta.allowed' field of this error."
    ),
    ValidationCode.DUPLICATE_SUBMISSION: (
        "If this is an intentional resubmission, modify at least one field to generate a new hash."
    ),
    ValidationCode.CRITICAL_DATA_ERROR: (
        "Review all input fields. The computed value is physically impossible for a cement plant."
    ),
    ValidationCode.NEGATIVE_CONSUMPTION_ERROR: (
        "Verify that total discharge does not exceed total withdrawal. Consumption has been clamped to 0."
    ),
    ValidationCode.UNIT_MISMATCH_SUSPECTED: (
        "Verify that the value is in the correct unit (m³ for water, tonnes for production). "
        "Divide by 1,000 if the value was entered in litres or kg."
    ),
    ValidationCode.INCONSISTENT_FUEL_DATA: (
        "Check that fuel emission factors are non-zero and fuel consumption is correctly entered."
    ),
    ValidationCode.INCONSISTENT_PROCESS_DATA: (
        "Check that the calcination emission factor and clinker production are correctly entered."
    ),
    ValidationCode.OUT_OF_INDUSTRY_RANGE: (
        "Review fuel consumption and calcination inputs. "
        "The computed specific CO₂ is outside the typical cement industry range of 300–1000 kg/t."
    ),
}


# ---------------------------------------------------------------------------
# Error / Warning Detail Models (Pydantic V2)
# ---------------------------------------------------------------------------
class ErrorDetail(BaseModel):
    error_code: str
    field: str
    message: str
    suggested_fix: str
    meta: dict[str, Any] = Field(default_factory=dict)


class WarningDetail(BaseModel):
    error_code: str
    field: str
    message: str
    suggested_fix: str
    meta: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# ValidationResult aggregate
# ---------------------------------------------------------------------------
class ValidationResult(BaseModel):
    is_valid: bool = True
    is_blocked: bool = False
    errors: list[ErrorDetail] = Field(default_factory=list)
    warnings: list[WarningDetail] = Field(default_factory=list)

    def add_error(
        self,
        code: ValidationCode,
        field_name: str,
        message: str,
        suggested_fix: str | None = None,
        meta: dict | None = None,
    ) -> None:
        fix = suggested_fix or _SUGGESTED_FIX.get(code, "Review the submitted value.")
        self.errors.append(
            ErrorDetail(
                error_code=code.value,
                field=field_name,
                message=message,
                suggested_fix=fix,
                meta=meta or {},
            )
        )
        self.is_valid = False
        if code in _BLOCKER_CODES:
            self.is_blocked = True

    def add_warning(
        self,
        code: ValidationCode,
        field_name: str,
        message: str,
        suggested_fix: str | None = None,
        meta: dict | None = None,
    ) -> None:
        fix = suggested_fix or _SUGGESTED_FIX.get(code, "Review the submitted value.")
        self.warnings.append(
            WarningDetail(
                error_code=code.value,
                field=field_name,
                message=message,
                suggested_fix=fix,
                meta=meta or {},
            )
        )

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
            "errors": [],   # always present for frontend consistency
            "warnings": [w.model_dump() for w in self.warnings],
        }

    # Backwards-compat: allow iteration over errors as dicts
    def to_dict(self) -> dict:
        return {
            "is_valid": self.is_valid,
            "is_blocked": self.is_blocked,
            "error_count": len(self.errors),
            "warning_count": len(self.warnings),
            "errors": [e.model_dump() for e in self.errors],
            "warnings": [w.model_dump() for w in self.warnings],
        }
