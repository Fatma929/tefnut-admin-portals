"""
CBAM Engine Unit Tests
Tests 8.1 through 8.9 as specified in the CBAM compliance module spec.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from cbam_engine.cbam_engine import (
    CN_CODE_MAP,
    CBAMEngine,
    CBAMInput,
    CarbonPricePaid,
    KilnProcessType,
    ProductionProcess,
)
from carbon_engine.carbon_engine import (
    CalcinationInputB1,
    CalcinationMethod,
    ElectricityInput,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_cbam_input(**overrides) -> CBAMInput:
    defaults = dict(
        plant_name="Test Plant",
        reporting_year=2026,
        calcination_method=CalcinationMethod.B1_SIMPLE_OUTPUT,
        calcination_b1=CalcinationInputB1(
            clinker_production_t_yr=500.0,
            calcination_ef_kg_per_t_clinker=1000.0,
        ),
        kiln_fuels=[],
        non_kiln_fuels=[],
        cement_production_t_yr=1000.0,
        product_type="other_portland_cement",
        imported_quantity_t=100.0,
        carbon_price_paid=CarbonPricePaid(amount=0.0, currency_code="EUR"),
        production_process=ProductionProcess(
            process_type=KilnProcessType.DRY_KILN_PH_PC,
            kiln_capacity_t_clinker_per_day=1000.0,
            annual_operating_hours=8000.0,
            clinker_to_cement_ratio=0.75,
        ),
        declarant_eori="EG123456789",
    )
    defaults.update(overrides)
    return CBAMInput(**defaults)


class MockDb:
    """Mock DB returning a fixed ETS price row."""
    def queryOne(self, sql, params=None):
        return {
            "week_start_date": "2026-01-05",
            "price_eur_per_t_co2e": "65.0000",
            "source_url": "https://example.com/ets",
        }

    def query(self, sql, params=None):
        return None

    def queryMany(self, sql, params=None):
        return []


class EmptyDb:
    """Mock DB that returns no ETS price (simulates cold start)."""
    def queryOne(self, sql, params=None):
        return None

    def query(self, sql, params=None):
        return None

    def queryMany(self, sql, params=None):
        return []


# ---------------------------------------------------------------------------
# 8.1 SEE reference case
# ---------------------------------------------------------------------------
def test_8_1_see_reference_case():
    """direct=500t, indirect=100t, production=1000t → SEE=0.600000"""
    inp = _make_cbam_input(
        calcination_b1=CalcinationInputB1(
            clinker_production_t_yr=500.0,
            calcination_ef_kg_per_t_clinker=1000.0,  # 500t CO2
        ),
        electricity=ElectricityInput(
            purchased_electricity_mwh_yr=1000.0,
            grid_ef_kg_co2_per_mwh=100.0,  # 100t CO2
        ),
        cement_production_t_yr=1000.0,
    )
    engine = CBAMEngine(inp, db=MockDb())
    result = engine.calculate()
    assert result.see_breakdown.specific_embedded_emissions_t_per_t == pytest.approx(0.600000, abs=1e-9)


# ---------------------------------------------------------------------------
# 8.2 All 5 CN code mappings
# ---------------------------------------------------------------------------
def test_8_2_cn_code_mappings():
    """All 5 CN code entries resolve to correct codes and descriptions."""
    expected = {
        "cement_clinker":        ("2523 10", "Cement clinker"),
        "white_cement":          ("2523 21", "White Portland cement"),
        "other_portland_cement": ("2523 29", "Other Portland cement"),
        "aluminous_cement":      ("2523 30", "Aluminous cement"),
        "other_hydraulic_cement":("2523 90", "Other hydraulic cements"),
    }
    assert CN_CODE_MAP == expected


# ---------------------------------------------------------------------------
# 8.3 Zero carbon_price_paid → full obligation, credit_amount_eur=0.0
# ---------------------------------------------------------------------------
def test_8_3_zero_carbon_price_paid():
    """Zero carbon price paid → full obligation, credit_amount_eur=0.0"""
    inp = _make_cbam_input(
        carbon_price_paid=CarbonPricePaid(amount=0.0, currency_code="EUR"),
    )
    engine = CBAMEngine(inp, db=MockDb())
    result = engine.calculate()
    assert result.carbon_price_credit.credit_amount_eur == pytest.approx(0.0, abs=1e-9)
    # Net obligation should equal gross obligation
    see = result.see_breakdown.specific_embedded_emissions_t_per_t
    qty = inp.imported_quantity_t
    ets_price = result.ets_price_reference.price_eur_per_t_co2e
    expected_gross = see * qty * ets_price
    assert result.carbon_price_credit.net_cbam_obligation_certificates == pytest.approx(expected_gross, abs=1e-6)


# ---------------------------------------------------------------------------
# 8.4 Credit exceeds obligation → net=0.0 with CBAM_CREDIT_EXCEEDS_OBLIGATION warning
# ---------------------------------------------------------------------------
def test_8_4_credit_exceeds_obligation():
    """Very high carbon price paid → net obligation clamped to 0.0 with warning."""
    inp = _make_cbam_input(
        carbon_price_paid=CarbonPricePaid(amount=999999.0, currency_code="EUR"),
    )
    engine = CBAMEngine(inp, db=MockDb())
    result = engine.calculate()
    assert result.carbon_price_credit.net_cbam_obligation_certificates == pytest.approx(0.0, abs=1e-9)
    assert any("CBAM_CREDIT_EXCEEDS_OBLIGATION" in w for w in result.compliance_warnings)


# ---------------------------------------------------------------------------
# 8.5 No ETS price → CBAM_NO_ETS_PRICE error
# ---------------------------------------------------------------------------
def test_8_5_no_ets_price():
    """Cold start with no ETS price row raises CBAM_NO_ETS_PRICE."""
    inp = _make_cbam_input()
    engine = CBAMEngine(inp, db=EmptyDb())
    with pytest.raises(ValueError, match="CBAM_NO_ETS_PRICE"):
        engine.calculate()


# ---------------------------------------------------------------------------
# 8.6 reporting_year=2025 → CBAM_PRE_OBLIGATION_YEAR warning, calculation proceeds
# ---------------------------------------------------------------------------
def test_8_6_pre_obligation_year_warning():
    """reporting_year=2025 attaches CBAM_PRE_OBLIGATION_YEAR warning but does not block."""
    inp = _make_cbam_input(reporting_year=2025)
    engine = CBAMEngine(inp, db=MockDb())
    result = engine.calculate()
    warning_codes = [w.get("meta", {}).get("code") for w in result.validation_warnings]
    assert "CBAM_PRE_OBLIGATION_YEAR" in warning_codes


# ---------------------------------------------------------------------------
# 8.7 dry_kiln_ph_pc accepted as valid enum, appears in installation_metadata
# ---------------------------------------------------------------------------
def test_8_7_dry_kiln_ph_pc_enum():
    """DRY_KILN_PH_PC is a valid KilnProcessType and appears in installation_metadata."""
    inp = _make_cbam_input(
        production_process=ProductionProcess(
            process_type=KilnProcessType.DRY_KILN_PH_PC,
            kiln_capacity_t_clinker_per_day=2000.0,
            annual_operating_hours=8760.0,
            clinker_to_cement_ratio=0.80,
        )
    )
    engine = CBAMEngine(inp, db=MockDb())
    result = engine.calculate()
    assert result.installation_metadata.production_process.process_type == KilnProcessType.DRY_KILN_PH_PC


# ---------------------------------------------------------------------------
# 8.8 Declaration contains template_version="EU_CBAM_TRANSITIONAL_2024"
# ---------------------------------------------------------------------------
def test_8_8_declaration_template_version():
    """Generated declaration must contain template_version='EU_CBAM_TRANSITIONAL_2024'."""
    inp = _make_cbam_input()
    engine = CBAMEngine(inp, db=MockDb())
    declaration, result = engine.generate_declaration()
    assert declaration["template_version"] == "EU_CBAM_TRANSITIONAL_2024"


# ---------------------------------------------------------------------------
# 8.9 CBAMInput has no certificate_price field
# ---------------------------------------------------------------------------
def test_8_9_no_certificate_price_field():
    """CBAMInput schema must not have a certificate_price field."""
    fields = CBAMInput.model_fields
    assert "certificate_price" not in fields
