from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator

from carbon_engine.validation import ValidationCode, ValidationResult
from carbon_engine.validators import (
    DuplicateRegistry,
    compute_input_hash,
    validate_duplicate,
    validate_no_negatives,
    validate_production_scale,
    validate_schema,
    validate_water_logic,
    validate_water_units,
)


# ---------------------------------------------------------------------------
# WaterSource Enum — enforces approved water source taxonomy
# ---------------------------------------------------------------------------
class WaterSource(str, Enum):
    SURFACE_WATER = "surface_water"
    GROUNDWATER = "groundwater"
    QUARRY_WATER_USED = "quarry_water_used"
    MUNICIPAL_POTABLE_WATER = "municipal_potable_water"
    EXTERNAL_WASTEWATER = "external_wastewater"
    HARVESTED_RAINWATER = "harvested_rainwater"


_VALID_WATER_SOURCES = {ws.value for ws in WaterSource}


# ---------------------------------------------------------------------------
# AuditContext — plain dataclass injected by the handler
# ---------------------------------------------------------------------------
@dataclass
class AuditContext:
    source_filename: str
    upload_timestamp_utc: str
    user_id: str = "anonymous"


# ---------------------------------------------------------------------------
# Input Models
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Output Models
# ---------------------------------------------------------------------------
class SourceReference(BaseModel):
    source_filename: str
    upload_timestamp_utc: str
    input_hash: str


class AuditTrail(BaseModel):
    source_reference: SourceReference
    user_id: str


class MethodologyTag(BaseModel):
    protocol_name: str = "GCCA Water"
    protocol_version: str = "0.1"

    @field_validator("protocol_version")
    @classmethod
    def validate_version_format(cls, v: str) -> str:
        if not re.fullmatch(r"\d+\.\d+", v):
            raise ValueError("protocol_version must be in the format '<major>.<minor>'")
        return v


class CalculationStep(BaseModel):
    step_id: str
    label: str
    formula: str
    inputs: dict[str, Any]
    output_value: float
    output_unit: str


class WaterResult(BaseModel):
    total_water_withdrawal_m3: float
    total_water_discharge_m3: float
    total_water_consumption_m3: float
    total_freshwater_consumption_m3: float
    water_consumption_per_tonne_litres: float
    quarry_water_not_used_m3: float
    recycled_water_m3: float
    storm_water_collected_discharged_m3: float
    harvested_rainwater_withdrawal_m3: float
    warnings: list[str] = Field(default_factory=list)
    validation_warnings: list[dict] = Field(default_factory=list)
    audit_trail: AuditTrail
    methodology: MethodologyTag
    steps_breakdown: list[CalculationStep]


