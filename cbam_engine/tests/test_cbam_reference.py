"""
CBAM Reference Calculation Tests
Verifies the SEE reference case and CN code mappings.
"""
import pytest
from cbam_engine.cbam_engine import CN_CODE_MAP, CBAMEngine, CBAMInput, CarbonPricePaid, ProductionProcess, KilnProcessType
from carbon_engine.carbon_engine import CalcinationInputB1, CalcinationMethod


def _make_cbam_input(**overrides) -> CBAMInput:
    """Build a minimal valid CBAMInput for testing."""
    defaults = dict(
        plant_name="Test Plant",
        reporting_year=2026,
        calcination_method=CalcinationMethod.B1_SIMPLE_OUTPUT,
        calcination_b1=CalcinationInputB1(
            clinker_production_t_yr=500.0,
            calcination_ef_kg_per_t_clinker=1000.0,  # 500t scope1 calcination
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
    """Minimal mock DB that returns a fixed ETS price row."""
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


def test_see_reference_case():
    """
    Reference: direct=500t (calcination), indirect=100t (electricity), production=1000t
    Expected SEE = round((500 + 100) / 1000, 6) = 0.600000
    """
    from carbon_engine.carbon_engine import ElectricityInput
    inp = _make_cbam_input(
        calcination_b1=CalcinationInputB1(
            clinker_production_t_yr=500.0,
            calcination_ef_kg_per_t_clinker=1000.0,  # 500 * 1.0 = 500t CO2
        ),
        electricity=ElectricityInput(
            purchased_electricity_mwh_yr=1000.0,
            grid_ef_kg_co2_per_mwh=100.0,  # 1000 * 100 / 1000 = 100t CO2
        ),
        cement_production_t_yr=1000.0,
    )
    engine = CBAMEngine(inp, db=MockDb())
    result = engine.calculate()
    assert result.see_breakdown.specific_embedded_emissions_t_per_t == pytest.approx(0.600000, abs=1e-9)


def test_cn_code_cement_clinker():
    assert CN_CODE_MAP["cement_clinker"] == ("2523 10", "Cement clinker")


def test_cn_code_white_cement():
    assert CN_CODE_MAP["white_cement"] == ("2523 21", "White Portland cement")


def test_cn_code_other_portland_cement():
    assert CN_CODE_MAP["other_portland_cement"] == ("2523 29", "Other Portland cement")


def test_cn_code_aluminous_cement():
    assert CN_CODE_MAP["aluminous_cement"] == ("2523 30", "Aluminous cement")


def test_cn_code_other_hydraulic_cement():
    assert CN_CODE_MAP["other_hydraulic_cement"] == ("2523 90", "Other hydraulic cements")
