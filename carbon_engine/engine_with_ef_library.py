"""
Tefnut — CarbonEngine + EF Library Integration Patch

Wraps the existing CarbonEngine with three-tier emission factor priority:
  1. Plant-supplied factor (CalcinationInputB1.calcination_ef_kg_per_t_clinker)
  2. GCCA hardcoded default (525 kg CO2/t clinker)
  3. IPCC Excel library fallback (2A_Cement_Lime_Production.xlsx)

Usage (drop-in replacement for CarbonEngine):

    from carbon_engine.engine_with_ef_library import CarbonEngineWithEFLibrary

    engine = CarbonEngineWithEFLibrary(
        plant_input,
        xlsx_path="data/2A_Cement_Lime_Production.xlsx",  # optional
        prefer_library=False,   # True → use library over GCCA when available
        region=None,            # optional region filter for library lookup
        technology=None,        # optional technology filter (e.g. "NSP")
    )
    result = engine.calculate()

    # Access the factor selection audit trail:
    print(engine.factor_audit)
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from carbon_engine.carbon_engine import (
    CalcinationMethod,
    CarbonEngine,
    CalculationResult,
    PlantInput,
)
from carbon_engine.factor_provider import FactorProvider, FactorResult

# GCCA default in kg/t (used by CalcinationInputB1)
_GCCA_DEFAULT_KG_PER_T_CLINKER: float = 525.0


@dataclass
class FactorAudit:
    """Full transparency record of which EF was used and why."""
    selected: FactorResult
    gcca: FactorResult
    library: Optional[FactorResult]
    plant_supplied_kg_per_t: Optional[float]

    def to_dict(self) -> dict:
        return {
            "selected": {
                "value_t_co2_per_t_clinker": self.selected.value,
                "value_kg_co2_per_t_clinker": round(self.selected.value * 1000, 4),
                "source": self.selected.source,
                "sheet": self.selected.sheet,
                "year_used": self.selected.year_used,
                "region": self.selected.region,
                "technology": self.selected.technology,
                "why_selected": self.selected.why_selected,
                "reference": self.selected.reference,
            },
            "gcca_default": {
                "value_t_co2_per_t_clinker": self.gcca.value,
                "value_kg_co2_per_t_clinker": round(self.gcca.value * 1000, 4),
                "source": self.gcca.source,
                "why_selected": self.gcca.why_selected,
            },
            "library": {
                "value_t_co2_per_t_clinker": self.library.value if self.library else None,
                "value_kg_co2_per_t_clinker": (
                    round(self.library.value * 1000, 4) if self.library else None
                ),
                "source": self.library.source if self.library else None,
                "sheet": self.library.sheet if self.library else None,
                "year_used": self.library.year_used if self.library else None,
                "region": self.library.region if self.library else None,
                "technology": self.library.technology if self.library else None,
                "why_selected": self.library.why_selected if self.library else "No library record found",
                "value_min": self.library.value_min if self.library else None,
                "value_max": self.library.value_max if self.library else None,
            },
            "plant_supplied_kg_per_t": self.plant_supplied_kg_per_t,
        }


class CarbonEngineWithEFLibrary(CarbonEngine):
    """
    Drop-in replacement for CarbonEngine that adds EF library priority logic.

    The existing CarbonEngine is NOT modified — this class only overrides
    the calcination EF resolution before delegating to the parent.
    """

    def __init__(
        self,
        plant: PlantInput,
        xlsx_path: Optional[str | Path] = None,
        prefer_library: bool = False,
        region: Optional[str] = None,
        technology: Optional[str] = None,
        verbose: bool = False,
    ) -> None:
        super().__init__(plant)
        self._provider = FactorProvider(xlsx_path=xlsx_path, verbose=verbose)
        self._prefer_library = prefer_library
        self._region = region
        self._technology = technology
        self.factor_audit: Optional[FactorAudit] = None

    def calculate(self) -> CalculationResult:
        """
        Calculate with EF priority logic applied to the calcination factor.

        If the plant used the GCCA default (525 kg/t), we check whether
        the library has a better match and optionally substitute it.
        """
        self._apply_ef_priority()
        return super().calculate()

    def _apply_ef_priority(self) -> None:
        """
        Resolve the calcination EF using the three-tier priority system
        and patch the PlantInput in-place if needed.
        """
        if self.plant.calcination_method != CalcinationMethod.B1_SIMPLE_OUTPUT:
            # A1 method uses LOI — no EF to substitute
            self.factor_audit = None
            return

        b1 = self.plant.calcination_b1
        if b1 is None:
            return

        # Determine if the plant supplied a custom EF or used the GCCA default
        is_gcca_default = abs(b1.calcination_ef_kg_per_t_clinker - _GCCA_DEFAULT_KG_PER_T_CLINKER) < 0.001
        plant_supplied_kg = None if is_gcca_default else b1.calcination_ef_kg_per_t_clinker
        plant_supplied_t = (plant_supplied_kg / 1000.0) if plant_supplied_kg else None

        selected, gcca, library = self._provider.get_factor_with_priority(
            category="cement_production",
            subcategory="calcination_ef_t_co2_per_t_clinker",
            year=self.plant.reporting_year,
            region=self._region,
            technology=self._technology,
            plant_supplied_value=plant_supplied_t,
            prefer_library=self._prefer_library,
        )

        self.factor_audit = FactorAudit(
            selected=selected,
            gcca=gcca,
            library=library,
            plant_supplied_kg_per_t=plant_supplied_kg,
        )

        # Patch the PlantInput with the selected EF (convert t → kg)
        selected_kg = round(selected.value * 1000.0, 4)
        if abs(selected_kg - b1.calcination_ef_kg_per_t_clinker) > 0.001:
            # Use model_copy to avoid mutating the original
            self.plant = self.plant.model_copy(
                update={
                    "calcination_b1": b1.model_copy(
                        update={"calcination_ef_kg_per_t_clinker": selected_kg}
                    )
                }
            )
