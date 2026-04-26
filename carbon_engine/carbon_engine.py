"""
Tefnut Carbon Footprint Calculation Engine
GCCA Cement CO2 and Energy Protocol compliant
Covers Scope 1 (Calcination + Fuel Combustion), Scope 2 (Electricity), Scope 3 (Transport)

References:
  - GCCA Internet Manual for CO2 and Energy Protocol (v3.1)
  - Equation 1  (p.51): CO2 from raw materials - Method A1 (LOI-based)
  - Equation 9  (p.66): Calcination rate d of CKD
  - Equation 12 (p.90): Fuel energy use
  - Equation 13 (p.91): CO2 emissions from fuels
  - Table 4     (p.108): Default CO2 emission factors
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from carbon_engine.validation import ValidationResult
from carbon_engine.validators import (
    validate_duplicate,
    validate_no_negatives,
    validate_schema,
    validate_specific_co2_range,
    compute_input_hash,
)


# ---------------------------------------------------------------------------
# GCCA Default Emission Factors (Table 4, p.108) — kg CO2 / GJ (LHV basis)
# ---------------------------------------------------------------------------
GCCA_FUEL_EF: dict[str, float] = {
    "coal_anthracite": 96.0,
    "petrol_coke": 92.8,
    "heavy_fuel_oil": 77.4,
    "diesel_oil": 74.1,
    "natural_gas": 56.1,
    "oil_shale": 107.0,
    "lignite": 101.0,
    "gasoline": 69.3,
    "waste_oil": 74.0,
    "tyres": 85.0,
    "rdf_plastics": 75.0,
    "solvents": 74.0,
    "impregnated_saw_dust": 75.0,
    "mixed_industrial_waste": 83.0,
    "other_fossil_waste": 80.0,
    "dried_sewage_sludge": 110.0,
    "wood_saw_dust": 110.0,
    "paper_carton": 110.0,
    "animal_meal": 89.0,
    "animal_bone_meal": 89.0,
    "animal_fat": 89.0,
    "other_biomass": 110.0,
}

GCCA_DEFAULT_CALCINATION_EF_KG_PER_T_CLINKER: float = 525.0

BIOMASS_FUEL_TYPES: set[str] = {
    "dried_sewage_sludge", "wood_saw_dust", "paper_carton",
    "animal_meal", "animal_bone_meal", "animal_fat", "other_biomass",
}


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class CalcinationMethod(str, Enum):
    B1_SIMPLE_OUTPUT = "B1"
    A1_SIMPLE_INPUT = "A1"
    B2_DETAILED_OUTPUT = "B2"


class FuelType(str, Enum):
    COAL_ANTHRACITE = "coal_anthracite"
    PETROL_COKE = "petrol_coke"
    HEAVY_FUEL_OIL = "heavy_fuel_oil"
    DIESEL_OIL = "diesel_oil"
    NATURAL_GAS = "natural_gas"
    OIL_SHALE = "oil_shale"
    LIGNITE = "lignite"
    GASOLINE = "gasoline"
    WASTE_OIL = "waste_oil"
    TYRES = "tyres"
    RDF_PLASTICS = "rdf_plastics"
    SOLVENTS = "solvents"
    IMPREGNATED_SAW_DUST = "impregnated_saw_dust"
    MIXED_INDUSTRIAL_WASTE = "mixed_industrial_waste"
    OTHER_FOSSIL_WASTE = "other_fossil_waste"
    DRIED_SEWAGE_SLUDGE = "dried_sewage_sludge"
    WOOD_SAW_DUST = "wood_saw_dust"
    PAPER_CARTON = "paper_carton"
    ANIMAL_MEAL = "animal_meal"
    ANIMAL_BONE_MEAL = "animal_bone_meal"
    ANIMAL_FAT = "animal_fat"
    OTHER_BIOMASS = "other_biomass"


# ---------------------------------------------------------------------------
# Input Schemas
# ---------------------------------------------------------------------------
class FuelEntry(BaseModel):
    fuel_type: FuelType
    consumption_t_per_yr: float = Field(..., ge=0)
    lhv_gj_per_t: float = Field(..., gt=0)
    ef_kg_co2_per_gj: Optional[float] = Field(None, ge=0)
    biogenic_fraction: float = Field(0.0, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def apply_default_ef(self) -> "FuelEntry":
        if self.ef_kg_co2_per_gj is None:
            self.ef_kg_co2_per_gj = GCCA_FUEL_EF.get(self.fuel_type.value, 80.0)
        return self


class CalcinationInputB1(BaseModel):
    clinker_production_t_yr: float = Field(..., gt=0)
    bypass_dust_t_yr: float = Field(0.0, ge=0)
    ckd_leaving_kiln_t_yr: float = Field(0.0, ge=0)
    ckd_calcination_rate_d: float = Field(0.0, ge=0.0, le=1.0)
    calcination_ef_kg_per_t_clinker: float = Field(
        GCCA_DEFAULT_CALCINATION_EF_KG_PER_T_CLINKER, gt=0
    )


class CalcinationInputA1(BaseModel):
    kiln_feed_t_yr: float = Field(..., gt=0)
    dust_return_correction_pct: float = Field(..., ge=0.0, le=100.0)
    loi_raw_meal_pct: float = Field(..., gt=0.0, le=100.0)
    ckd_leaving_kiln_t_yr: float = Field(0.0, ge=0)
    loi_ckd_pct: float = Field(0.0, ge=0.0, le=100.0)


class ElectricityInput(BaseModel):
    purchased_electricity_mwh_yr: float = Field(..., ge=0)
    grid_ef_kg_co2_per_mwh: float = Field(..., gt=0)


class TransportEntry(BaseModel):
    description: str
    freight_tonne_km: float = Field(..., ge=0)
    ef_kg_co2_per_tonne_km: float = Field(0.062, ge=0)


class WaterInput(BaseModel):
    withdrawal_m3_yr: float = Field(0.0, ge=0)
    discharge_m3_yr: float = Field(0.0, ge=0)
    recycled_m3_yr: float = Field(0.0, ge=0)


class PlantInput(BaseModel):
    plant_name: str
    reporting_year: int = Field(..., ge=2000, le=2100)
    calcination_method: CalcinationMethod = Field(CalcinationMethod.B1_SIMPLE_OUTPUT)
    calcination_b1: Optional[CalcinationInputB1] = None
    calcination_a1: Optional[CalcinationInputA1] = None
    kiln_fuels: list[FuelEntry] = Field(default_factory=list)
    non_kiln_fuels: list[FuelEntry] = Field(default_factory=list)
    cement_production_t_yr: float = Field(..., gt=0)
    clinker_production_t_yr: Optional[float] = Field(None, ge=0)
    electricity: Optional[ElectricityInput] = None
    transport_entries: list[TransportEntry] = Field(default_factory=list)
    water: Optional[WaterInput] = None
    cbam_goods_count: int = Field(0, ge=0)
    cbam_data_completeness_pct: float = Field(0.0, ge=0.0, le=100.0)

    @model_validator(mode="after")
    def validate_calcination_inputs(self) -> "PlantInput":
        if self.calcination_method == CalcinationMethod.B1_SIMPLE_OUTPUT:
            if self.calcination_b1 is None:
                raise ValueError("calcination_b1 required for method B1")
        elif self.calcination_method == CalcinationMethod.A1_SIMPLE_INPUT:
            if self.calcination_a1 is None:
                raise ValueError("calcination_a1 required for method A1")
        return self


# ---------------------------------------------------------------------------
# Output Schemas
# ---------------------------------------------------------------------------
class ScopeBreakdown(BaseModel):
    calcination_co2_t: float = 0.0
    fuel_combustion_co2_t: float = 0.0
    biomass_co2_memo_t: float = 0.0
    total_scope1_co2_t: float = 0.0


class Scope2Result(BaseModel):
    electricity_co2_t: float = 0.0


class Scope3Result(BaseModel):
    transport_co2_t: float = 0.0


class EnergyResult(BaseModel):
    total_kiln_energy_tj: float = 0.0
    total_non_kiln_energy_tj: float = 0.0
    energy_intensity_gj_per_t_clinker: float = 0.0


class WaterResult(BaseModel):
    withdrawal_m3: float = 0.0
    consumption_m3: float = 0.0
    recycled_m3: float = 0.0


class CBAMResult(BaseModel):
    specific_embedded_co2_t_per_t_cement: float = 0.0
    completeness_pct: float = 0.0
    goods_count: int = 0


class CalculationResult(BaseModel):
    plant_name: str
    reporting_year: int
    scope1: ScopeBreakdown
    scope2: Scope2Result
    scope3: Scope3Result
    total_co2e_t: float
    specific_co2_kg_per_t_cement: float
    energy: EnergyResult
    water: WaterResult
    cbam: CBAMResult
    source_mix: list[dict] = Field(default_factory=list)
    validation_warnings: list[dict] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Calculation Engine
# ---------------------------------------------------------------------------
class CarbonEngine:
    """
    GCCA-compliant carbon footprint calculator for a single cement plant.

    Usage:
        engine = CarbonEngine(plant_input)
        result = engine.calculate()
    """

    def __init__(self, plant: PlantInput) -> None:
        self.plant = plant

    # ------------------------------------------------------------------
    # Scope 1a — Calcination CO2
    # ------------------------------------------------------------------
    def _calc_calcination_b1(self, b1: CalcinationInputB1) -> float:
        """
        Simple Output Method B1 (GCCA p.65-66).
        CO2 = clinker × EF + bypass_dust × EF + CKD × EF × d
        Returns tCO2/yr.
        """
        ef = b1.calcination_ef_kg_per_t_clinker / 1000.0  # kg/t → t/t
        co2_clinker = b1.clinker_production_t_yr * ef
        co2_bypass = b1.bypass_dust_t_yr * ef
        co2_ckd = b1.ckd_leaving_kiln_t_yr * ef * b1.ckd_calcination_rate_d
        return co2_clinker + co2_bypass + co2_ckd

    def _calc_calcination_a1(self, a1: CalcinationInputA1) -> float:
        """
        Simple Input Method A1 — LOI of raw meal (GCCA Equation 1, p.51).

        CO2 = KF × (1 - DR) × LOI_RM + CKD × EF_CKD
        EF_CKD = (LOI_RM × d) / (1 - LOI_RM × d)   [Equation 2]
        d = 1 - (LOI_CKD × (1 - LOI_RM)) / ((1 - LOI_CKD) × LOI_RM)  [Eq.3]

        Returns tCO2/yr.
        """
        loi_rm = a1.loi_raw_meal_pct / 100.0
        dr = a1.dust_return_correction_pct / 100.0

        co2_raw_meal = a1.kiln_feed_t_yr * (1.0 - dr) * loi_rm

        co2_ckd = 0.0
        if a1.ckd_leaving_kiln_t_yr > 0 and a1.loi_ckd_pct > 0:
            loi_ckd = a1.loi_ckd_pct / 100.0
            denom = (1.0 - loi_ckd) * loi_rm
            d = (1.0 - (loi_ckd * (1.0 - loi_rm)) / denom) if denom > 0 else 0.0
            d = max(0.0, min(1.0, d))
            ef_ckd_denom = 1.0 - loi_rm * d
            ef_ckd = (loi_rm * d) / ef_ckd_denom if ef_ckd_denom > 0 else 0.0
            co2_ckd = a1.ckd_leaving_kiln_t_yr * ef_ckd

        return co2_raw_meal + co2_ckd

    def _calc_calcination(self) -> float:
        if self.plant.calcination_method == CalcinationMethod.B1_SIMPLE_OUTPUT:
            return self._calc_calcination_b1(self.plant.calcination_b1)  # type: ignore[arg-type]
        if self.plant.calcination_method == CalcinationMethod.A1_SIMPLE_INPUT:
            return self._calc_calcination_a1(self.plant.calcination_a1)  # type: ignore[arg-type]
        raise NotImplementedError(f"Method {self.plant.calcination_method} not yet implemented")

    # ------------------------------------------------------------------
    # Scope 1b — Fuel Combustion CO2
    # ------------------------------------------------------------------
    def _calc_fuel_co2(
        self, fuels: list[FuelEntry]
    ) -> tuple[float, float, float]:
        """
        GCCA Equations 12 & 13 (p.90-91).
        Returns (fossil_co2_t, biomass_co2_memo_t, total_energy_tj).
        """
        fossil_co2 = 0.0
        biomass_co2 = 0.0
        total_energy_tj = 0.0

        for fuel in fuels:
            energy_tj = fuel.consumption_t_per_yr * fuel.lhv_gj_per_t / 1000.0
            total_energy_tj += energy_tj

            ef = fuel.ef_kg_co2_per_gj or 0.0
            # CO2 [t] = consumption [t] × LHV [GJ/t] × EF [kg CO2/GJ] / 1,000,000
            total_co2_t = fuel.consumption_t_per_yr * fuel.lhv_gj_per_t * ef / 1_000_000.0

            is_pure_biomass = fuel.fuel_type.value in BIOMASS_FUEL_TYPES
            bio_frac = 1.0 if is_pure_biomass else fuel.biogenic_fraction

            biomass_co2 += total_co2_t * bio_frac
            fossil_co2 += total_co2_t * (1.0 - bio_frac)

        return fossil_co2, biomass_co2, total_energy_tj

    # ------------------------------------------------------------------
    # Scope 2 — Electricity
    # ------------------------------------------------------------------
    def _calc_scope2(self) -> float:
        if not self.plant.electricity:
            return 0.0
        e = self.plant.electricity
        return e.purchased_electricity_mwh_yr * e.grid_ef_kg_co2_per_mwh / 1000.0

    # ------------------------------------------------------------------
    # Scope 3 — Transport
    # ------------------------------------------------------------------
    def _calc_scope3(self) -> float:
        return sum(
            leg.freight_tonne_km * leg.ef_kg_co2_per_tonne_km / 1000.0
            for leg in self.plant.transport_entries
        )

    # ------------------------------------------------------------------
    # Energy Intensity KPI (GJ/t clinker)
    # ------------------------------------------------------------------
    def _energy_intensity(self, kiln_energy_tj: float) -> float:
        clinker_t = self.plant.clinker_production_t_yr
        if not clinker_t and self.plant.calcination_b1:
            clinker_t = self.plant.calcination_b1.clinker_production_t_yr
        if not clinker_t or clinker_t <= 0:
            return 0.0
        return (kiln_energy_tj * 1000.0) / clinker_t  # TJ → GJ, then /t

    # ------------------------------------------------------------------
    # Source Mix for PieChart
    # ------------------------------------------------------------------
    def _build_source_mix(
        self,
        calcination_co2: float,
        kiln_fossil_co2: float,
        non_kiln_fossil_co2: float,
        scope2_co2: float,
        scope3_co2: float,
    ) -> list[dict]:
        total = calcination_co2 + kiln_fossil_co2 + non_kiln_fossil_co2 + scope2_co2 + scope3_co2
        if total <= 0:
            return []

        def pct(v: float) -> float:
            return round(v / total * 100, 1)

        return [
            {"name": "Process emissions", "value": pct(calcination_co2)},
            {"name": "Fuel combustion (kiln)", "value": pct(kiln_fossil_co2)},
            {"name": "Fuel combustion (non-kiln)", "value": pct(non_kiln_fossil_co2)},
            {"name": "Electricity", "value": pct(scope2_co2)},
            {"name": "Logistics", "value": pct(scope3_co2)},
        ]

    # ------------------------------------------------------------------
    # Validation entry point
    # ------------------------------------------------------------------
    @classmethod
    def validate_input(
        cls,
        raw_data: dict,
        timestamp_utc: str = "unknown",
    ) -> ValidationResult:
        """
        Run all pre-calculation validation checks against a raw input dict.
        Returns a ValidationResult — never raises.

        Checks performed (in order):
          1. Schema / Pydantic V2 — missing columns, type errors, enum violations
          2. Negative value sweep on the raw dict
          3. Duplicate detection via SHA-256 hash
        """
        # 1. Schema
        result = validate_schema(PlantInput, raw_data)

        # 2. Negative values (raw dict sweep catches anything Pydantic misses)
        neg_result = validate_no_negatives(raw_data)
        result.errors.extend(neg_result.errors)
        result.warnings.extend(neg_result.warnings)
        if not neg_result.is_valid:
            result.is_valid = False

        # 3. Duplicate detection
        input_hash = compute_input_hash(raw_data)
        dup_result = validate_duplicate(input_hash, timestamp_utc)
        result.warnings.extend(dup_result.warnings)

        return result

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------
    def calculate(self) -> CalculationResult:
        # --- Scope 1 ---
        calcination_co2 = self._calc_calcination()

        kiln_fossil, kiln_biomass, kiln_energy_tj = self._calc_fuel_co2(self.plant.kiln_fuels)
        non_kiln_fossil, non_kiln_biomass, non_kiln_energy_tj = self._calc_fuel_co2(
            self.plant.non_kiln_fuels
        )

        total_fuel_fossil = kiln_fossil + non_kiln_fossil
        total_biomass_memo = kiln_biomass + non_kiln_biomass
        total_scope1 = calcination_co2 + total_fuel_fossil

        # --- Scope 2 ---
        scope2_co2 = self._calc_scope2()

        # --- Scope 3 ---
        scope3_co2 = self._calc_scope3()

        # --- Totals ---
        total_co2e = total_scope1 + scope2_co2 + scope3_co2

        # --- Specific CO2 (GCCA KPI: kg CO2 / t cementitious product) ---
        specific_co2_kg = (
            (total_co2e / self.plant.cement_production_t_yr) * 1000.0
            if self.plant.cement_production_t_yr > 0
            else 0.0
        )

        # --- Post-calc range validation ---
        range_result = validate_specific_co2_range(specific_co2_kg)
        post_calc_warnings = [w.model_dump() for w in range_result.warnings]

        # --- Energy ---
        energy_intensity = self._energy_intensity(kiln_energy_tj)

        # --- Water ---
        w = self.plant.water
        water_result = WaterResult(
            withdrawal_m3=w.withdrawal_m3_yr if w else 0.0,
            consumption_m3=(
                max(0.0, w.withdrawal_m3_yr - w.discharge_m3_yr) if w else 0.0
            ),
            recycled_m3=w.recycled_m3_yr if w else 0.0,
        )

        # --- CBAM ---
        # Specific embedded emissions = (Scope1 + Scope2) / cement_production
        embedded_co2 = (
            (total_scope1 + scope2_co2) / self.plant.cement_production_t_yr
            if self.plant.cement_production_t_yr > 0
            else 0.0
        )

        return CalculationResult(
            plant_name=self.plant.plant_name,
            reporting_year=self.plant.reporting_year,
            scope1=ScopeBreakdown(
                calcination_co2_t=round(calcination_co2, 4),
                fuel_combustion_co2_t=round(total_fuel_fossil, 4),
                biomass_co2_memo_t=round(total_biomass_memo, 4),
                total_scope1_co2_t=round(total_scope1, 4),
            ),
            scope2=Scope2Result(electricity_co2_t=round(scope2_co2, 4)),
            scope3=Scope3Result(transport_co2_t=round(scope3_co2, 4)),
            total_co2e_t=round(total_co2e, 4),
            specific_co2_kg_per_t_cement=round(specific_co2_kg, 4),
            energy=EnergyResult(
                total_kiln_energy_tj=round(kiln_energy_tj, 4),
                total_non_kiln_energy_tj=round(non_kiln_energy_tj, 4),
                energy_intensity_gj_per_t_clinker=round(energy_intensity, 4),
            ),
            water=water_result,
            cbam=CBAMResult(
                specific_embedded_co2_t_per_t_cement=round(embedded_co2, 4),
                completeness_pct=self.plant.cbam_data_completeness_pct,
                goods_count=self.plant.cbam_goods_count,
            ),
            source_mix=self._build_source_mix(
                calcination_co2, kiln_fossil, non_kiln_fossil, scope2_co2, scope3_co2
            ),
            validation_warnings=post_calc_warnings,
        )
