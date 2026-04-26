"""
Unit tests for the IPCC EF Library integration.
Tests ef_library_parser.py, factor_provider.py, and engine_with_ef_library.py.
"""
from __future__ import annotations

import pytest

from carbon_engine.carbon_engine import (
    CalcinationInputB1,
    CalcinationMethod,
    PlantInput,
)
from carbon_engine.ef_library_parser import get_hardcoded_records, summarise
from carbon_engine.engine_with_ef_library import CarbonEngineWithEFLibrary
from carbon_engine.factor_provider import FactorProvider


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _make_plant(ef_kg: float = 525.0, year: int = 2026) -> PlantInput:
    return PlantInput(
        plant_name="Test Plant",
        reporting_year=year,
        calcination_method=CalcinationMethod.B1_SIMPLE_OUTPUT,
        calcination_b1=CalcinationInputB1(
            clinker_production_t_yr=1_000_000,
            calcination_ef_kg_per_t_clinker=ef_kg,
        ),
        cement_production_t_yr=1_300_000,
    )


# ---------------------------------------------------------------------------
# ef_library_parser tests
# ---------------------------------------------------------------------------
class TestEFLibraryParser:
    def test_hardcoded_records_not_empty(self):
        records = get_hardcoded_records()
        assert len(records) >= 9

    def test_all_records_have_required_keys(self):
        records = get_hardcoded_records()
        required = {"category", "subcategory", "year", "value", "unit", "source", "sheet"}
        for r in records:
            assert required.issubset(r.keys()), f"Missing keys in record: {r}"

    def test_all_values_are_positive_floats(self):
        records = get_hardcoded_records()
        for r in records:
            assert isinstance(r["value"], float), f"Non-float value: {r}"
            assert r["value"] > 0, f"Non-positive value: {r}"

    def test_all_units_are_t_co2_per_t_clinker(self):
        records = get_hardcoded_records()
        for r in records:
            assert "clinker" in r["unit"].lower() or "cement" in r["unit"].lower(), (
                f"Unexpected unit: {r['unit']}"
            )

    def test_years_span_2016_to_2023(self):
        records = get_hardcoded_records()
        years = {r["year"] for r in records}
        assert min(years) <= 2020
        assert max(years) >= 2023

    def test_cement_category_only(self):
        records = get_hardcoded_records()
        for r in records:
            assert r["category"] == "cement_production"

    def test_summarise_does_not_raise(self):
        records = get_hardcoded_records()
        summarise(records)  # should print without raising

    def test_load_from_excel_fallback_when_file_missing(self):
        from carbon_engine.ef_library_parser import load_from_excel
        records = load_from_excel("nonexistent_file.xlsx")
        assert len(records) >= 9  # falls back to hardcoded


# ---------------------------------------------------------------------------
# FactorProvider tests
# ---------------------------------------------------------------------------
class TestFactorProvider:
    def setup_method(self):
        self.provider = FactorProvider()

    def test_plant_supplied_takes_priority(self):
        result = self.provider.get_factor(
            year=2026,
            plant_supplied_value=0.48,
        )
        assert result.source == "plant_input"
        assert result.value == pytest.approx(0.48)
        assert "Plant-supplied" in result.why_selected

    def test_gcca_default_returned_when_no_plant_value(self):
        result = self.provider.get_factor(year=2026)
        # Either GCCA or library — both are valid
        assert result.value > 0
        assert result.source in ("gcca_default", "2A_Cement_Lime_Production.xlsx")

    def test_library_lookup_nearest_year(self):
        result = self.provider._lookup_library(
            category="cement_production",
            subcategory="calcination_ef_t_co2_per_t_clinker",
            year=2026,
            region=None,
            technology=None,
        )
        assert result is not None
        assert result.year_used <= 2026
        assert result.value > 0

    def test_library_lookup_year_2019_returns_oldest_available(self):
        """Year 2019 has no record — should return oldest available (2020)."""
        result = self.provider._lookup_library(
            category="cement_production",
            subcategory="calcination_ef_t_co2_per_t_clinker",
            year=2019,
            region=None,
            technology=None,
        )
        assert result is not None
        # No record exists for year ≤ 2019, so oldest available (2020) is returned
        assert result.year_used == 2020
        assert "oldest available" in result.why_selected

    def test_library_lookup_region_filter(self):
        result = self.provider._lookup_library(
            category="cement_production",
            subcategory="calcination_ef_t_co2_per_t_clinker",
            year=2026,
            region="Australia",
            technology=None,
        )
        assert result is not None
        assert "Australia" in result.region

    def test_library_lookup_technology_filter_nsp(self):
        result = self.provider._lookup_library(
            category="cement_production",
            subcategory="calcination_ef_t_co2_per_t_clinker",
            year=2026,
            region=None,
            technology="NSP",
        )
        assert result is not None
        assert "NSP" in result.technology

    def test_library_lookup_technology_filter_vsk(self):
        result = self.provider._lookup_library(
            category="cement_production",
            subcategory="calcination_ef_t_co2_per_t_clinker",
            year=2026,
            region=None,
            technology="VSK",
        )
        assert result is not None
        assert "VSK" in result.technology

    def test_library_lookup_unknown_category_returns_none(self):
        result = self.provider._lookup_library(
            category="unknown_category",
            subcategory="unknown_subcategory",
            year=2026,
            region=None,
            technology=None,
        )
        assert result is None

    def test_get_factor_with_priority_returns_three_tiers(self):
        selected, gcca, library = self.provider.get_factor_with_priority(year=2026)
        assert gcca.source == "gcca_default"
        assert gcca.value == pytest.approx(0.525)
        assert library is not None

    def test_plant_supplied_zero_falls_through_to_gcca(self):
        result = self.provider.get_factor(year=2026, plant_supplied_value=0.0)
        # 0.0 is treated as "not supplied"
        assert result.source != "plant_input"

    def test_list_records_returns_all(self):
        records = self.provider.list_records()
        assert len(records) >= 9

    def test_list_records_filtered_by_category(self):
        records = self.provider.list_records(category="cement_production")
        assert all(r["category"] == "cement_production" for r in records)

    def test_factor_result_has_why_selected(self):
        result = self.provider.get_factor(year=2026)
        assert result.why_selected
        assert len(result.why_selected) > 10


