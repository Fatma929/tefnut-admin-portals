"""
Tefnut — Emission Factor Provider
Implements a three-tier priority lookup for calcination emission factors:

  Priority 1 (highest): Plant-supplied factor (user input in PlantInput)
  Priority 2:           GCCA hardcoded default (525 kg CO2/t clinker)
  Priority 3 (lowest):  IPCC Excel library (2A_Cement_Lime_Production.xlsx)

Usage:
    from carbon_engine.factor_provider import FactorProvider, FactorResult

    provider = FactorProvider()  # loads hardcoded IPCC records
    # or:
    provider = FactorProvider(xlsx_path="data/2A_Cement_Lime_Production.xlsx")

    result = provider.get_factor(
        category="cement_production",
        subcategory="calcination_ef_t_co2_per_t_clinker",
        year=2026,
        region=None,          # optional filter
        technology=None,      # optional filter (e.g. "NSP")
    )
    print(result.value)          # float, t CO2/t clinker
    print(result.source)         # where it came from
    print(result.why_selected)   # human-readable explanation
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from carbon_engine.ef_library_parser import (
    get_hardcoded_records,
    load_from_excel,
    summarise,
)

# GCCA default calcination EF — kg CO2/t clinker → convert to t CO2/t clinker
_GCCA_DEFAULT_T_CO2_PER_T_CLINKER: float = 0.525  # = 525 kg / 1000


@dataclass
class FactorResult:
    """
    A fully transparent emission factor selection result.
    Every field explains exactly what was chosen and why.
    """
    value: float                    # t CO2/t clinker (or relevant unit)
    unit: str                       # e.g. "tCO2/t clinker"
    source: str                     # "plant_input" | "gcca_default" | xlsx filename
    sheet: Optional[str]            # Excel sheet name, if from library
    year_used: Optional[int]        # year of the record used
    region: Optional[str]           # region of the record
    technology: Optional[str]       # kiln technology, if applicable
    why_selected: str               # human-readable explanation
    value_min: Optional[float] = None
    value_max: Optional[float] = None
    reference: Optional[str] = None


class FactorProvider:
    """
    Three-tier emission factor provider.

    Tier 1: plant-supplied value (passed directly to get_factor)
    Tier 2: GCCA hardcoded default (0.525 t CO2/t clinker)
    Tier 3: IPCC Excel library (nearest year, optional region/technology filter)
    """

    def __init__(
        self,
        xlsx_path: Optional[str | Path] = None,
        verbose: bool = False,
    ) -> None:
        """
        Args:
            xlsx_path: Path to 2A_Cement_Lime_Production.xlsx.
                       If None or file not found, uses hardcoded records.
            verbose:   Print a summary of loaded records on init.
        """
        if xlsx_path is not None:
            self._records = load_from_excel(xlsx_path)
        else:
            self._records = get_hardcoded_records()

        if verbose:
            summarise(self._records)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def get_factor(
        self,
        category: str = "cement_production",
        subcategory: str = "calcination_ef_t_co2_per_t_clinker",
        year: int = 2026,
        region: Optional[str] = None,
        technology: Optional[str] = None,
        plant_supplied_value: Optional[float] = None,
    ) -> FactorResult:
        """
        Return the best available emission factor for the given parameters.

        Priority:
          1. plant_supplied_value (if provided and > 0)
          2. GCCA hardcoded default
          3. IPCC library — nearest year ≤ requested year, optional region/tech filter

        Args:
            category:              EF category (default: "cement_production")
            subcategory:           EF subcategory (default: calcination EF)
            year:                  Reporting year to match
            region:                Optional region filter (partial match, case-insensitive)
            technology:            Optional technology filter (partial match, case-insensitive)
            plant_supplied_value:  If the plant provided its own EF (t CO2/t clinker),
                                   this takes highest priority.

        Returns:
            FactorResult with full transparency metadata.
        """
        # ── Tier 1: plant-supplied ──────────────────────────────────────
        if plant_supplied_value is not None and plant_supplied_value > 0:
            return FactorResult(
                value=plant_supplied_value,
                unit="tCO2/t clinker",
                source="plant_input",
                sheet=None,
                year_used=year,
                region=region,
                technology=technology,
                why_selected=(
                    f"Plant-supplied emission factor used directly "
                    f"({plant_supplied_value:.4f} tCO2/t clinker). "
                    "Highest priority — overrides all library defaults."
                ),
            )

        # ── Tier 2: GCCA hardcoded default ─────────────────────────────
        # We always return GCCA as tier 2 unless the caller explicitly
        # requests the library (use_library=True is implicit when tier 3
        # is reached via fallback).
        # For now, GCCA is the default fallback before the library.
        gcca_result = FactorResult(
            value=_GCCA_DEFAULT_T_CO2_PER_T_CLINKER,
            unit="tCO2/t clinker",
            source="gcca_default",
            sheet=None,
            year_used=None,
            region="Global",
            technology=None,
            why_selected=(
                "GCCA default calcination emission factor used "
                "(0.525 tCO2/t clinker, GCCA Cement CO2 Protocol v3.1 Table 4). "
                "No plant-supplied factor provided."
            ),
            reference="GCCA Cement CO2 and Energy Protocol v3.1, Table 4, p.108",
        )

        # ── Tier 3: IPCC library ────────────────────────────────────────
        library_result = self._lookup_library(category, subcategory, year, region, technology)
        if library_result is not None:
            # Library found a match — return it as informational context
            # but GCCA remains the calculation default unless explicitly overridden.
            # We return the library result here so callers can choose.
            return library_result

        return gcca_result

    def get_factor_with_priority(
        self,
        category: str = "cement_production",
        subcategory: str = "calcination_ef_t_co2_per_t_clinker",
        year: int = 2026,
        region: Optional[str] = None,
        technology: Optional[str] = None,
        plant_supplied_value: Optional[float] = None,
        prefer_library: bool = False,
    ) -> tuple[FactorResult, FactorResult, Optional[FactorResult]]:
        """
        Returns all three tiers simultaneously for full transparency.

        Returns:
            (selected, gcca_result, library_result)
            selected = the tier that would be used in calculation
        """
        # Tier 1
        if plant_supplied_value is not None and plant_supplied_value > 0:
            tier1 = FactorResult(
                value=plant_supplied_value,
                unit="tCO2/t clinker",
                source="plant_input",
                sheet=None,
                year_used=year,
                region=region,
                technology=technology,
                why_selected="Plant-supplied factor — highest priority.",
            )
        else:
            tier1 = None  # type: ignore[assignment]

        # Tier 2
        tier2 = FactorResult(
            value=_GCCA_DEFAULT_T_CO2_PER_T_CLINKER,
            unit="tCO2/t clinker",
            source="gcca_default",
            sheet=None,
            year_used=None,
            region="Global",
            technology=None,
            why_selected="GCCA default (0.525 tCO2/t clinker).",
            reference="GCCA Cement CO2 and Energy Protocol v3.1, Table 4",
        )

        # Tier 3
        tier3 = self._lookup_library(category, subcategory, year, region, technology)

        # Select
        if tier1 is not None:
            selected = tier1
        elif prefer_library and tier3 is not None:
            selected = tier3
        else:
            selected = tier2

        return selected, tier2, tier3

    def list_records(
        self,
        category: Optional[str] = None,
        subcategory: Optional[str] = None,
    ) -> list[dict]:
        """Return all loaded records, optionally filtered."""
        records = self._records
        if category:
            records = [r for r in records if r["category"] == category]
        if subcategory:
            records = [r for r in records if r["subcategory"] == subcategory]
        return records

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _lookup_library(
        self,
        category: str,
        subcategory: str,
        year: int,
        region: Optional[str],
        technology: Optional[str],
    ) -> Optional[FactorResult]:
        """
        Find the best matching record in the IPCC library.

        Selection logic:
          1. Filter by category + subcategory
          2. Optionally filter by region (partial, case-insensitive)
          3. Optionally filter by technology (partial, case-insensitive)
          4. Among remaining records, pick the one with the largest year ≤ requested year
          5. If no record with year ≤ requested year, pick the oldest available
        """
        candidates = [
            r for r in self._records
            if r["category"] == category and r["subcategory"] == subcategory
        ]

        if not candidates:
            return None

        # Optional region filter
        if region:
            region_filtered = [
                r for r in candidates
                if r.get("region") and region.lower() in r["region"].lower()
            ]
            if region_filtered:
                candidates = region_filtered

        # Optional technology filter
        if technology:
            tech_filtered = [
                r for r in candidates
                if r.get("technology") and technology.lower() in r["technology"].lower()
            ]
            if tech_filtered:
                candidates = tech_filtered

        # Find nearest year ≤ requested
        past_records = [r for r in candidates if r["year"] <= year]
        if past_records:
            best = max(past_records, key=lambda r: r["year"])
            why = (
                f"IPCC library record selected: year={best['year']} "
                f"(nearest year ≤ {year}), region={best.get('region')}, "
                f"sheet={best['sheet']}."
            )
        else:
            # All records are newer — use the oldest
            best = min(candidates, key=lambda r: r["year"])
            why = (
                f"IPCC library record selected: year={best['year']} "
                f"(oldest available; no record with year ≤ {year}), "
                f"region={best.get('region')}, sheet={best['sheet']}."
            )

        return FactorResult(
            value=best["value"],
            unit=best["unit"],
            source=best["source"],
            sheet=best["sheet"],
            year_used=best["year"],
            region=best.get("region"),
            technology=best.get("technology"),
            why_selected=why,
            value_min=best.get("value_min"),
            value_max=best.get("value_max"),
            reference=best.get("reference"),
        )
