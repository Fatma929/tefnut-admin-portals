"""
Unit tests for the Tefnut Carbon Engine.
Run: pytest carbon_engine/tests/
"""

import pytest
from carbon_engine.carbon_engine import (
    CalcinationInputA1,
    CalcinationInputB1,
    CalcinationMethod,
    CarbonEngine,
    ElectricityInput,
    FuelEntry,
    FuelType,
    PlantInput,
    TransportEntry,
    WaterInput,
    GCCA_DEFAULT_CALCINATION_EF_KG_PER_T_CLINKER,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def make_plant(**overrides) -> PlantInput:
    defaults = dict(
        plant_name="Test Plant",
        reporting_year=2026,
        calcination_method=CalcinationMethod.B1_SIMPLE_OUTPUT,
        calcination_b1=CalcinationInputB1(clinker_production_t_yr=100_000),
        cement_production_t_yr=120_000,
    )
    defaults.update(overrides)
    return PlantInput(**defaults)


# ---------------------------------------------------------------------------
# Calcination — Method B1
# ---------------------------------------------------------------------------
class TestCalcinationB1:
    def test_basic_clinker_only(self):
        plant = make_plant(
            calcination_b1=CalcinationInputB1(clinker_production_t_yr=100_000)
        )
        result = CarbonEngine(plant).calculate()
        expected = 100_000 * GCCA_DEFAULT_CALCINATION_EF_KG_PER_T_CLINKER / 1000.0
        assert result.scope1.calcination_co2_t == pytest.approx(expected, rel=1e-4)

    def test_with_bypass_dust(self):
        plant = make_plant(
            calcination_b1=CalcinationInputB1(
                clinker_production_t_yr=100_000,
                bypass_dust_t_yr=1_000,
            )
        )
        result = CarbonEngine(plant).calculate()
        expected = 101_000 * GCCA_DEFAULT_CALCINATION_EF_KG_PER_T_CLINKER / 1000.0
        assert result.scope1.calcination_co2_t == pytest.approx(expected, rel=1e-4)

    def test_with_ckd_partial_calcination(self):
        plant = make_plant(
            calcination_b1=CalcinationInputB1(
                clinker_production_t_yr=100_000,
                ckd_leaving_kiln_t_yr=500,
                ckd_calcination_rate_d=0.5,
            )
        )
        result = CarbonEngine(plant).calculate()
        ef = GCCA_DEFAULT_CALCINATION_EF_KG_PER_T_CLINKER / 1000.0
        expected = (100_000 + 500 * 0.5) * ef
        assert result.scope1.calcination_co2_t == pytest.approx(expected, rel=1e-4)

    def test_custom_ef(self):
        plant = make_plant(
            calcination_b1=CalcinationInputB1(
                clinker_production_t_yr=100_000,
                calcination_ef_kg_per_t_clinker=510.0,
            )
        )
        result = CarbonEngine(plant).calculate()
        assert result.scope1.calcination_co2_t == pytest.approx(51_000.0, rel=1e-4)


# ---------------------------------------------------------------------------
# Calcination — Method A1
# ---------------------------------------------------------------------------
class TestCalcinationA1:
    def test_basic_loi(self):
        """
        GCCA Equation 1: CO2 = KF × (1 - DR) × LOI_RM
        KF=5100 t/d × 365 = 1,861,500 t/yr, DR=10%, LOI=35%
        """
        kf_yr = 5_100 * 365
        plant = make_plant(
            calcination_method=CalcinationMethod.A1_SIMPLE_INPUT,
            calcination_b1=None,
            calcination_a1=CalcinationInputA1(
                kiln_feed_t_yr=kf_yr,
                dust_return_correction_pct=10.0,
                loi_raw_meal_pct=35.0,
            ),
        )
        result = CarbonEngine(plant).calculate()
        expected = kf_yr * 0.90 * 0.35
        assert result.scope1.calcination_co2_t == pytest.approx(expected, rel=1e-4)

    def test_with_ckd(self):
        plant = make_plant(
            calcination_method=CalcinationMethod.A1_SIMPLE_INPUT,
            calcination_b1=None,
            calcination_a1=CalcinationInputA1(
                kiln_feed_t_yr=1_000_000,
                dust_return_correction_pct=10.0,
                loi_raw_meal_pct=35.0,
                ckd_leaving_kiln_t_yr=10_000,
                loi_ckd_pct=5.0,
            ),
        )
        result = CarbonEngine(plant).calculate()
        # Should be greater than without CKD
        base = 1_000_000 * 0.90 * 0.35
        assert result.scope1.calcination_co2_t > base


# ---------------------------------------------------------------------------
# Fuel Combustion
# ---------------------------------------------------------------------------
class TestFuelCombustion:
    def test_coal_default_ef(self):
        """
        GCCA Eq.13: CO2 = consumption × LHV × EF / 1,000,000
        coal: EF=96 kg CO2/GJ, LHV=26 GJ/t, 10,000 t/yr
        """
        plant = make_plant(
            kiln_fuels=[
                FuelEntry(
                    fuel_type=FuelType.COAL_ANTHRACITE,
                    consumption_t_per_yr=10_000,
                    lhv_gj_per_t=26.0,
                )
            ]
        )
        result = CarbonEngine(plant).calculate()
        expected = 10_000 * 26.0 * 96.0 / 1_000_000.0
        assert result.scope1.fuel_combustion_co2_t == pytest.approx(expected, rel=1e-4)

    def test_natural_gas_default_ef(self):
        plant = make_plant(
            kiln_fuels=[
                FuelEntry(
                    fuel_type=FuelType.NATURAL_GAS,
                    consumption_t_per_yr=5_000,
                    lhv_gj_per_t=48.0,
                )
            ]
        )
        result = CarbonEngine(plant).calculate()
        expected = 5_000 * 48.0 * 56.1 / 1_000_000.0
        assert result.scope1.fuel_combustion_co2_t == pytest.approx(expected, rel=1e-4)

    def test_biomass_excluded_from_scope1(self):
        plant = make_plant(
            kiln_fuels=[
                FuelEntry(
                    fuel_type=FuelType.WOOD_SAW_DUST,
                    consumption_t_per_yr=1_000,
                    lhv_gj_per_t=15.0,
                )
            ]
        )
        result = CarbonEngine(plant).calculate()
        assert result.scope1.fuel_combustion_co2_t == pytest.approx(0.0, abs=1e-6)
        assert result.scope1.biomass_co2_memo_t > 0

    def test_mixed_fuel_split(self):
        """Tyres: 27% biogenic by default (GCCA Table 4)."""
        plant = make_plant(
            kiln_fuels=[
                FuelEntry(
                    fuel_type=FuelType.TYRES,
                    consumption_t_per_yr=1_000,
                    lhv_gj_per_t=30.0,
                    biogenic_fraction=0.27,
                )
            ]
        )
        result = CarbonEngine(plant).calculate()
        total = 1_000 * 30.0 * 85.0 / 1_000_000.0
        assert result.scope1.fuel_combustion_co2_t == pytest.approx(total * 0.73, rel=1e-4)
        assert result.scope1.biomass_co2_memo_t == pytest.approx(total * 0.27, rel=1e-4)

    def test_energy_intensity_kpi(self):
        plant = make_plant(
            clinker_production_t_yr=100_000,
            kiln_fuels=[
                FuelEntry(
                    fuel_type=FuelType.COAL_ANTHRACITE,
                    consumption_t_per_yr=10_000,
                    lhv_gj_per_t=26.0,
                )
            ],
        )
        result = CarbonEngine(plant).calculate()
        expected_tj = 10_000 * 26.0 / 1000.0
        expected_gj_per_t = expected_tj * 1000.0 / 100_000
        assert result.energy.energy_intensity_gj_per_t_clinker == pytest.approx(
            expected_gj_per_t, rel=1e-4
        )


# ---------------------------------------------------------------------------
# Scope 2
# ---------------------------------------------------------------------------
class TestScope2:
    def test_electricity(self):
        plant = make_plant(
            electricity=ElectricityInput(
                purchased_electricity_mwh_yr=50_000,
                grid_ef_kg_co2_per_mwh=0.5,
            )
        )
        result = CarbonEngine(plant).calculate()
        assert result.scope2.electricity_co2_t == pytest.approx(25.0, rel=1e-4)

    def test_no_electricity(self):
        plant = make_plant()
        result = CarbonEngine(plant).calculate()
        assert result.scope2.electricity_co2_t == 0.0


# ---------------------------------------------------------------------------
# Scope 3
# ---------------------------------------------------------------------------
class TestScope3:
    def test_transport(self):
        plant = make_plant(
            transport_entries=[
                TransportEntry(
                    description="Limestone",
                    freight_tonne_km=1_000_000,
                    ef_kg_co2_per_tonne_km=0.062,
                )
            ]
        )
        result = CarbonEngine(plant).calculate()
        assert result.scope3.transport_co2_t == pytest.approx(62.0, rel=1e-4)


# ---------------------------------------------------------------------------
# KPIs
# ---------------------------------------------------------------------------
class TestKPIs:
    def test_specific_co2(self):
        plant = make_plant(
            calcination_b1=CalcinationInputB1(clinker_production_t_yr=100_000),
            cement_production_t_yr=120_000,
        )
        result = CarbonEngine(plant).calculate()
        expected_kg = (result.total_co2e_t / 120_000) * 1000.0
        assert result.specific_co2_kg_per_t_cement == pytest.approx(expected_kg, rel=1e-4)

    def test_water_kpi(self):
        plant = make_plant(
            water=WaterInput(
                withdrawal_m3_yr=1_200_000,
                discharge_m3_yr=200_000,
                recycled_m3_yr=50_000,
            )
        )
        result = CarbonEngine(plant).calculate()
        assert result.water.withdrawal_m3 == 1_200_000
        assert result.water.consumption_m3 == 1_000_000
        assert result.water.recycled_m3 == 50_000

    def test_cbam_embedded_co2(self):
        plant = make_plant(
            calcination_b1=CalcinationInputB1(clinker_production_t_yr=100_000),
            cement_production_t_yr=120_000,
            cbam_goods_count=14,
            cbam_data_completeness_pct=92.0,
        )
        result = CarbonEngine(plant).calculate()
        assert result.cbam.goods_count == 14
        assert result.cbam.completeness_pct == 92.0
        assert result.cbam.specific_embedded_co2_t_per_t_cement > 0

    def test_source_mix_sums_to_100(self):
        plant = make_plant(
            kiln_fuels=[
                FuelEntry(
                    fuel_type=FuelType.COAL_ANTHRACITE,
                    consumption_t_per_yr=10_000,
                    lhv_gj_per_t=26.0,
                )
            ],
            electricity=ElectricityInput(
                purchased_electricity_mwh_yr=50_000,
                grid_ef_kg_co2_per_mwh=0.5,
            ),
        )
        result = CarbonEngine(plant).calculate()
        total_pct = sum(item["value"] for item in result.source_mix)
        assert total_pct == pytest.approx(100.0, abs=0.5)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
class TestValidation:
    def test_missing_b1_raises(self):
        with pytest.raises(Exception):
            PlantInput(
                plant_name="X",
                reporting_year=2026,
                calcination_method=CalcinationMethod.B1_SIMPLE_OUTPUT,
                cement_production_t_yr=100_000,
            )

    def test_negative_consumption_raises(self):
        with pytest.raises(Exception):
            FuelEntry(
                fuel_type=FuelType.COAL_ANTHRACITE,
                consumption_t_per_yr=-100,
                lhv_gj_per_t=26.0,
            )