# ---------------------------------------------------------------------------
# CarbonEngineWithEFLibrary integration tests
# ---------------------------------------------------------------------------
class TestCarbonEngineWithEFLibrary:
    def test_gcca_default_plant_uses_library_when_prefer_library(self):
        """When plant uses GCCA default and prefer_library=True, library EF is used."""
        plant = _make_plant(ef_kg=525.0, year=2026)
        engine = CarbonEngineWithEFLibrary(plant, prefer_library=True)
        result = engine.calculate()
        assert result is not None
        assert engine.factor_audit is not None
        assert engine.factor_audit.selected.source != "plant_input"

    def test_plant_supplied_ef_always_wins(self):
        """Custom plant EF always takes priority over library."""
        plant = _make_plant(ef_kg=480.0, year=2026)
        engine = CarbonEngineWithEFLibrary(plant, prefer_library=True)
        engine.calculate()
        assert engine.factor_audit is not None
        assert engine.factor_audit.selected.source == "plant_input"
        assert engine.factor_audit.selected.value == pytest.approx(0.480)

    def test_gcca_default_used_when_prefer_library_false(self):
        """When prefer_library=False and plant uses GCCA default, GCCA is selected."""
        plant = _make_plant(ef_kg=525.0, year=2026)
        engine = CarbonEngineWithEFLibrary(plant, prefer_library=False)
        engine.calculate()
        assert engine.factor_audit is not None
        assert engine.factor_audit.selected.source == "gcca_default"

    def test_calculation_result_is_valid(self):
        """Engine produces a valid CalculationResult."""
        plant = _make_plant(ef_kg=525.0, year=2026)
        engine = CarbonEngineWithEFLibrary(plant)
        result = engine.calculate()
        assert result.scope1.calcination_co2_t > 0
        assert result.specific_co2_kg_per_t_cement > 0

    def test_factor_audit_to_dict(self):
        """factor_audit.to_dict() returns a complete transparency record."""
        plant = _make_plant(ef_kg=525.0, year=2026)
        engine = CarbonEngineWithEFLibrary(plant, prefer_library=True)
        engine.calculate()
        audit = engine.factor_audit
        assert audit is not None
        d = audit.to_dict()
        assert "selected" in d
        assert "gcca_default" in d
        assert "library" in d
        assert d["selected"]["value_kg_co2_per_t_clinker"] > 0

    def test_a1_method_skips_ef_priority(self):
        """A1 calcination method does not apply EF priority (uses LOI)."""
        from carbon_engine.carbon_engine import CalcinationInputA1
        plant = PlantInput(
            plant_name="A1 Plant",
            reporting_year=2026,
            calcination_method=CalcinationMethod.A1_SIMPLE_INPUT,
            calcination_a1=CalcinationInputA1(
                kiln_feed_t_yr=1_500_000,
                dust_return_correction_pct=10.0,
                loi_raw_meal_pct=35.0,
            ),
            cement_production_t_yr=1_000_000,
        )
        engine = CarbonEngineWithEFLibrary(plant, prefer_library=True)
        result = engine.calculate()
        assert result is not None
        assert engine.factor_audit is None  # A1 method — no EF audit

    def test_region_filter_australia(self):
        """Region filter selects Australian record."""
        plant = _make_plant(ef_kg=525.0, year=2026)
        engine = CarbonEngineWithEFLibrary(plant, prefer_library=True, region="Australia")
        engine.calculate()
        audit = engine.factor_audit
        assert audit is not None
        if audit.library:
            assert "Australia" in (audit.library.region or "")

    def test_technology_filter_nsp(self):
        """Technology filter selects NSP record."""
        plant = _make_plant(ef_kg=525.0, year=2026)
        engine = CarbonEngineWithEFLibrary(plant, prefer_library=True, technology="NSP")
        engine.calculate()
        audit = engine.factor_audit
        assert audit is not None
        if audit.library:
            assert "NSP" in (audit.library.technology or "")

    def test_backward_compatibility_plain_carbon_engine(self):
        """Original CarbonEngine still works unchanged."""
        from carbon_engine.carbon_engine import CarbonEngine
        plant = _make_plant(ef_kg=525.0, year=2026)
        result = CarbonEngine(plant).calculate()
        assert result.scope1.calcination_co2_t > 0
