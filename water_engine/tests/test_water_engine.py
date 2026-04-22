import pytest
from water_engine.water_engine import (
    AuditContext,
    MethodologyTag,
    WaterDischarge,
    WaterEngine,
    WaterInput,
    WaterWithdrawal,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def make_audit_context():
    return AuditContext(
        source_filename="test.json",
        upload_timestamp_utc="2026-01-15T10:30:00Z",
    )


def _reference_result(audit_context):
    water_input = WaterInput(
        withdrawal=WaterWithdrawal(
            surface_water=500_000,
            municipal_potable_water=50_000,
        ),
        discharge=WaterDischarge(surface_water=100_000),
        cementitious_production_t_yr=2_300_000,
    )
    return WaterEngine(water_input, audit_context).calculate()


# ---------------------------------------------------------------------------
# 4.1 — Methodology defaults
# ---------------------------------------------------------------------------
def test_default_methodology_values(make_audit_context):
    result = _reference_result(make_audit_context)
    assert result.methodology.protocol_name == "GCCA Water"
    assert result.methodology.protocol_version == "0.1"


# ---------------------------------------------------------------------------
# 4.2 — Default user_id is "anonymous"
# ---------------------------------------------------------------------------
def test_default_user_id_anonymous():
    ctx = AuditContext(
        source_filename="test.json",
        upload_timestamp_utc="2026-01-15T10:30:00Z",
    )
    water_input = WaterInput(
        withdrawal=WaterWithdrawal(surface_water=1_000),
        cementitious_production_t_yr=1_000,
    )
    result = WaterEngine(water_input, ctx).calculate()
    assert result.audit_trail.user_id == "anonymous"


# ---------------------------------------------------------------------------
# 4.3 — Reference validation case
# ---------------------------------------------------------------------------
def test_reference_validation_case(make_audit_context):
    result = _reference_result(make_audit_context)
    assert result.total_water_withdrawal_m3 == 550_000
    assert result.total_water_discharge_m3 == 100_000
    assert result.total_water_consumption_m3 == 450_000
    assert result.total_freshwater_consumption_m3 == 450_000
    assert result.water_consumption_per_tonne_litres == pytest.approx(195.65, abs=0.01)


# ---------------------------------------------------------------------------
# 4.4 — Missing timestamp raises ValueError
# ---------------------------------------------------------------------------
def test_missing_timestamp_raises():
    ctx = AuditContext(source_filename="test.json", upload_timestamp_utc="")
    water_input = WaterInput(
        withdrawal=WaterWithdrawal(surface_water=1_000),
        cementitious_production_t_yr=1_000,
    )
    with pytest.raises(ValueError, match="upload_timestamp_utc is required for audit trail"):
        WaterEngine(water_input, ctx)


# ---------------------------------------------------------------------------
# 4.5 — Zero input case
# ---------------------------------------------------------------------------
def test_zero_input_case(make_audit_context):
    water_input = WaterInput(
        withdrawal=WaterWithdrawal(),
        discharge=WaterDischarge(),
        cementitious_production_t_yr=1_000_000,
    )
    result = WaterEngine(water_input, make_audit_context).calculate()
    assert result.total_water_withdrawal_m3 == 0.0
    assert result.total_water_discharge_m3 == 0.0
    assert result.total_water_consumption_m3 == 0.0
    assert result.total_freshwater_consumption_m3 == 0.0
    assert result.water_consumption_per_tonne_litres == 0.0
    assert len(result.steps_breakdown) == 5
    assert all(s.output_value == 0.0 for s in result.steps_breakdown)


# ---------------------------------------------------------------------------
# 4.6 — Discharge exceeds withdrawal
# ---------------------------------------------------------------------------
def test_discharge_exceeds_withdrawal(make_audit_context):
    water_input = WaterInput(
        withdrawal=WaterWithdrawal(surface_water=100_000),
        discharge=WaterDischarge(surface_water=200_000),
        cementitious_production_t_yr=1_000_000,
    )
    result = WaterEngine(water_input, make_audit_context).calculate()
    assert result.total_water_consumption_m3 == 0.0
    assert len(result.warnings) > 0


# ---------------------------------------------------------------------------
# 4.7 — Steps breakdown order and IDs
# ---------------------------------------------------------------------------
def test_steps_breakdown_order_and_ids(make_audit_context):
    result = _reference_result(make_audit_context)
    assert [s.step_id for s in result.steps_breakdown] == [
        "total_withdrawal",
        "total_discharge",
        "kpi_1_consumption",
        "freshwater_consumption",
        "kpi_2_intensity",
    ]


# ---------------------------------------------------------------------------
# 4.8 — KPI 2 step has conversion_factor_l_per_m3
# ---------------------------------------------------------------------------
def test_kpi2_step_has_conversion_factor(make_audit_context):
    result = _reference_result(make_audit_context)
    assert "conversion_factor_l_per_m3" in result.steps_breakdown[4].inputs


# ---------------------------------------------------------------------------
# 4.9 — Input hash changes with different inputs
# ---------------------------------------------------------------------------
def test_input_hash_changes_with_different_inputs(make_audit_context):
    input_a = WaterInput(
        withdrawal=WaterWithdrawal(surface_water=100_000),
        cementitious_production_t_yr=1_000_000,
    )
    input_b = WaterInput(
        withdrawal=WaterWithdrawal(surface_water=200_000),
        cementitious_production_t_yr=1_000_000,
    )
    result_a = WaterEngine(input_a, make_audit_context).calculate()
    result_b = WaterEngine(input_b, make_audit_context).calculate()
    assert (
        result_a.audit_trail.source_reference.input_hash
        != result_b.audit_trail.source_reference.input_hash
    )


# ---------------------------------------------------------------------------
# 4.10 — Invalid protocol_version raises ValueError
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("version", ["v0.1", "0", "0.1.0", "abc"])
def test_invalid_protocol_version_raises(version):
    with pytest.raises(ValueError):
        MethodologyTag(protocol_version=version)