# ---------------------------------------------------------------------------
# WaterEngine — pure calculation class
# ---------------------------------------------------------------------------
class WaterEngine:
    def __init__(self, water_input: WaterInput, audit_context: AuditContext) -> None:
        if not audit_context.upload_timestamp_utc:
            raise ValueError("upload_timestamp_utc is required for audit trail")
        self.water_input = water_input
        self.audit_context = audit_context

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------
    def _compute_withdrawal(self) -> float:
        w = self.water_input.withdrawal
        return (
            w.surface_water
            + w.groundwater
            + w.quarry_water_used
            + w.municipal_potable_water
            + w.external_wastewater
            + w.harvested_rainwater
        )

    def _compute_discharge(self) -> float:
        d = self.water_input.discharge
        return (
            d.ocean
            + d.surface_water
            + d.subsurface_well
            + d.offsite_water_treatment
            + d.beneficial_other_users
        )

    def _build_steps_breakdown(
        self,
        total_water_withdrawal_m3: float,
        total_water_discharge_m3: float,
        total_water_consumption_m3: float,
        total_freshwater_consumption_m3: float,
        water_consumption_per_tonne_litres: float,
    ) -> list[CalculationStep]:
        w = self.water_input.withdrawal
        d = self.water_input.discharge

        return [
            CalculationStep(
                step_id="total_withdrawal",
                label="Total Water Withdrawal",
                formula=(
                    "surface_water + groundwater + quarry_water_used"
                    " + municipal_potable_water + external_wastewater + harvested_rainwater"
                ),
                inputs={
                    "surface_water": {"value": w.surface_water, "unit": "m³/yr"},
                    "groundwater": {"value": w.groundwater, "unit": "m³/yr"},
                    "quarry_water_used": {"value": w.quarry_water_used, "unit": "m³/yr"},
                    "municipal_potable_water": {"value": w.municipal_potable_water, "unit": "m³/yr"},
                    "external_wastewater": {"value": w.external_wastewater, "unit": "m³/yr"},
                    "harvested_rainwater": {"value": w.harvested_rainwater, "unit": "m³/yr"},
                },
                output_value=total_water_withdrawal_m3,
                output_unit="m³/yr",
            ),
            CalculationStep(
                step_id="total_discharge",
                label="Total Water Discharge",
                formula=(
                    "ocean + surface_water + subsurface_well"
                    " + offsite_water_treatment + beneficial_other_users"
                ),
                inputs={
                    "ocean": {"value": d.ocean, "unit": "m³/yr"},
                    "surface_water": {"value": d.surface_water, "unit": "m³/yr"},
                    "subsurface_well": {"value": d.subsurface_well, "unit": "m³/yr"},
                    "offsite_water_treatment": {"value": d.offsite_water_treatment, "unit": "m³/yr"},
                    "beneficial_other_users": {"value": d.beneficial_other_users, "unit": "m³/yr"},
                },
                output_value=total_water_discharge_m3,
                output_unit="m³/yr",
            ),
            CalculationStep(
                step_id="kpi_1_consumption",
                label="KPI 1 — Total Water Consumption",
                formula="total_water_withdrawal_m3 - total_water_discharge_m3",
                inputs={
                    "total_water_withdrawal_m3": {"value": total_water_withdrawal_m3, "unit": "m³/yr"},
                    "total_water_discharge_m3": {"value": total_water_discharge_m3, "unit": "m³/yr"},
                },
                output_value=total_water_consumption_m3,
                output_unit="m³/yr",
            ),
            CalculationStep(
                step_id="freshwater_consumption",
                label="Total Freshwater Consumption",
                formula="total_water_consumption_m3 - harvested_rainwater_withdrawal_m3",
                inputs={
                    "total_water_consumption_m3": {"value": total_water_consumption_m3, "unit": "m³/yr"},
                    "harvested_rainwater_withdrawal_m3": {"value": w.harvested_rainwater, "unit": "m³/yr"},
                },
                output_value=total_freshwater_consumption_m3,
                output_unit="m³/yr",
            ),
            CalculationStep(
                step_id="kpi_2_intensity",
                label="KPI 2 — Water Consumption Intensity",
                formula="(total_water_consumption_m3 × 1000) / cementitious_production_t_yr",
                inputs={
                    "total_water_consumption_m3": {"value": total_water_consumption_m3, "unit": "m³/yr"},
                    "conversion_factor_l_per_m3": {"value": 1000.0, "unit": "L/m³"},
                    "cementitious_production_t_yr": {
                        "value": self.water_input.cementitious_production_t_yr,
                        "unit": "t/yr",
                    },
                },
                output_value=water_consumption_per_tonne_litres,
                output_unit="L/t cementitious",
            ),
        ]

    def _build_audit_trail(self) -> AuditTrail:
        input_hash = hashlib.sha256(
            self.water_input.model_dump_json().encode("utf-8")
        ).hexdigest()
        return AuditTrail(
            source_reference=SourceReference(
                source_filename=self.audit_context.source_filename,
                upload_timestamp_utc=self.audit_context.upload_timestamp_utc,
                input_hash=input_hash,
            ),
            user_id=self.audit_context.user_id,
        )

    # ------------------------------------------------------------------
    # Validation entry point (pre-calculation)
    # ------------------------------------------------------------------
    @classmethod
    def validate_input(
        cls,
        raw_data: dict,
        timestamp_utc: str = "unknown",
        registry: DuplicateRegistry | None = None,
    ) -> ValidationResult:
        """
        Run all pre-calculation validation checks against a raw input dict.
        Returns a ValidationResult — never raises.

        Checks (in order):
          1. Schema / Pydantic V2 — MISSING_COLUMN, INVALID_CATEGORY, NEGATIVE_VALUE_ERROR
          2. Negative value sweep on raw dict
          3. Production scale check — UNIT_MISMATCH_SUSPECTED (non-blocking)
          4. Water volume unit mismatch — UNIT_MISMATCH_SUSPECTED (non-blocking)
          5. Water source enum check — INVALID_CATEGORY (blocker)
          6. Duplicate detection — DUPLICATE_SUBMISSION (blocker)
        """
        # 1. Schema
        result = validate_schema(WaterInput, raw_data)

        # 2. Negative values
        neg_result = validate_no_negatives(raw_data)
        result.errors.extend(neg_result.errors)
        if neg_result.is_blocked:
            result.is_blocked = True
            result.is_valid = False

        # 3. Production scale (non-blocking warning)
        scale_result = validate_production_scale(raw_data)
        result.warnings.extend(scale_result.warnings)

        # 4. Water volume unit mismatch (non-blocking warning)
        withdrawal_raw = raw_data.get("withdrawal", {})
        all_volume_fields: dict[str, float] = {}
        if isinstance(withdrawal_raw, dict):
            all_volume_fields.update(
                {k: v for k, v in withdrawal_raw.items() if isinstance(v, (int, float))}
            )
        for ancillary in (
            "quarry_water_not_used_m3_yr",
            "recycled_water_m3_yr",
            "storm_water_collected_discharged_m3_yr",
        ):
            val = raw_data.get(ancillary)
            if isinstance(val, (int, float)):
                all_volume_fields[ancillary] = val

        unit_result = validate_water_units(all_volume_fields)
        result.warnings.extend(unit_result.warnings)

        # 5. Water source enum check (blocker)
        if isinstance(withdrawal_raw, dict):
            for source_key in withdrawal_raw:
                if source_key not in _VALID_WATER_SOURCES:
                    allowed = list(_VALID_WATER_SOURCES)
                    result.add_error(
                        ValidationCode.INVALID_CATEGORY,
                        "withdrawal.water_source",
                        (
                            f"INVALID_CATEGORY: '{source_key}' is not a valid water source. "
                            f"Expected one of: {allowed}"
                        ),
                        suggested_fix=f"Use one of the allowed water sources: {allowed}.",
                        meta={"submitted": source_key, "allowed": allowed},
                    )

        # 6. Duplicate detection (blocker)
        input_hash = compute_input_hash(raw_data)
        dup_result = validate_duplicate(input_hash, timestamp_utc, registry=registry)
        result.errors.extend(dup_result.errors)
        if dup_result.is_blocked:
            result.is_blocked = True
            result.is_valid = False

        return result

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def calculate(self) -> WaterResult:
        warnings: list[str] = []
        validation_warnings: list[dict] = []

        total_water_withdrawal_m3 = self._compute_withdrawal()
        total_water_discharge_m3 = self._compute_discharge()

        # Post-calc check: NEGATIVE_CONSUMPTION_ERROR (non-blocking, clamps to 0)
        logic_result = validate_water_logic(total_water_withdrawal_m3, total_water_discharge_m3)
        for w in logic_result.warnings:
            warnings.append(w.message)
            validation_warnings.append(w.model_dump())

        total_water_consumption_m3 = max(
            0.0, total_water_withdrawal_m3 - total_water_discharge_m3
        )

        total_freshwater_consumption_m3 = max(
            0.0,
            total_water_consumption_m3 - self.water_input.withdrawal.harvested_rainwater,
        )

        # KPI 2
        water_consumption_per_tonne_litres = (
            total_water_consumption_m3 * 1000.0
        ) / self.water_input.cementitious_production_t_yr

        steps = self._build_steps_breakdown(
            total_water_withdrawal_m3=total_water_withdrawal_m3,
            total_water_discharge_m3=total_water_discharge_m3,
            total_water_consumption_m3=total_water_consumption_m3,
            total_freshwater_consumption_m3=total_freshwater_consumption_m3,
            water_consumption_per_tonne_litres=water_consumption_per_tonne_litres,
        )

        return WaterResult(
            total_water_withdrawal_m3=total_water_withdrawal_m3,
            total_water_discharge_m3=total_water_discharge_m3,
            total_water_consumption_m3=total_water_consumption_m3,
            total_freshwater_consumption_m3=total_freshwater_consumption_m3,
            water_consumption_per_tonne_litres=water_consumption_per_tonne_litres,
            quarry_water_not_used_m3=self.water_input.quarry_water_not_used_m3_yr,
            recycled_water_m3=self.water_input.recycled_water_m3_yr,
            storm_water_collected_discharged_m3=self.water_input.storm_water_collected_discharged_m3_yr,
            harvested_rainwater_withdrawal_m3=self.water_input.withdrawal.harvested_rainwater,
            warnings=warnings,
            validation_warnings=validation_warnings,
            audit_trail=self._build_audit_trail(),
            methodology=MethodologyTag(),
            steps_breakdown=steps,
        )
